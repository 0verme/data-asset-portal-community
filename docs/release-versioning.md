# Frontend release version

The latest published stable GitHub Release is the only source of the frontend's formal version. The build resolves its `vX.Y.Z` tag before Vite starts, then embeds the version, release link, and repository link in the static bundle. The browser makes no GitHub API request, so an already deployed bundle keeps the version it was built with.

## Build behavior

- A build running for a published stable GitHub Release uses that event's tag after validating the event payload. It does not wait for the post-release package sync to update `main`.
- Main, pull request, local development, and ordinary local builds query the repository's latest stable Release through the GitHub Releases API.
- Drafts, prereleases, malformed tags, network errors, and API errors stop startup/build with an error. There is no fixed-version fallback.
- For a deliberate local scenario, set `DAP_RELEASE_TAG` to a validated tag such as `v0.2.6`. This bypasses the API and the package-version comparison for that run; it does not change package files or create a Release.
- CI checks that `frontend/package.json` and both root version fields in `frontend/package-lock.json` match the latest stable Release.

## Release flow

1. Merge ordinary pull requests as usual. They do not change the frontend package version or create a Release.
2. Publish a stable GitHub Release through the existing Release Drafter workflow and normal release process.
3. The `Sync Frontend Release Version` workflow updates the root npm package and lockfile to the published tag. It does not run for drafts or prereleases, create a Release, or deploy an environment.
4. Rebuild and deploy the desired frontend artifact. The version appears after that deployment; a previously deployed bundle continues to show its original version.

The public static Demo at `data.overme.cn` remains independently built and deployed. This repository workflow does not publish it automatically. Remote mode, local Mock mode, and the separately built static Mock artifact use the same injected release metadata while retaining their existing API mode and deployment behavior.
