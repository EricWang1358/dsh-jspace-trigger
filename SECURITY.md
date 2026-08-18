# Security Policy

## Supported versions

Only the latest published release of `dsh-jspace-trigger` receives security
fixes. The project currently ships against DeepSeek Harness (DSH) `0.1.0-rc.x`
(`@deepseek-ai/cordis` `>=4.0.0-rc <5`).

| Version | Supported          |
| ------- | ------------------ |
| 0.2.x   | :white_check_mark: |
| < 0.2   | :x:                |

## Reporting a vulnerability

**Do not open a public issue for a security problem.**

Please report vulnerabilities privately by emailing the maintainer
(EricWang1358) via GitHub's private vulnerability reporting ("Report a
vulnerability" on the repository's Security tab) or a direct message.

Please include:

1. The affected version.
2. A description of the issue and its potential impact.
3. Reproduction steps or a proof of concept.
4. Any known mitigations.

You will receive an acknowledgment within 7 days and, when confirmed, a fix
timeline. Security fixes are released as patch releases and credited (with your
permission) in the release notes.

## Security model and guarantees

This plugin is intentionally dependency-free at runtime (Node built-ins only)
and never stores user prompt text or tool arguments. Its surface area:

- Reads `session/event` events and appends a `source.kind: 'plugin'` nudge to
  an agent inbox.
- Stores only rule/delivery/tool-name metadata in a bounded in-memory funnel.
- Optionally clones the J-Space skill repository **only** when the user
  explicitly invokes `jspace_install_skill`; it never downloads on its own.

When you find a way to break any of those guarantees (e.g. user text leaking
into analytics, unintended network access, injection into the system prompt),
report it as a vulnerability.
