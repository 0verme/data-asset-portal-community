# Security Policy

## Supported versions

Security fixes are provided for the latest stable release.

## Reporting a vulnerability

Do not open a public issue for a suspected vulnerability. Use GitHub's private **Report a
vulnerability** flow in the repository Security tab. Include the affected version, a minimal
synthetic reproduction, the expected impact, and any suggested mitigation.

Do not include production lineage data, credentials, internal URLs, or personal information.
Maintainers will acknowledge a complete report within seven days and coordinate disclosure after
a fix is available.

## Scope

The viewer treats labels and expressions as text and does not execute lineage input. Security
reports are especially useful for escaping, package-boundary, dependency, and demo-site issues.
Host applications remain responsible for validating their inputs and access controls.
