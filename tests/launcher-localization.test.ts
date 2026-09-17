import { expect, test } from "bun:test";
import { copyFor } from "../launcher/src/i18n";
import languages from "../launcher/electron/languages.json";

test("launcher exposes only complete English copy", () => {
  expect(Object.keys(languages)).toEqual(["en"]);
  const english = copyFor("en");
  expect(english.install).toBe("Install models");
  expect(english.done).toBe("Done");
  expect(Object.values(english).every(text => text.trim().length > 0)).toBe(true);
  expect(english.biggerContextBody).not.toContain("TXT");
  expect(english.manualPromptInstruction).toContain("Codex Zero Risk");
});
