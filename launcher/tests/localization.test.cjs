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

test("launcher supports English and Vietnamese", () => {
  assert.deepEqual(Object.keys(languages), ["en", "vi"]);
  assert.deepEqual(languages.en, { label: "English", marker: "EN", locale: "en" });
  assert.deepEqual(languages.vi, { label: "Tiếng Việt", marker: "VI", locale: "vi" });
});

test("removed README translations stay removed", () => {
  for (const file of ["README.zh-CN.md", "README.ja.md", "README.ko.md"]) {
    assert.equal(fs.existsSync(path.join(repositoryRoot, file)), false, `${file} should not exist`);
  }
  const readme = read("README.md");
  assert.doesNotMatch(readme, /README\.(?:zh-CN|ja|ko)\.md/);
});

test("renderer exposes Vietnamese copy and localizes known runtime messages", () => {
  const { copyFor, localizeRuntimeMessage } = loadI18nModule();
  const english = copyFor("en");
  const vietnamese = copyFor("vi");

  assert.equal(english.install, "Install models");
  assert.equal(vietnamese.install, "Cài model");
  assert.equal(vietnamese.done, "Xong");
  assert.equal(vietnamese.language, "Ngôn ngữ");
  assert.equal(
    localizeRuntimeMessage(vietnamese, "Checking local runtime", undefined, "vi"),
    vietnamese.checkingLocalRuntime,
  );
  assert.equal(
    localizeRuntimeMessage(vietnamese, "Responses proxy is healthy on 127.0.0.1:17841", "proxy", "vi"),
    vietnamese.doctorProxyHealthy.replace("{endpoint}", "127.0.0.1:17841"),
  );
  assert.equal(
    localizeRuntimeMessage(vietnamese, 'ChatGPT connector "Codex Native2" is available', "connector", "vi"),
    vietnamese.doctorConnectorAvailable.replace("{name}", "Codex Native2"),
  );
  assert.equal(
    localizeRuntimeMessage(vietnamese, "Unexpected connector diagnostic", "connector", "vi"),
    "Unexpected connector diagnostic",
  );
  assert.equal(
    localizeRuntimeMessage(english, "Checking local runtime", undefined, "en"),
    "Checking local runtime",
  );
});

test("native IPC accepts English and Vietnamese and rejects removed locales", () => {
  const main = read("launcher", "electron", "main.cjs");
  const copySource = main.slice(main.indexOf("const NATIVE_COPY ="), main.indexOf("function updateTrayMenu("));
  const validation = main.slice(main.indexOf("function validateLanguage("), main.indexOf("function validateBrowserInteractionMode("));
  const { nativeCopyFor, validateLanguage } = Function(
    "languages",
    `${copySource}\n${validation}\nreturn {nativeCopyFor, validateLanguage};`,
  )(languages);

  assert.equal(validateLanguage("en"), "en");
  assert.equal(validateLanguage("vi"), "vi");
  assert.equal(nativeCopyFor("en").quit, "Quit");
  assert.ok(nativeCopyFor("vi").quit);
  for (const language of ["zh-CN", "zh-TW", "ja", "ko", "unknown", null, [], {}]) {
    assert.throws(() => validateLanguage(language), /Language must/);
  }
});
