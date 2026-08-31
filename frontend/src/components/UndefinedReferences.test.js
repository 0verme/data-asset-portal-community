import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const sourcePath = (relativePath) => fileURLToPath(new URL(relativePath, import.meta.url));
const readSource = (relativePath) => readFile(sourcePath(relativePath), "utf8");

test("rendered components import their referenced helpers", async () => {
  const [systemEditor, reportDetail, upstreamDetail, upstreamParts] = await Promise.all([
    readSource("./push/SystemEditor.jsx"),
    readSource("./report/ReportDetailDrawer.jsx"),
    readSource("./upstream/UpstreamDetail.jsx"),
    readSource("./upstream/UpstreamParts.jsx"),
  ]);

  assert.match(
    systemEditor,
    /import \{ isValidLatestOutputTime, normalizeLatestOutputTime \} from "\.\.\/\.\.\/utils\/push\.js";/,
  );
  assert.match(
    systemEditor,
    /DEFAULT_STATUS_OPTIONS,\s+SYSTEM_ID_RE,\s+\} from "\.\/pushConstants\.js";/,
  );
  assert.match(
    reportDetail,
    /import \{ RowActions, StatusBadge \} from "\.\.\/common\/index\.js";/,
  );
  assert.match(
    upstreamDetail,
    /import \{ nextUnload, ScheduleTimeline \} from "\.\/UpstreamParts\.jsx";/,
  );
  assert.match(upstreamParts, /export function nextUnload\(times\)/);
});

test("data hooks import the shared error formatter", async () => {
  const sources = await Promise.all([
    readSource("../hooks/useAssetModule.js"),
    readSource("../hooks/useDictOptions.js"),
    readSource("../hooks/usePushModule.js"),
    readSource("../hooks/useRootModule.js"),
  ]);

  for (const source of sources) {
    assert.match(source, /import \{[^}]*getErrorMessage[^}]*\} from "\.\.\/utils\/ui\.js";/);
  }
});
