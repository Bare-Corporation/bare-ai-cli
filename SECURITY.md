# Security Policy

## Supported Versions

Bare-AI CLI is actively maintained. Only the latest release on `main` is
supported for security updates.

| Version | Supported          |
| ------- | ------------------ |
| main    | :white_check_mark: |
| older   | :x:                |

## Reporting a Vulnerability

**Please do not open a public issue for security vulnerabilities.**

Report vulnerabilities privately to the Bare-Corporation security team:

- **Email:** `security@bare-ai.net`
- **GitHub private disclosure:** use the "Report a vulnerability" button on the
  repository's _Security_ tab (preferred — it creates a private advisory).

Include in your report:

1. The affected component and file/line references where possible.
2. A minimal proof-of-concept or reproduction steps.
3. Impact assessment (what an attacker could achieve).

We will acknowledge receipt within 2 business days and aim to triage within 5
business days. We coordinate disclosure after a fix is available.

## Scope & Notes

Bare-AI CLI is a sovereign fork of the Google Gemini CLI (Apache-2.0). Where a
vulnerability originates from the upstream Gemini CLI codebase, we coordinate
with upstream disclosure in addition to fixing the fork.

Secrets, API keys, and Vault/OpenBao credentials must never be committed to this
repository. The repository ships a gitleaks pre-commit hook and a fail-closed CI
secret-scan gate; a finding blocks the push/PR.
