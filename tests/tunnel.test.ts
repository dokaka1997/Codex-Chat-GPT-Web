import { describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  TUNNEL_VERSION,
  downloadFileWithResume,
  parseTunnelStatus,
  resolveTunnelDownloadSettings,
  tunnelClientInstallAction,
  tunnelCommandOutput,
  tunnelConnectLaunchError,
  tunnelDownloadSources,
} from "../src/tunnel";

test("pins the fixed tunnel-client and migrates only the previously shipped version", () => {
  expect(TUNNEL_VERSION).toBe("0.0.12");
  expect(tunnelClientInstallAction("0.0.12")).toBe("reuse");
  expect(tunnelClientInstallAction("0.0.10")).toBe("upgrade");
  expect(() => tunnelClientInstallAction("0.0.11")).toThrow("not a trusted upgrade source");
  expect(() => tunnelClientInstallAction("9.9.9")).toThrow("not a trusted upgrade source");
});

describe("tunnel-client download settings", () => {
  test("uses safe defaults and accepts bounded overrides", () => {
    expect(resolveTunnelDownloadSettings({})).toEqual({
      timeoutMs: 180_000,
      retries: 4,
      mirrors: [],
    });
    expect(resolveTunnelDownloadSettings({
      CODEX_WEB_GPT_TUNNEL_DOWNLOAD_TIMEOUT_MS: "240000",
      CODEX_WEB_GPT_TUNNEL_DOWNLOAD_RETRIES: "5",
      CODEX_WEB_GPT_TUNNEL_DOWNLOAD_MIRRORS: "https://mirror.example/tunnel/ , https://backup.example/releases",
      CODEX_WEB_GPT_TUNNEL_CLIENT_ARCHIVE: "./manual.zip",
    })).toEqual({
      timeoutMs: 240_000,
      retries: 5,
      mirrors: ["https://mirror.example/tunnel", "https://backup.example/releases"],
      manualArchive: expect.stringContaining("manual.zip"),
    });
    expect(() => resolveTunnelDownloadSettings({ CODEX_WEB_GPT_TUNNEL_DOWNLOAD_RETRIES: "2" }))
      .toThrow("must be an integer from 3 to 5");
    expect(() => resolveTunnelDownloadSettings({ CODEX_WEB_GPT_TUNNEL_DOWNLOAD_MIRRORS: "http://mirror.example" }))
      .toThrow("must use HTTPS");
  });

  test("falls back from GitHub through custom mirrors to the official OpenAI CDN", () => {
    const asset = `tunnel-client-v${TUNNEL_VERSION}-darwin-arm64.zip`;
    expect(tunnelDownloadSources(asset, ["https://mirror.example/tunnel"])).toEqual([
      `https://github.com/openai/tunnel-client/releases/download/v${TUNNEL_VERSION}/${asset}`,
      `https://mirror.example/tunnel/${asset}`,
      `https://persistent.oaistatic.com/tunnel-client/v${TUNNEL_VERSION}/${asset}`,
    ]);
  });

  test("resumes a partial ZIP with an HTTP Range request and reports progress", async () => {
    const root = mkdtempSync(join(tmpdir(), "codex-tunnel-resume-"));
    const destination = join(root, "tunnel.zip.part");
    const payload = Buffer.from("0123456789abcdefghijklmnopqrstuvwxyz");
    const prefix = payload.subarray(0, 10);
    writeFileSync(destination, prefix);
    let rangeHeader: string | undefined;
    const server = createServer((request, response) => {
      rangeHeader = request.headers.range;
      const remaining = payload.subarray(prefix.length);
      response.writeHead(206, {
        "Content-Length": String(remaining.byteLength),
        "Content-Range": `bytes ${prefix.length}-${payload.length - 1}/${payload.length}`,
        "Content-Type": "application/zip",
      });
      response.end(remaining);
    });
    const progress: number[] = [];
    try {
      await new Promise<void>(resolveListen => server.listen(0, "127.0.0.1", resolveListen));
      const address = server.address() as AddressInfo;
      await downloadFileWithResume(`http://127.0.0.1:${address.port}/tunnel.zip`, destination, {
        timeoutMs: 5_000,
        maxBytes: 1_024,
        onProgress: update => {
          if (update.percent !== undefined) progress.push(update.percent);
        },
      });
      expect(rangeHeader).toBe(`bytes=${prefix.length}-`);
      expect(readFileSync(destination)).toEqual(payload);
      expect(progress.at(-1)).toBe(100);
      expect(progress.some(percent => percent > 0 && percent < 100)).toBe(true);
    } finally {
      await new Promise<void>(resolveClose => server.close(() => resolveClose()));
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe("tunnel status boundary", () => {
  test("requires the exact alias to have a locally verified ready runtime", () => {
    expect(parseTunnelStatus(JSON.stringify({
      entries: [{ alias: "ours", runtime_state: "ready" }],
    }), "ours")).toEqual({
      ok: true,
      processRunning: true,
      healthy: true,
      ready: true,
      state: "ready",
      detail: "process_running=true healthy=true ready=true",
    });
    for (const state of ["stopped", "starting", "healthy"]) {
      expect(parseTunnelStatus(JSON.stringify({ entries: [
        { alias: "other", runtime_state: "ready" }, { alias: "ours", runtime_state: state },
      ] }), "ours")).toMatchObject({
        ok: false, processRunning: state !== "stopped", healthy: state === "healthy", ready: false,
      });
    }
  });

  test("redacts tunnel ids and keys from safe diagnostics", () => {
    const result = parseTunnelStatus(
      "failed tunnel_0123456789abcdef0123456789abcdef with sk-secretsecretsecret",
      "ours",
      1,
    );
    expect(result.detail).toBe("failed [tunnel-id] with [redacted-key]");
    expect(result.detail).not.toContain("0123456789abcdef");
  });

  test("surfaces and redacts an immediate managed-runtime launch failure", () => {
    const detail = tunnelConnectLaunchError(JSON.stringify({
      running: false,
      healthy: false,
      ready: false,
      exit_code: 1,
      launch_diagnostics: {
        log_tail: "403 for tunnel_0123456789abcdef0123456789abcdef using sk-secretsecretsecret",
      },
    }));

    expect(detail).toBe(
      "running=false; healthy=false; ready=false; exit_code=1; runtime_log=403 for [tunnel-id] using [redacted-key]",
    );
  });

  test("accepts a healthy managed launch while setup waits for control-plane readiness", () => {
    expect(tunnelConnectLaunchError(JSON.stringify({
      running: true,
      healthy: true,
      ready: true,
    }))).toBeUndefined();

    expect(tunnelConnectLaunchError(JSON.stringify({
      running: true,
      healthy: true,
      ready: false,
    }))).toBeUndefined();

    expect(tunnelConnectLaunchError(JSON.stringify({
      running: true,
      healthy: false,
      ready: false,
    }))).toContain("running=true; healthy=false; ready=false");

    expect(tunnelConnectLaunchError("not json")).toBe("tunnel-client returned non-JSON connect output");
  });

  test("missing, ambiguous, or malformed local inventory cannot report ready", () => {
    const ready = { alias: "ours", runtime_state: "ready" };
    for (const output of ["invalid JSON", "{}", JSON.stringify({ entries: [ready, ready] }),
      JSON.stringify({ entries: [{ ...ready, runtime_state: "unknown" }] })]) {
      expect(parseTunnelStatus(output, "ours")).toMatchObject({ ok: false, ready: false });
      expect(parseTunnelStatus(output, "ours").detail).toContain("invalid local inventory");
    }
    expect(parseTunnelStatus(JSON.stringify({ entries: [{ ...ready, alias: "other" }] }), "ours"))
      .toMatchObject({ ok: false, processRunning: false, healthy: false, ready: false, state: "stopped" });
  });

  test("status diagnostics do not discard stderr when a failed command also wrote stdout", () => {
    expect(tunnelCommandOutput({
      status: 1,
      stdout: '{"partial":true}',
      stderr: "runtime process exited with status 1",
    })).toBe('runtime process exited with status 1\n{"partial":true}');
    expect(tunnelCommandOutput({
      status: 0,
      stdout: '{"ready":true}',
      stderr: "non-fatal warning",
    })).toBe('{"ready":true}');
  });
});
