import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import test from "node:test";

import {
  assertPackageReleaseVersion,
  parseStableReleaseTag,
  resolveReleaseMetadata,
} from "./release-metadata.mjs";
import { syncReleaseVersion } from "./sync-release-version.mjs";

const API_RELEASE = {
  draft: false,
  prerelease: false,
  tag_name: "v0.2.6",
};

test("explicit local tag is validated and resolves all build links without a network request", async () => {
  const metadata = await resolveReleaseMetadata({ env: { DAP_RELEASE_TAG: "v0.2.6" }, fetchImpl: () => assert.fail("override must not call GitHub") });
  assert.deepEqual(metadata, {
    version: "v0.2.6",
    releaseUrl: "https://github.com/0verme/data-asset-portal-community/releases/tag/v0.2.6",
    repositoryUrl: "https://github.com/0verme/data-asset-portal-community",
    source: "override",
  });
});

test("main and ordinary PR builds resolve the latest stable release from GitHub", async () => {
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push({ url, options });
    return { ok: true, json: async () => API_RELEASE };
  };
  const main = await resolveReleaseMetadata({ env: { GITHUB_REF: "refs/heads/main" }, fetchImpl });
  const pullRequest = await resolveReleaseMetadata({ env: { GITHUB_EVENT_NAME: "pull_request", GITHUB_REF: "refs/pull/615/merge" }, fetchImpl });
  assert.equal(main.version, "v0.2.6");
  assert.equal(pullRequest.version, "v0.2.6");
  assert.equal(calls.length, 2);
  assert.equal(calls[0].url, "https://api.github.com/repos/0verme/data-asset-portal-community/releases/latest");
});

test("published release builds use the validated event tag", async () => {
  const metadata = await resolveReleaseMetadata({
    env: { GITHUB_EVENT_NAME: "release", GITHUB_REF: "refs/tags/v0.2.7" },
    eventPayload: { action: "published", release: { draft: false, prerelease: false, tag_name: "v0.2.7" } },
    fetchImpl: () => assert.fail("release event must not query latest or drift to a later release"),
  });
  assert.equal(metadata.version, "v0.2.7");
  assert.equal(metadata.source, "release-event");
});

test("API failures and non-stable or malformed tags fail instead of using a fixed version", async () => {
  await assert.rejects(
    resolveReleaseMetadata({ env: {}, fetchImpl: async () => ({ ok: false, status: 503 }) }),
    /HTTP 503.*no fallback version is used/,
  );
  await assert.rejects(
    resolveReleaseMetadata({ env: {}, fetchImpl: async () => ({ ok: true, json: async () => ({ ...API_RELEASE, prerelease: true }) }) }),
    /published stable Release/,
  );
  assert.deepEqual(parseStableReleaseTag("v0.2.6"), { tag: "v0.2.6", version: "0.2.6" });
  for (const invalid of ["V0.2.6", "0.2.6", "v0.2.7-rc.1", "v01.2.3"]) {
    assert.throws(() => parseStableReleaseTag(invalid), /vX\.Y\.Z/);
  }
});

test("Release sync updates only the npm root package and lockfile versions", async () => {
  const frontendRoot = await mkdtemp(resolve(tmpdir(), "dap-release-version-"));
  try {
    await writeFile(resolve(frontendRoot, "package.json"), `${JSON.stringify({ name: "dap", version: "0.2.0" }, null, 2)}\n`);
    await writeFile(resolve(frontendRoot, "package-lock.json"), `${JSON.stringify({ name: "dap", version: "0.2.0", packages: { "": { name: "dap", version: "0.2.0" }, "node_modules/demo": { version: "1.0.0" } } }, null, 2)}\n`);
    const result = await syncReleaseVersion("v0.2.7", frontendRoot, {
      env: {},
      fetchImpl: async () => ({ ok: true, json: async () => ({ draft: false, prerelease: false, tag_name: "v0.2.7" }) }),
    });
    assert.deepEqual(result, { shouldSync: true, version: "0.2.7", latestTag: "v0.2.7" });
    await assertPackageReleaseVersion("v0.2.7", frontendRoot);
    const lock = JSON.parse(await readFile(resolve(frontendRoot, "package-lock.json"), "utf8"));
    assert.equal(lock.packages["node_modules/demo"].version, "1.0.0");
  } finally {
    await rm(frontendRoot, { recursive: true, force: true });
  }
});

test("a published non-latest stable Release is skipped without changing package files", async () => {
  const frontendRoot = await mkdtemp(resolve(tmpdir(), "dap-release-version-stale-"));
  try {
    const packagePath = resolve(frontendRoot, "package.json");
    const lockPath = resolve(frontendRoot, "package-lock.json");
    const packageContents = `${JSON.stringify({ name: "dap", version: "0.2.6" }, null, 2)}\n`;
    const lockContents = `${JSON.stringify({ name: "dap", version: "0.2.6", packages: { "": { name: "dap", version: "0.2.6" } } }, null, 2)}\n`;
    await writeFile(packagePath, packageContents);
    await writeFile(lockPath, lockContents);
    const result = await syncReleaseVersion("v0.1.9", frontendRoot, {
      env: {},
      fetchImpl: async () => ({ ok: true, json: async () => ({ draft: false, prerelease: false, tag_name: "v0.2.6" }) }),
    });
    assert.deepEqual(result, { shouldSync: false, version: "0.1.9", latestTag: "v0.2.6" });
    assert.equal(await readFile(packagePath, "utf8"), packageContents);
    assert.equal(await readFile(lockPath, "utf8"), lockContents);
  } finally {
    await rm(frontendRoot, { recursive: true, force: true });
  }
});

test("prerelease, invalid latest tag, and API failure all fail without writing versions", async () => {
  const frontendRoot = await mkdtemp(resolve(tmpdir(), "dap-release-version-fail-"));
  try {
    const packagePath = resolve(frontendRoot, "package.json");
    const lockPath = resolve(frontendRoot, "package-lock.json");
    const packageContents = `${JSON.stringify({ name: "dap", version: "0.2.6" }, null, 2)}\n`;
    const lockContents = `${JSON.stringify({ name: "dap", version: "0.2.6", packages: { "": { name: "dap", version: "0.2.6" } } }, null, 2)}\n`;
    await writeFile(packagePath, packageContents);
    await writeFile(lockPath, lockContents);
    await assert.rejects(
      syncReleaseVersion("v0.2.7-rc.1", frontendRoot, { env: {}, fetchImpl: () => assert.fail("invalid event tag must be rejected before API access") }),
      /vX\.Y\.Z/,
    );
    await assert.rejects(
      syncReleaseVersion("v0.2.6", frontendRoot, { env: {}, fetchImpl: async () => ({ ok: false, status: 503 }) }),
      /HTTP 503.*no fallback version is used/,
    );
    await assert.rejects(
      syncReleaseVersion("v0.2.6", frontendRoot, { env: {}, fetchImpl: async () => ({ ok: true, json: async () => ({ draft: false, prerelease: false, tag_name: "v0.2.6-beta" }) }) }),
      /vX\.Y\.Z/,
    );
    assert.equal(await readFile(packagePath, "utf8"), packageContents);
    assert.equal(await readFile(lockPath, "utf8"), lockContents);
  } finally {
    await rm(frontendRoot, { recursive: true, force: true });
  }
});
