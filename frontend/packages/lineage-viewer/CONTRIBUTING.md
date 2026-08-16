# Contributing

Thanks for helping improve lineage-viewer.

## Before you start

- Search existing issues before opening a new one.
- Keep proposals focused on lineage visualization, adapters, documentation, or integration examples.
- Discuss breaking API or schema changes in an issue before implementation.
- Use synthetic data in tests, fixtures, screenshots, and documentation.

## Development

Use Node.js 22.13 or newer:

```sh
npm ci
npm run check
```

For browser behavior changes, also run:

```sh
npx playwright install chromium
npm run test:e2e
npm run test:e2e:site
```

For adapter changes, run the corresponding Python tests and Ruff checks documented in the root
`package.json`.

## Pull requests

- Explain the user-visible outcome and compatibility impact.
- Add or update tests for changed behavior.
- Update the README, public API documentation, and changelog when applicable.
- Do not include credentials, production metadata, internal table names, or customer data.

By contributing, you agree that your contribution is licensed under Apache-2.0.
