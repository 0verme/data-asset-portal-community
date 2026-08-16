import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const pagePath = fileURLToPath(new URL("./UserManagementPage.jsx", import.meta.url));

test("user secondary info is only rendered for a non-blank email", async () => {
  const source = await readFile(pagePath, "utf8");

  assert.match(source, /typeof user\.email === "string" && user\.email\.trim\(\)/);
  assert.match(source, /<div className="system-user-sub"><Highlight text=\{user\.email\} q=\{query\} \/><\/div>/);
  assert.doesNotMatch(source, /system-user-sub"><Highlight text=\{user\.email \|\| "-"\}/);
});

test("other user-list empty-value placeholders remain intact", async () => {
  const source = await readFile(pagePath, "utf8");

  assert.match(source, /formatDateTime\(user\.lastLoginAt\)/);
  assert.match(source, /user\.remark \|\| "-"/);
});
