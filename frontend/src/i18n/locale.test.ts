import assert from "node:assert/strict";
import test from "node:test";

import {
  DEFAULT_LANGUAGE,
  LANGUAGE_STORAGE_KEY,
  normalizeLanguage,
  persistLanguagePreference,
  resolveInitialLanguage,
} from "./locale.ts";

const storage = (value: string | null, onWrite?: (key: string, next: string) => void) => ({
  getItem: (key: string) => key === LANGUAGE_STORAGE_KEY ? value : null,
  setItem: (key: string, next: string) => onWrite?.(key, next),
});

test("language resolution supports only the two exact locales and defaults safely to Chinese", () => {
  assert.equal(normalizeLanguage("en-US"), "en-US");
  for (const invalid of ["en", "en-GB", "zh", "fr-FR", "", null, undefined, 3]) {
    assert.equal(normalizeLanguage(invalid), DEFAULT_LANGUAGE);
  }
  assert.equal(resolveInitialLanguage(() => storage("en-US")), "en-US");
  assert.equal(resolveInitialLanguage(() => storage("invalid")), DEFAULT_LANGUAGE);
  assert.equal(resolveInitialLanguage(() => null), DEFAULT_LANGUAGE);
});

test("unavailable or throwing storage degrades without throwing", () => {
  assert.equal(resolveInitialLanguage(() => { throw new Error("storage blocked"); }), DEFAULT_LANGUAGE);
  assert.equal(resolveInitialLanguage(() => ({
    getItem: () => { throw new Error("storage blocked"); },
    setItem: () => { throw new Error("storage blocked"); },
  })), DEFAULT_LANGUAGE);
  assert.doesNotThrow(() => persistLanguagePreference("en-US", () => { throw new Error("storage blocked"); }));
  assert.doesNotThrow(() => persistLanguagePreference("zh-CN", () => ({
    getItem: () => null,
    setItem: () => { throw new Error("storage blocked"); },
  })));
});

test("language preference persistence uses its own storage key", () => {
  let written: [string, string] | undefined;
  persistLanguagePreference("en-US", () => storage(null, (key, value) => { written = [key, value]; }));
  assert.deepEqual(written, [LANGUAGE_STORAGE_KEY, "en-US"]);
  assert.equal(LANGUAGE_STORAGE_KEY, "dap-language");
});
