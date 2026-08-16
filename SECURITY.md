# Security Policy

## Supported Versions

We follow semantic versioning for this project.

| Version | Supported          |
| ------- | ------------------ |
| latest stable release | ✅ Supported |
| older releases | ⚠️ Best effort, no SLA |

Security fixes are backported to the latest stable release. If you need a fix
in an older release, please report it and we will evaluate backporting.

## Reporting a Vulnerability

**Do not open a public issue** for security problems — a public issue reveals
the vulnerability to everyone before it is fixed.

Please report privately through one of the channels below:

1. **GitHub Security Advisories** — the preferred channel. Use the
   *Report a vulnerability* button on the repository's
   **Security** tab (private, visible only to maintainers).
2. If a private-advisory workflow is not yet available on the repository,
   open a private support conversation with the maintainers through GitHub's
   built-in *Security* reporting instead.

### What to include

- Affected version(s) / commit(s) you tested
- The component (backend, frontend, lineage-viewer, migrations, docs)
- Database / runtime context (SQLite, PostgreSQL, GaussDB/DWS)
- Steps to reproduce (a minimal test case is ideal)
- Impact description (data exposure, DoS, privilege escalation, ...)
- Any proposed fix, if you have one

You can report in English or Chinese.

## Handling Principles

We do **not** commit to a fixed response SLA (such as "24 hours"), because a
community-maintained project cannot guarantee one. In practice we aim to:

1. Acknowledge the report within a few business days.
2. Triage severity and confirm exploitability.
3. Develop and test a fix, then release it.
4. Publish an advisory with credit to the reporter (unless anonymity is requested).

## Secrets and Sensitive Data

- Never commit credentials, tokens, private keys, `.env` / `.env.local` files,
  database dumps, or internal host names to this repository — including in
  issues, PRs, or commit messages.
- The CI pipeline runs a public data guard that blocks such content, but the
  guard is a safety net, not a substitute for care.
- If you accidentally commit a secret, rotate it immediately and then report
  it privately — do not rely on deleting the file or rewriting history.

## Scope

This policy covers the `data-asset-portal` Community Edition. Third-party
dependencies are reported to their respective maintainers.
