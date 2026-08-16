# Release readiness

Before publishing a release, run this checklist from a clean working tree. Phase 8 establishes this process only; it does not publish, push, create a release, or deploy Pages.

- [ ] Confirm `lineage-viewer`, `@lineage-viewer/domain-adapter`, and `@lineage-viewer/react` use the same intended version; update `CHANGELOG.md`.
- [ ] Confirm `README.md` install examples and [public API](public-api.md) match the package entry points.
- [ ] Run `npm run format` and inspect the intended formatting changes.
- [ ] Run `npm run lint`, `npm run typecheck`, and `npm test`.
- [ ] Install Playwright Chromium when needed, then run `npm run test:e2e`.
- [ ] Run `npm run build` and `npm run build:site`.
- [ ] Run `npm run test:package` to build, pack, install, typecheck, build, and browser-smoke-test temporary consumers.
- [ ] Run `npm run pack:check` and `npm pack --dry-run`; confirm the root package and both workspace packages are packable, include their JavaScript, declarations, `README.md`, and `package.json` (plus root `LICENSE` and `NOTICE`), and exclude private/reference/test/report/cache/site artifacts.
- [ ] Manually inspect all three tarball file lists and verify package files contain no absolute or repository-external paths.
- [ ] Confirm the release workflow publishes all three public npm packages with the same tag and dist-tag; do not commit registry credentials.
- [ ] Run `git diff --check` and `git status --short`; remove generated tarballs, consumer `node_modules`, and temporary artifacts.
- [ ] Run the Pages/site build check appropriate to the repository workflow before enabling or publishing Pages.
