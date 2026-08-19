<!-- Thank you for contributing to data-asset-portal! -->

## What does this change do?

<!-- One or two sentences: the user-visible change, not the file list. -->

## Why is this change needed?

<!-- Link the issue if there is one, and describe the problem being solved. -->

Closes #

## Breaking change

<!-- Select one and explain any migration required. -->

- [ ] No
- [ ] Yes — migration or compatibility notes are included below

## How was it tested?

<!-- List commands run and their results. Mark irrelevant checks as N/A and
     explain why; do not check a test that was not run. For example:
     python -m unittest discover -s backend/tests
     cd frontend && npm test && npm run build
-->

- [ ] Backend tests pass
- [ ] Frontend tests pass
- [ ] Frontend build passes
- [ ] Migration verify passes (SQLite / PostgreSQL / DWS)
- [ ] Public data guard passes: `python demo/validate_demo_data.py --strict`

Not applicable checks and reason:

## Migration / schema

<!-- Did this change the schema? If yes: which migration version/dialect,
     and was repeat-apply verified as a no-op? If no, write "None". -->

## Screenshots

<!-- For UI changes: add before/after screenshots or screen recordings.
     Make sure they contain no internal/private data. -->

## Sensitive data check

- [ ] No private/internal data, secrets, credentials, or real connection
      strings included in this PR (code, docs, logs, screenshots)
- [ ] Community boundary unchanged, or boundary changes are explicitly
      documented (private tables / modules / routes)
