import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const DEFAULT_REPOSITORY = "0verme/data-asset-portal-community";

const FRONTEND_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const STABLE_RELEASE_TAG = /^v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
const REPOSITORY_SLUG = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;

export function parseStableReleaseTag(tag) {
  if (typeof tag !== "string" || !STABLE_RELEASE_TAG.test(tag)) {
    throw new Error(`Expected a stable GitHub Release tag in vX.Y.Z format; received ${JSON.stringify(tag)}`);
  }
  return { tag, version: tag.slice(1) };
}

function resolveRepository(repository) {
  const value = repository?.trim() || DEFAULT_REPOSITORY;
  if (!REPOSITORY_SLUG.test(value)) {
    throw new Error(`Invalid GitHub repository slug: ${JSON.stringify(value)}`);
  }
  return value;
}

export function releaseMetadataForTag(tag, repository = DEFAULT_REPOSITORY, source = "override") {
  const { tag: stableTag } = parseStableReleaseTag(tag);
  const repo = resolveRepository(repository);
  const encodedTag = encodeURIComponent(stableTag);
  const repositoryUrl = `https://github.com/${repo}`;
  return Object.freeze({
    version: stableTag,
    releaseUrl: `${repositoryUrl}/releases/tag/${encodedTag}`,
    repositoryUrl,
    source,
  });
}

async function resolvePublishedReleaseEvent(env, repository, eventPayload) {
  let payload = eventPayload;
  if (!payload) {
    const eventPath = env.GITHUB_EVENT_PATH?.trim();
    if (!eventPath) {
      throw new Error("Release event is missing GITHUB_EVENT_PATH; refusing to infer a version from a branch or package.json");
    }
    try {
      payload = JSON.parse(await readFile(eventPath, "utf8"));
    } catch (error) {
      throw new Error(`Could not read the GitHub Release event payload: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  const release = payload?.release;
  if (payload?.action !== "published" || release?.draft !== false || release?.prerelease !== false) {
    throw new Error("Release builds require a published, non-draft, stable GitHub Release event");
  }

  const tag = parseStableReleaseTag(release.tag_name).tag;
  const refTag = env.GITHUB_REF?.startsWith("refs/tags/") ? env.GITHUB_REF.slice("refs/tags/".length) : null;
  if (refTag && refTag !== tag) {
    throw new Error(`GitHub Release event tag ${tag} does not match checked-out ref ${refTag}`);
  }
  return releaseMetadataForTag(tag, repository, "release-event");
}

async function resolveLatestPublishedRelease(repository, env, fetchImpl) {
  const apiUrl = `https://api.github.com/repos/${repository}/releases/latest`;
  const token = env.DAP_RELEASE_TOKEN?.trim() || env.GITHUB_TOKEN?.trim();
  const headers = {
    accept: "application/vnd.github+json",
    "user-agent": "data-asset-portal-release-metadata",
    "x-github-api-version": "2022-11-28",
  };
  if (token) headers.authorization = `Bearer ${token}`;

  let response;
  try {
    response = await fetchImpl(apiUrl, {
      headers,
      signal: AbortSignal.timeout(10_000),
    });
  } catch (error) {
    throw new Error(`Could not reach the GitHub Releases API at ${apiUrl}: ${error instanceof Error ? error.message : String(error)}. Build stopped; no fallback version is used.`);
  }
  if (!response.ok) {
    throw new Error(`GitHub Releases API returned HTTP ${response.status} for ${apiUrl}. Build stopped; no fallback version is used.`);
  }

  let release;
  try {
    release = await response.json();
  } catch (error) {
    throw new Error(`GitHub Releases API returned invalid JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (release?.draft !== false || release?.prerelease !== false) {
    throw new Error("GitHub Releases API did not return a published stable Release; build stopped");
  }
  return releaseMetadataForTag(release.tag_name, repository, "github-api");
}

export async function resolveReleaseMetadata({
  env = process.env,
  fetchImpl = globalThis.fetch,
  eventPayload,
} = {}) {
  const repository = resolveRepository(env.GITHUB_REPOSITORY);
  if (env.GITHUB_EVENT_NAME === "release") {
    return resolvePublishedReleaseEvent(env, repository, eventPayload);
  }
  const override = env.DAP_RELEASE_TAG?.trim();
  if (override) return releaseMetadataForTag(override, repository, "override");
  if (typeof fetchImpl !== "function") {
    throw new Error("This Node.js runtime has no fetch implementation; cannot resolve the latest GitHub Release");
  }
  return resolveLatestPublishedRelease(repository, env, fetchImpl);
}

export async function assertPackageReleaseVersion(tag, frontendRoot = FRONTEND_ROOT) {
  const { version } = parseStableReleaseTag(tag);
  let packageJson;
  let packageLock;
  try {
    [packageJson, packageLock] = await Promise.all([
      readFile(resolve(frontendRoot, "package.json"), "utf8").then(JSON.parse),
      readFile(resolve(frontendRoot, "package-lock.json"), "utf8").then(JSON.parse),
    ]);
  } catch (error) {
    throw new Error(`Could not read frontend package version files: ${error instanceof Error ? error.message : String(error)}`);
  }

  const actual = {
    "package.json": packageJson.version,
    "package-lock.json": packageLock.version,
    "package-lock.json packages['']": packageLock.packages?.[""]?.version,
  };
  const mismatches = Object.entries(actual)
    .filter(([, current]) => current !== version)
    .map(([path, current]) => `${path}=${JSON.stringify(current)}`);
  if (mismatches.length) {
    throw new Error(`Frontend package versions must match latest stable Release ${version}; found ${mismatches.join(", ")}`);
  }
  return version;
}
