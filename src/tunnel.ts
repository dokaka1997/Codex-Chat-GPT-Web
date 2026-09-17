import { createHash, randomUUID } from "node:crypto";
import {
  chmodSync,
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  rmSync,
  statSync,
  writeSync,
} from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { unzipSync } from "fflate";
import type { AppConfig, BrowserInteractionMode, TunnelConfig } from "./config";
import { atomicWriteFile, getConfigDir } from "./config";
import { runCommand, runChecked } from "./process";

export const TUNNEL_VERSION = "0.0.12";
const MIGRATABLE_TUNNEL_VERSIONS = new Set(["0.0.10"]);
const RELEASE_BASE = `https://github.com/openai/tunnel-client/releases/download/v${TUNNEL_VERSION}`;
const OFFICIAL_MIRROR_BASE = `https://persistent.oaistatic.com/tunnel-client/v${TUNNEL_VERSION}`;
const MAX_DOWNLOAD_BYTES = 100 * 1024 * 1024;
const DEFAULT_DOWNLOAD_TIMEOUT_MS = 180_000;
const DEFAULT_DOWNLOAD_RETRIES = 4;
const MIN_DOWNLOAD_RETRIES = 3;
const MAX_DOWNLOAD_RETRIES = 5;
const MIN_DOWNLOAD_TIMEOUT_MS = 10_000;
const MAX_DOWNLOAD_TIMEOUT_MS = 30 * 60_000;
const DOWNLOAD_TIMEOUT_ENV = "CODEX_WEB_GPT_TUNNEL_DOWNLOAD_TIMEOUT_MS";
const DOWNLOAD_RETRIES_ENV = "CODEX_WEB_GPT_TUNNEL_DOWNLOAD_RETRIES";
const DOWNLOAD_MIRRORS_ENV = "CODEX_WEB_GPT_TUNNEL_DOWNLOAD_MIRRORS";
const MANUAL_ARCHIVE_ENV = "CODEX_WEB_GPT_TUNNEL_CLIENT_ARCHIVE";
export const TUNNEL_READY_TIMEOUT_MS = 120_000;
const TUNNEL_STATUS_POLL_INTERVAL_MS = 1_000;

const PINNED_ARCHIVE_SHA256: Readonly<Record<string, string>> = Object.freeze({
  [`tunnel-client-v${TUNNEL_VERSION}-darwin-amd64.zip`]: "33de53aec680faafedc795f8f8268d6861577bddb871cb2d49529c91f88c2009",
  [`tunnel-client-v${TUNNEL_VERSION}-darwin-arm64.zip`]: "42fb3138dc9c081d5777cb7e8bd1e041cc48b67c4978dbab3c5167ca1aabca02",
  [`tunnel-client-v${TUNNEL_VERSION}-linux-amd64.zip`]: "2bb693bd7b5cd28da7ce09cd9e309529dbb33b7cc9dc0058e62a064688f92c81",
  [`tunnel-client-v${TUNNEL_VERSION}-linux-arm64.zip`]: "6813878a3edb82ebebb32fe5a859bc6327a81cce5bc7b635a2313174d26365d6",
  [`tunnel-client-v${TUNNEL_VERSION}-windows-amd64.zip`]: "2a2804933924e38a502d62b61f0266cb80d56d65744f4c29876b2bf9c1544356",
  [`tunnel-client-v${TUNNEL_VERSION}-windows-arm64.zip`]: "65ab54221554481bb1c23b6015b99abe0b7f79b08593f4fb17a9e2e25532281d",
});

interface TunnelInstallManifest {
  version: 1;
  tunnelClientVersion: string;
  asset: string;
  archiveSha256: string;
  binarySha256: string;
}

export interface TunnelDownloadProgress {
  downloadedBytes: number;
  totalBytes?: number;
  percent?: number;
  resumed: boolean;
}

export interface TunnelDownloadSettings {
  timeoutMs: number;
  retries: number;
  mirrors: string[];
  manualArchive?: string;
}

export function tunnelClientInstallAction(installedVersion: string): "reuse" | "upgrade" {
  if (installedVersion === TUNNEL_VERSION) return "reuse";
  if (MIGRATABLE_TUNNEL_VERSIONS.has(installedVersion)) return "upgrade";
  throw new Error(`Installed tunnel-client version ${installedVersion} is not a trusted upgrade source`);
}

function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function parseIntegerSetting(
  value: string | undefined,
  fallback: number,
  name: string,
  min: number,
  max: number,
): number {
  if (value === undefined || value.trim() === "") return fallback;
  if (!/^\d+$/.test(value.trim())) throw new Error(`${name} must be an integer from ${min} to ${max}`);
  const parsed = Number(value.trim());
  if (!Number.isSafeInteger(parsed) || parsed < min || parsed > max) {
    throw new Error(`${name} must be an integer from ${min} to ${max}`);
  }
  return parsed;
}

function normalizeMirrorBase(value: string): string {
  const parsed = new URL(value.trim());
  if (parsed.protocol !== "https:") throw new Error(`${DOWNLOAD_MIRRORS_ENV} entries must use HTTPS`);
  if (parsed.username || parsed.password) throw new Error(`${DOWNLOAD_MIRRORS_ENV} entries must not include credentials`);
  parsed.hash = "";
  parsed.search = "";
  return parsed.toString().replace(/\/$/, "");
}

export function resolveTunnelDownloadSettings(
  environment: NodeJS.ProcessEnv = process.env,
): TunnelDownloadSettings {
  const timeoutMs = parseIntegerSetting(
    environment[DOWNLOAD_TIMEOUT_ENV],
    DEFAULT_DOWNLOAD_TIMEOUT_MS,
    DOWNLOAD_TIMEOUT_ENV,
    MIN_DOWNLOAD_TIMEOUT_MS,
    MAX_DOWNLOAD_TIMEOUT_MS,
  );
  const retries = parseIntegerSetting(
    environment[DOWNLOAD_RETRIES_ENV],
    DEFAULT_DOWNLOAD_RETRIES,
    DOWNLOAD_RETRIES_ENV,
    MIN_DOWNLOAD_RETRIES,
    MAX_DOWNLOAD_RETRIES,
  );
  const mirrors = (environment[DOWNLOAD_MIRRORS_ENV] ?? "")
    .split(",")
    .map(value => value.trim())
    .filter(Boolean)
    .map(normalizeMirrorBase);
  const manualArchive = environment[MANUAL_ARCHIVE_ENV]?.trim();
  return {
    timeoutMs,
    retries,
    mirrors,
    ...(manualArchive ? { manualArchive: resolve(manualArchive) } : {}),
  };
}

function platformAsset(): string {
  const os = process.platform === "darwin" ? "darwin"
    : process.platform === "linux" ? "linux"
      : process.platform === "win32" ? "windows"
        : undefined;
  const arch = process.arch === "arm64" ? "arm64" : process.arch === "x64" ? "amd64" : undefined;
  if (!os || !arch) throw new Error(`openai/tunnel-client has no pinned build for ${process.platform}/${process.arch}`);
  return `tunnel-client-v${TUNNEL_VERSION}-${os}-${arch}.zip`;
}

function expectedArchiveChecksum(asset: string): string {
  const checksum = PINNED_ARCHIVE_SHA256[asset];
  if (!checksum) throw new Error(`No pinned SHA-256 checksum is available for ${asset}`);
  return checksum;
}

export function tunnelDownloadSources(asset: string, mirrors: string[] = []): string[] {
  const bases = [RELEASE_BASE, ...mirrors, OFFICIAL_MIRROR_BASE];
  const unique = [...new Set(bases.map(base => base.replace(/\/$/, "")))];
  return unique.map(base => `${base}/${asset}`);
}

function contentRangeTotal(value: string | null): { start?: number; total?: number } {
  if (!value) return {};
  const match = /^bytes\s+(\d+)-(\d+)\/(\d+|\*)$/i.exec(value.trim());
  if (!match) return {};
  return {
    start: Number(match[1]),
    ...(match[3] !== "*" ? { total: Number(match[3]) } : {}),
  };
}

export async function downloadFileWithResume(
  url: string,
  destination: string,
  options: {
    timeoutMs: number;
    maxBytes?: number;
    onProgress?: (progress: TunnelDownloadProgress) => void;
  },
): Promise<void> {
  const maxBytes = options.maxBytes ?? MAX_DOWNLOAD_BYTES;
  mkdirSync(dirname(destination), { recursive: true, mode: 0o700 });
  let existingBytes = existsSync(destination) ? statSync(destination).size : 0;
  if (existingBytes > maxBytes) {
    rmSync(destination, { force: true });
    existingBytes = 0;
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs);
  try {
    const response = await fetch(url, {
      redirect: "follow",
      signal: controller.signal,
      headers: existingBytes > 0 ? { Range: `bytes=${existingBytes}-` } : undefined,
    });
    if (response.status === 416 && existingBytes > 0) return;
    if (!response.ok) throw new Error(`Download failed (${response.status}): ${url}`);

    let append = existingBytes > 0 && response.status === 206;
    const range = contentRangeTotal(response.headers.get("content-range"));
    if (append && range.start !== existingBytes) {
      throw new Error(`Download resume offset mismatch for ${url}`);
    }
    if (!append && existingBytes > 0) {
      existingBytes = 0;
      rmSync(destination, { force: true });
    }

    const contentLength = Number(response.headers.get("content-length") ?? "0");
    const totalBytes = range.total
      ?? (Number.isFinite(contentLength) && contentLength > 0 ? existingBytes + contentLength : undefined);
    if (totalBytes !== undefined && totalBytes > maxBytes) {
      throw new Error(`Download exceeds ${maxBytes} bytes: ${url}`);
    }
    let downloadedBytes = existingBytes;
    let previousPercent = -1;
    const emitProgress = () => {
      const percent = totalBytes && totalBytes > 0
        ? Math.min(100, Math.floor((downloadedBytes / totalBytes) * 100))
        : undefined;
      if (percent !== undefined && percent === previousPercent) return;
      if (percent !== undefined) previousPercent = percent;
      options.onProgress?.({ downloadedBytes, totalBytes, percent, resumed: append });
    };
    emitProgress();

    if (!response.body) throw new Error(`Download returned no response body: ${url}`);
    const file = openSync(destination, append ? "a" : "w");
    try {
      const reader = response.body.getReader();
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        if (!value || value.byteLength === 0) continue;
        downloadedBytes += value.byteLength;
        if (downloadedBytes > maxBytes) throw new Error(`Download exceeds ${maxBytes} bytes: ${url}`);
        writeSync(file, value);
        emitProgress();
      }
    } finally {
      closeSync(file);
    }
    if (totalBytes !== undefined && downloadedBytes < totalBytes) {
      throw new Error(`Download ended early at ${downloadedBytes} of ${totalBytes} bytes: ${url}`);
    }
    if (previousPercent !== 100) {
      options.onProgress?.({ downloadedBytes, totalBytes: totalBytes ?? downloadedBytes, percent: 100, resumed: append });
    }
  } catch (error) {
    if (controller.signal.aborted) throw new Error(`Download timed out after ${options.timeoutMs}ms: ${url}`);
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

function readVerifiedArchive(archivePath: string, asset: string, expected: string): Uint8Array {
  if (!existsSync(archivePath)) throw new Error(`Selected tunnel-client ZIP does not exist: ${archivePath}`);
  const stat = statSync(archivePath);
  if (!stat.isFile()) throw new Error(`Selected tunnel-client ZIP is not a regular file: ${archivePath}`);
  if (stat.size < 1 || stat.size > MAX_DOWNLOAD_BYTES) {
    throw new Error(`Selected tunnel-client ZIP has an invalid size: ${archivePath}`);
  }
  const archive = new Uint8Array(readFileSync(archivePath));
  const actual = sha256(archive);
  if (actual !== expected) {
    throw new Error(`SHA-256 verification failed for ${asset}; selected ZIP does not match the pinned release`);
  }
  return archive;
}

async function downloadVerifiedArchive(
  asset: string,
  expected: string,
  settings: TunnelDownloadSettings,
): Promise<{ archive: Uint8Array; partialPath?: string }> {
  if (settings.manualArchive) {
    process.stdout.write("Tunnel client download: 100%\n");
    return { archive: readVerifiedArchive(settings.manualArchive, asset, expected) };
  }

  const downloadDir = join(getConfigDir(), "downloads");
  mkdirSync(downloadDir, { recursive: true, mode: 0o700 });
  const partialPath = join(downloadDir, `${asset}.part`);
  const sources = tunnelDownloadSources(asset, settings.mirrors);
  let lastError: unknown;

  for (let attempt = 1; attempt <= settings.retries; attempt += 1) {
    const url = sources[(attempt - 1) % sources.length];
    try {
      if (!existsSync(partialPath) || statSync(partialPath).size === 0) {
        process.stdout.write("Tunnel client download: 0%\n");
      }
      let lastReported = -1;
      await downloadFileWithResume(url, partialPath, {
        timeoutMs: settings.timeoutMs,
        maxBytes: MAX_DOWNLOAD_BYTES,
        onProgress: progress => {
          if (progress.percent === undefined || progress.percent === lastReported) return;
          lastReported = progress.percent;
          process.stdout.write(`Tunnel client download: ${progress.percent}%\n`);
        },
      });
      const archive = new Uint8Array(readFileSync(partialPath));
      const actual = sha256(archive);
      if (actual !== expected) {
        rmSync(partialPath, { force: true });
        throw new Error(`SHA-256 verification failed for ${asset}`);
      }
      return { archive, partialPath };
    } catch (error) {
      lastError = error;
      if (attempt < settings.retries) {
        await new Promise(resolveRetry => setTimeout(resolveRetry, Math.min(1_000 * (2 ** (attempt - 1)), 8_000)));
      }
    }
  }

  throw lastError instanceof Error ? lastError : new Error(String(lastError ?? "Unknown download failure"));
}

function binaryPath(): string {
  return join(getConfigDir(), "bin", process.platform === "win32" ? "tunnel-client.exe" : "tunnel-client");
}

function manifestPath(): string {
  return join(getConfigDir(), "bin", "tunnel-client-manifest.json");
}

export async function installTunnelClient(): Promise<string> {
  const executable = binaryPath();
  const manifestFile = manifestPath();
  let previousInstallation: { binary: Uint8Array; manifestText: string } | undefined;
  if (existsSync(executable) && existsSync(manifestFile)) {
    const manifestText = readFileSync(manifestFile, "utf8");
    const manifest = JSON.parse(manifestText) as Partial<TunnelInstallManifest>;
    const installedBinary = new Uint8Array(readFileSync(executable));
    const actual = sha256(installedBinary);
    if (manifest.version !== 1 || typeof manifest.tunnelClientVersion !== "string"
      || manifest.binarySha256 !== actual) {
      throw new Error(`Existing tunnel-client failed integrity validation: ${executable}`);
    }
    if (process.platform !== "win32" && (statSync(executable).mode & 0o111) === 0) {
      throw new Error(`Existing tunnel-client is not executable: ${executable}`);
    }
    const action = tunnelClientInstallAction(manifest.tunnelClientVersion);
    const installedVersion = runChecked(executable, ["--version"], { timeout: 10_000 });
    if (!installedVersion.stdout.includes(manifest.tunnelClientVersion)
      && !installedVersion.stderr.includes(manifest.tunnelClientVersion)) {
      throw new Error(`Existing tunnel-client did not report version ${manifest.tunnelClientVersion}`);
    }
    if (action === "reuse") return executable;
    previousInstallation = { binary: installedBinary, manifestText };
  }
  if (!previousInstallation && (existsSync(executable) || existsSync(manifestFile))) {
    rmSync(executable, { force: true });
    rmSync(manifestFile, { force: true });
  }

  const asset = platformAsset();
  const expected = expectedArchiveChecksum(asset);
  let downloaded: { archive: Uint8Array; partialPath?: string };
  try {
    const settings = resolveTunnelDownloadSettings();
    downloaded = await downloadVerifiedArchive(asset, expected, settings);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`Tunnel client download failed: ${detail}`);
  }
  const archive = downloaded.archive;
  const archiveHash = sha256(archive);
  if (archiveHash !== expected) throw new Error(`Tunnel client download failed: SHA-256 verification failed for ${asset}`);
  const files = unzipSync(archive);
  const expectedName = process.platform === "win32" ? "tunnel-client.exe" : "tunnel-client";
  const entry = Object.entries(files).find(([name]) => basename(name) === expectedName);
  if (!entry) throw new Error(`${asset} does not contain ${expectedName}`);
  const binary = entry[1];
  mkdirSync(dirname(executable), { recursive: true, mode: 0o700 });
  const stagedExecutable = `${executable}.install-${process.pid}-${randomUUID()}${process.platform === "win32" ? ".exe" : ""}`;
  atomicWriteFile(stagedExecutable, binary);
  let version: ReturnType<typeof runChecked>;
  try {
    if (process.platform !== "win32") chmodSync(stagedExecutable, 0o700);
    version = runChecked(stagedExecutable, ["--version"], { timeout: 10_000 });
    if (!version.stdout.includes(TUNNEL_VERSION) && !version.stderr.includes(TUNNEL_VERSION)) {
      throw new Error(`Installed tunnel-client did not report version ${TUNNEL_VERSION}`);
    }
  } finally {
    rmSync(stagedExecutable, { force: true });
  }
  const manifest: TunnelInstallManifest = {
    version: 1,
    tunnelClientVersion: TUNNEL_VERSION,
    asset,
    archiveSha256: archiveHash,
    binarySha256: sha256(binary),
  };
  try {
    atomicWriteFile(executable, binary);
    if (process.platform !== "win32") chmodSync(executable, 0o700);
    atomicWriteFile(manifestFile, `${JSON.stringify(manifest, null, 2)}\n`);
    if (downloaded.partialPath) rmSync(downloaded.partialPath, { force: true });
  } catch (error) {
    if (previousInstallation) {
      atomicWriteFile(executable, previousInstallation.binary);
      if (process.platform !== "win32") chmodSync(executable, 0o700);
      atomicWriteFile(manifestFile, previousInstallation.manifestText);
    } else {
      rmSync(executable, { force: true });
      rmSync(manifestFile, { force: true });
    }
    throw error;
  }
  return executable;
}

export function installRuntimeKey(
  sourcePath: string,
  interactionMode: BrowserInteractionMode = "automatic",
): string {
  if (!existsSync(sourcePath)) throw new Error(`Tunnel runtime key file does not exist: ${sourcePath}`);
  const key = readFileSync(sourcePath);
  if (key.byteLength === 0 || key.byteLength > 64 * 1024) throw new Error("Tunnel runtime key file is empty or unexpectedly large");
  return installRuntimeKeyBytes(key, interactionMode);
}

export function managedRuntimeKeyPath(interactionMode: BrowserInteractionMode = "automatic"): string {
  const fileName = interactionMode === "manual"
    ? "tunnel-runtime-zero-risk.key"
    : "tunnel-runtime-automatic.key";
  return join(getConfigDir(), "secrets", fileName);
}

export function installRuntimeKeyBytes(
  key: Uint8Array | string,
  interactionMode: BrowserInteractionMode = "automatic",
): string {
  const bytes = typeof key === "string" ? new TextEncoder().encode(key.trim()) : key;
  if (bytes.byteLength === 0 || bytes.byteLength > 64 * 1024) throw new Error("Tunnel runtime key is empty or unexpectedly large");
  const destination = managedRuntimeKeyPath(interactionMode);
  atomicWriteFile(destination, bytes);
  return destination;
}

export function createTunnelConfig(options: {
  binaryPath: string;
  tunnelId: string;
  runtimeKeyFile: string;
  profileName?: string;
  alias?: string;
}): TunnelConfig {
  if (!/^tunnel_[a-f0-9]{32}$/.test(options.tunnelId)) throw new Error("--tunnel-id must be tunnel_ followed by 32 lowercase hexadecimal characters");
  const profileName = options.profileName ?? "codex-chatgpt-web";
  const alias = options.alias ?? "codex-chatgpt-web";
  if (!/^[A-Za-z0-9._-]+$/.test(profileName) || !/^[A-Za-z0-9._-]+$/.test(alias)) {
    throw new Error("Tunnel profile and alias may contain only letters, digits, dot, underscore, and dash");
  }
  return {
    binaryPath: options.binaryPath,
    tunnelId: options.tunnelId,
    runtimeKeyFile: options.runtimeKeyFile,
    profileDir: join(getConfigDir(), "tunnel", "profiles"),
    profileName,
    alias,
  };
}

function shellQuote(value: string): string {
  if (/^[A-Za-z0-9_./:@%+=,-]+$/.test(value)) return value;
  return `'${value.replaceAll("'", `'"'"'`)}'`;
}

function tunnelCommandQuoted(value: string): string {
  if (/[\r\n]/.test(value)) throw new Error("Tunnel MCP command values must not contain newlines");
  // tunnel-client parses mcp.command with backslash escapes on every platform.
  return `"${value.replaceAll("\\", "\\\\").replaceAll('"', '\\"')}"`;
}

export function mcpCommand(config: AppConfig, platform = process.platform): string {
  const contract = config.browserInteractionMode === "manual" ? "safe" : "native";
  const command = [
    ...config.runtimeCommand,
    "mcp",
    "--contract",
    contract,
    "--broker-socket",
    config.brokerSocketPath,
  ];
  if (platform === "win32") {
    return command.map(tunnelCommandQuoted).join(" ");
  }
  return command.map(shellQuote).join(" ");
}

function tunnel(config: AppConfig): TunnelConfig {
  if (config.mode !== "full" || !config.tunnel) throw new Error("Tunnel commands require full mode");
  return config.tunnel;
}

export function connectTunnel(config: AppConfig): void {
  const settings = tunnel(config);
  mkdirSync(settings.profileDir, { recursive: true, mode: 0o700 });
  const result = runCommand(settings.binaryPath, [
    "runtimes", "connect",
    "--alias", settings.alias,
    "--profile", settings.profileName,
    "--profile-dir", settings.profileDir,
    "--tunnel-client-bin", settings.binaryPath,
    "--tunnel-id", settings.tunnelId,
    "--runtime-api-key", `file:${settings.runtimeKeyFile}`,
    "--mcp-command", mcpCommand(config),
    "--json",
  ], { timeout: TUNNEL_READY_TIMEOUT_MS });
  const structuredOutput = result.stdout.trim();
  const launchError = structuredOutput
    ? tunnelConnectLaunchError(structuredOutput)
    : undefined;
  if (result.status !== 0) {
    const detail = launchError && launchError !== "tunnel-client returned non-JSON connect output"
      ? launchError
      : safeTunnelDetail(tunnelCommandOutput(result) || `exit ${result.status}`);
    throw new Error(`Tunnel managed startup failed: ${detail}`);
  }
  if (launchError) throw new Error(`Tunnel runtime exited during launch: ${launchError}`);
}

export function stopTunnel(config: AppConfig): void {
  const settings = tunnel(config);
  const result = runCommand(
    settings.binaryPath,
    ["runtimes", "stop", settings.alias, "--json"],
    { timeout: 15_000 },
  );
  if (result.status !== 0
    && !/not found|not running|unknown alias|\balias\b[^\r\n]{0,160}\bis not known\b/i.test(
      `${result.stdout}\n${result.stderr}`,
    )) {
    throw new Error(`Failed to stop tunnel runtime: ${result.stderr.trim() || result.stdout.trim()}`);
  }
}

export interface TunnelRuntimeStatus {
  ok: boolean;
  processRunning: boolean;
  healthy: boolean;
  ready: boolean;
  state?: string;
  detail: string;
}

export function tunnelCommandOutput(result: {
  status: number;
  stdout: string;
  stderr: string;
}): string {
  const stdout = result.stdout.trim();
  const stderr = result.stderr.trim();
  return result.status === 0
    ? (stdout || stderr)
    : [stderr, stdout].filter(Boolean).join("\n");
}

function safeTunnelDetail(value: unknown): string {
  const text = typeof value === "string" ? value : JSON.stringify(value);
  return text
    .replace(/tunnel_[a-f0-9]{32}/g, "[tunnel-id]")
    .replace(/sk-[A-Za-z0-9_-]{12,}/g, "[redacted-key]")
    .slice(0, 2_000);
}

function nestedRecord(value: unknown, key: string): Record<string, unknown> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const nested = (value as Record<string, unknown>)[key];
  return nested && typeof nested === "object" && !Array.isArray(nested)
    ? nested as Record<string, unknown>
    : undefined;
}

function runtimeLogTail(parsed: Record<string, unknown>): string | undefined {
  const launchTail = nestedRecord(parsed, "launch_diagnostics")?.log_tail;
  if (typeof launchTail === "string" && launchTail.trim()) return launchTail.trim();
  const statusTail = nestedRecord(nestedRecord(parsed, "local"), "log")?.tail;
  return typeof statusTail === "string" && statusTail.trim() ? statusTail.trim() : undefined;
}

export function tunnelConnectLaunchError(output: string): string | undefined {
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(output) as Record<string, unknown>;
  } catch {
    return "tunnel-client returned non-JSON connect output";
  }
  const running = parsed.running === true;
  const healthy = parsed.healthy === true;
  const ready = parsed.ready === true;
  if (running && healthy) return undefined;
  const diagnostics = nestedRecord(parsed, "launch_diagnostics");
  const exitCode = typeof parsed.exit_code === "number" ? parsed.exit_code
    : typeof diagnostics?.exit_code === "number" ? diagnostics.exit_code
      : undefined;
  const remoteError = typeof parsed.remote_error === "string" && parsed.remote_error.trim()
    ? parsed.remote_error.trim()
    : undefined;
  const logTail = runtimeLogTail(parsed);
  return safeTunnelDetail([
    `running=${running}`,
    `healthy=${healthy}`,
    `ready=${ready}`,
    ...(exitCode !== undefined ? [`exit_code=${exitCode}`] : []),
    ...(remoteError ? [`remote_error=${remoteError}`] : []),
    ...(logTail ? [`runtime_log=${logTail}`] : []),
    ...(!remoteError && !logTail ? ["runtime did not complete a healthy launch"] : []),
  ].join("; "));
}

export function parseTunnelStatus(output: string, alias: string, exitStatus = 0): TunnelRuntimeStatus {
  if (exitStatus !== 0) {
    return { ok: false, processRunning: false, healthy: false, ready: false, detail: safeTunnelDetail(output) };
  }
  try {
    const parsed = JSON.parse(output) as Record<string, unknown>;
    if (!Array.isArray(parsed.entries)) throw new Error("local inventory has no entries array");
    const matches = parsed.entries.filter(entry => entry?.alias === alias);
    if (matches.length > 1) throw new Error("local inventory contains duplicate aliases");
    const state = matches.length === 0 ? "stopped" : matches[0].runtime_state;
    if (!["stopped", "starting", "healthy", "ready"].includes(state)) {
      throw new Error("local inventory has an unsupported runtime state");
    }
    // tunnel-client 0.0.12 derives these states from the live process and local healthz/readyz
    // probes. It does not need the optional remote control-plane lookup made by `status`.
    const processRunning = state !== "stopped";
    const healthy = state === "healthy" || state === "ready";
    const ready = state === "ready";
    const ok = processRunning && healthy && ready;
    const detail = ok
      ? "process_running=true healthy=true ready=true"
      : safeTunnelDetail([
        `process_running=${processRunning}`,
        `healthy=${healthy}`,
        `ready=${ready}`,
        `state=${state}`,
        ...(matches.length === 0 ? ["local_inventory=absent"] : []),
      ].join("; "));
    return { ok, processRunning, healthy, ready, state, detail };
  } catch (error) {
    return { ok: false, processRunning: false, healthy: false, ready: false, detail: `tunnel-client returned invalid local inventory: ${safeTunnelDetail(error instanceof Error ? error.message : String(error))}` };
  }
}

export function tunnelStatus(config: AppConfig): TunnelRuntimeStatus {
  const settings = tunnel(config);
  if (!existsSync(settings.binaryPath)) {
    return { ok: false, processRunning: false, healthy: false, ready: false, detail: `Missing ${settings.binaryPath}` };
  }
  const result = runCommand(
    settings.binaryPath,
    ["runtimes", "cleanup", "--json"],
    { timeout: 10_000 },
  );
  return parseTunnelStatus(tunnelCommandOutput(result), settings.alias, result.status);
}

export async function waitForTunnelReady(
  config: AppConfig,
  timeoutMs = TUNNEL_READY_TIMEOUT_MS,
): Promise<TunnelRuntimeStatus> {
  const deadline = Date.now() + timeoutMs;
  let status = tunnelStatus(config);
  while (!status.ok && Date.now() < deadline) {
    await new Promise(resolveWait => setTimeout(resolveWait, TUNNEL_STATUS_POLL_INTERVAL_MS));
    status = tunnelStatus(config);
  }
  return status;
}
