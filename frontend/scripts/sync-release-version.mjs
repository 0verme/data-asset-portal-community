import { appendFile, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { parseStableReleaseTag, resolveLatestStableRelease } from "./release-metadata.mjs";

const DEFAULT_FRONTEND_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

export async function syncReleaseVersion(
  tag,
  frontendRoot = DEFAULT_FRONTEND_ROOT,
  { env = process.env, fetchImpl = globalThis.fetch } = {},
) {
  const { tag: stableTag, version } = parseStableReleaseTag(tag);
  const latestRelease = await resolveLatestStableRelease({ env, fetchImpl });
  if (stableTag !== latestRelease.version) {
    return { shouldSync: false, version, latestTag: latestRelease.version };
  }

  const packagePath = resolve(frontendRoot, "package.json");
  const lockPath = resolve(frontendRoot, "package-lock.json");
  const [packageJson, packageLock] = await Promise.all([
    readFile(packagePath, "utf8").then(JSON.parse),
    readFile(lockPath, "utf8").then(JSON.parse),
  ]);
  if (!packageLock.packages?.[""]) {
    throw new Error("package-lock.json is missing the root packages[''] entry; refusing to write an incomplete version sync");
  }

  packageJson.version = version;
  packageLock.version = version;
  packageLock.packages[""].version = version;
  await Promise.all([
    writeFile(packagePath, `${JSON.stringify(packageJson, null, 2)}\n`),
    writeFile(lockPath, `${JSON.stringify(packageLock, null, 2)}\n`),
  ]);
  return { shouldSync: true, version, latestTag: latestRelease.version };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const tag = process.argv[2] || process.env.RELEASE_TAG;
  if (!tag) throw new Error("Usage: node scripts/sync-release-version.mjs vX.Y.Z");
  const result = await syncReleaseVersion(tag);
  const outputPath = process.argv[3] || process.env.GITHUB_OUTPUT;
  if (outputPath) {
    await appendFile(outputPath, `should_sync=${result.shouldSync}\nlatest_tag=${result.latestTag}\n`);
  }
  if (result.shouldSync) {
    console.log(`Synchronized frontend package.json and package-lock.json to ${result.version}.`);
  } else {
    console.log(`Skipped ${tag}: latest stable Release is ${result.latestTag}; package files were not changed.`);
  }
}
