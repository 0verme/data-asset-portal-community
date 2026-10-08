import assert from "node:assert/strict";
import test from "node:test";

import { ensureOverlayRoot } from "./overlayPortal.ts";

test("overlay portal root initialization is safe during server rendering", () => {
  assert.equal(ensureOverlayRoot(), null);
});
