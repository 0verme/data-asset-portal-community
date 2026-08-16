import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(path, import.meta.url), "utf8");

test("downstream push loads dictionaries through one batch request", async () => {
  const [api, dictHook, pushHook] = await Promise.all([
    read("./api/commonCodes.js"),
    read("./hooks/useDictOptions.js"),
    read("./hooks/usePushModule.js"),
  ]);

  assert.match(api, /requestRemote\("\/common-codes\/items"/);
  assert.match(dictHook, /getCodeItemsBatch\(categoryCodes\)/);
  assert.match(pushHook, /getDictOptionsBatch\(categoryCodes\)/);
  assert.doesNotMatch(pushHook, /getDictOptions\("PUSH_PROTOCOL"\)/);
});
