import { existsSync, readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { relative, resolve, sep } from "node:path";

const frontendRoot = resolve(import.meta.dirname, "..");
const packages = [
  "packages/lineage-viewer",
  "packages/lineage-viewer-react",
  "packages/lineage-viewer-domain-adapter",
];

function fail(message) {
  throw new Error(message);
}

function readJson(path) {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    fail(`cannot read JSON ${path}: ${error.message}`);
  }
}

function collectExportTargets(value, targets) {
  if (typeof value === "string") {
    targets.add(value);
    return;
  }
  if (!value || typeof value !== "object") return;
  for (const nested of Object.values(value)) collectExportTargets(nested, targets);
}

function packageTargets(manifest) {
  const targets = new Set();
  for (const field of ["main", "module", "types"]) {
    if (typeof manifest[field] === "string") targets.add(manifest[field]);
  }
  collectExportTargets(manifest.exports, targets);
  return [...targets];
}

function packPreview(packageDir) {
  const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";
  const result = spawnSync(
    npmCommand,
    ["pack", "--dry-run", "--json", "--ignore-scripts"],
    { cwd: packageDir, encoding: "utf8" },
  );
  if (result.error) fail(`npm pack failed to start for ${packageDir}: ${result.error.message}`);
  if (result.status !== 0) {
    fail(`npm pack failed for ${packageDir}:\n${result.stdout}\n${result.stderr}`);
  }

  const output = result.stdout.trim();
  const jsonStart = output.indexOf("[");
  if (jsonStart < 0) fail(`npm pack returned no JSON for ${packageDir}: ${output}`);
  let report;
  try {
    report = JSON.parse(output.slice(jsonStart));
  } catch (error) {
    fail(`cannot parse npm pack output for ${packageDir}: ${error.message}\n${output}`);
  }
  const files = report?.[0]?.files;
  if (!Array.isArray(files)) fail(`npm pack did not report files for ${packageDir}`);
  return new Set(files.map(({ path }) => path.replaceAll("\\", "/")));
}

for (const relativePackage of packages) {
  const packageDir = resolve(frontendRoot, relativePackage);
  const manifestPath = resolve(packageDir, "package.json");
  const manifest = readJson(manifestPath);
  const distDir = resolve(packageDir, "dist");

  if (!existsSync(distDir)) {
    fail(`${relativePackage}: dist/ is missing; run npm run build:lineage first`);
  }
  if (!Array.isArray(manifest.files) || !manifest.files.includes("dist")) {
    fail(`${relativePackage}: package files must include dist`);
  }

  const packedFiles = packPreview(packageDir);
  const targets = packageTargets(manifest);
  if (targets.length === 0) fail(`${relativePackage}: no package entry points declared`);

  for (const target of targets) {
    if (!target.startsWith("./")) fail(`${relativePackage}: entry is not package-relative: ${target}`);
    const absoluteTarget = resolve(packageDir, target);
    const relativeTarget = relative(packageDir, absoluteTarget).replaceAll(sep, "/");
    if (relativeTarget.startsWith("../") || relativeTarget === "..") {
      fail(`${relativePackage}: entry escapes package directory: ${target}`);
    }
    if (!existsSync(absoluteTarget)) fail(`${relativePackage}: missing entry ${target}`);
    if (!packedFiles.has(relativeTarget)) {
      fail(`${relativePackage}: npm pack omits entry ${target}`);
    }
  }

  for (const required of ["package.json", "README.md", "LICENSE", "NOTICE"]) {
    if (!packedFiles.has(required)) fail(`${relativePackage}: npm pack omits ${required}`);
  }

  const forbidden = [...packedFiles].filter((path) =>
    /(^|\/)(node_modules|coverage|site-dist|\.git)(\/|$)|\.tgz$/i.test(path),
  );
  if (forbidden.length > 0) {
    fail(`${relativePackage}: npm pack contains forbidden files: ${forbidden.join(", ")}`);
  }

  console.log(`${relativePackage}: ${targets.length} entry points, ${packedFiles.size} packed files`);
}

console.log("Lineage package contracts verified.");
