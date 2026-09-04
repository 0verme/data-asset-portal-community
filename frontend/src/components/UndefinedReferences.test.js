import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const sourcePath = (relativePath) =>
  fileURLToPath(new URL(relativePath, import.meta.url));
const readSource = (relativePath) => readFile(sourcePath(relativePath), "utf8");

test("rendered components import their referenced helpers", async () => {
  const [systemEditor, reportDetail, upstreamDetail, upstreamParts] =
    await Promise.all([
      readSource("./push/SystemEditor.tsx"),
      readSource("./report/ReportDetailDrawer.tsx"),
      readSource("./upstream/UpstreamDetail.tsx"),
      readSource("./upstream/UpstreamParts.tsx"),
    ]);

  assert.match(
    systemEditor,
    /import \{ isValidLatestOutputTime, normalizeLatestOutputTime \} from "\.\.\/\.\.\/utils\/push\.(js|ts)";/,
  );
  assert.match(
    systemEditor,
    /DEFAULT_STATUS_OPTIONS,\s+SYSTEM_ID_RE,\s+\} from "\.\/pushConstants\.(js|ts)";/,
  );
  assert.match(
    reportDetail,
    /import \{ RowActions, StatusBadge \} from "\.\.\/common\/index\.ts";/,
  );
  assert.match(
    upstreamDetail,
    /import \{ nextUnload, ScheduleStepper \} from "\.\/UpstreamParts\.(jsx|tsx)";/,
  );
  assert.match(
    upstreamParts,
    /export \{ getScheduleSteps, nextUnload \} from "\.\/scheduleStepper\.(js|ts)"/,
  );
  assert.match(
    upstreamParts,
    /export function ScheduleStepper\(\{[\s\S]*?times[\s\S]*?muted[\s\S]*?now[\s\S]*?\}: ScheduleStepperProps\)/,
  );
});

test("data hooks import the shared error formatter", async () => {
  const sources = await Promise.all([
    readSource("../hooks/useAssetModule.ts"),
    readSource("../hooks/usePushModule.ts"),
    readSource("../hooks/useRootModule.ts"),
  ]);

  for (const source of sources) {
    assert.match(
      source,
      /import \{[^}]*getErrorMessage[^}]*\} from ["']\.\.\/utils\/ui\.(js|ts)["'];/,
    );
  }
});
