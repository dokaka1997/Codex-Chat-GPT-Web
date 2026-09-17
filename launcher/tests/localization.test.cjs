const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");

const launcherRoot = path.resolve(__dirname, "..");
const repositoryRoot = path.resolve(launcherRoot, "..");
const read = (...parts) => fs.readFileSync(path.join(repositoryRoot, ...parts), "utf8");
const languages = require("../electron/languages.json");

function loadI18nModule() {
  const source = read("launcher", "src", "i18n.ts");
  const output = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2023,
    },
  }).outputText;
  const loaded = { exports: {} };
  Function("module", "exports", "require", output)(loaded, loaded.exports, require);
  return loaded.exports;
}

test("launcher exposes English as its only supported language", () => {
  assert.deepEqual(Object.keys(languages), ["en"]);
  assert.deepEqual(languages.en, { label: "English", marker: "EN", locale: "en" });
});

test("translated README variants are removed", () => {
  for (const file of ["README.zh-CN.md", "README.ja.md", "README.ko.md"]) {
    assert.equal(fs.existsSync(path.join(repositoryRoot, file)), false, `${file} should not exist`);
  }
  const readme = read("README.md");
  assert.doesNotMatch(readme, /README\.(?:zh-CN|ja|ko)\.md/);
});

test("renderer copy is English and runtime messages pass through unchanged", () => {
  const { copyFor, localizeRuntimeMessage } = loadI18nModule();
  const copy = copyFor("en");
  assert.equal(copy.install, "Install models");
  assert.equal(copy.done, "Done");

  for (const [message, checkId] of [
    ["Checking local runtime", undefined],
    ["Responses proxy is healthy on 127.0.0.1:17841", "proxy"],
    ['ChatGPT connector "Codex Native2" is available', "connector"],
    ["Unexpected connector diagnostic", "connector"],
  ]) {
    assert.equal(localizeRuntimeMessage(copy, message, checkId, "en"), message);
  }
});

test("native IPC accepts English and rejects removed locales", () => {
  const main = read("launcher", "electron", "main.cjs");
  const copySource = main.slice(main.indexOf("const NATIVE_COPY ="), main.indexOf("function updateTrayMenu("));
  const validation = main.slice(main.indexOf("function validateLanguage("), main.indexOf("function validateBrowserInteractionMode("));
  const { nativeCopyFor, validateLanguage } = Function(
    "languages",
    `${copySource}\n${validation}\nreturn {nativeCopyFor, validateLanguage};`,
  )(languages);

  assert.equal(validateLanguage("en"), "en");
  assert.equal(nativeCopyFor("en").quit, "Quit");
  for (const language of ["zh-CN", "zh-TW", "ja", "ko", "unknown", null, [], {}]) {
    assert.throws(() => validateLanguage(language), /Language must/);
  }
});
