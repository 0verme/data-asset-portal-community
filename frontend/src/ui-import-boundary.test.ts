import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const sourceRoot = fileURLToPath(new URL("./", import.meta.url));
const adapterRoot = join(sourceRoot, "ui");
const spikeRoot = join(sourceRoot, "kumo-spike");

function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return /\.(?:js|jsx|ts|tsx)$/.test(entry.name) ? [path] : [];
  });
}

test("Kumo component deep imports stay within DAP adapters and the Phase 1 raw probe", () => {
  const violations = sourceFiles(sourceRoot).flatMap((filePath) => {
    const isAdapter = filePath === adapterRoot || filePath.startsWith(`${adapterRoot}/`);
    const isRawProbe = filePath === spikeRoot || filePath.startsWith(`${spikeRoot}/`);
    if (isAdapter || isRawProbe) return [];
    const source = readFileSync(filePath, "utf8");
    return /(?:\bfrom\s*|\bimport\s*(?:\(\s*)?)["']@cloudflare\/kumo\/components\//.test(source)
      ? [relative(sourceRoot, filePath)]
      : [];
  });

  assert.deepEqual(violations, []);
});
