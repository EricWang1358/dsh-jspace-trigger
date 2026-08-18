# dsh-jspace-trigger

> **Configurable, near-field trigger for J-Space in DeepSeek Harness.**\
> No blanket injection. No forced system prompt. Only prompt the model to load `j-space` when rules say it is worth it.

<p align="center">
  <a href="./README.zh-CN.md">简体中文</a> ·
  <a href="docs/design.md">Design</a> ·
  <a href="CONTRIBUTING.md">Contributing</a> ·
  <a href="https://github.com/EricWang1358/dsh-jspace-trigger/issues">Issues</a>
</p>

<p align="center">
  <a href="https://github.com/EricWang1358/dsh-jspace-trigger/actions/workflows/ci.yml"><img alt="CI" src="https://img.shields.io/github/actions/workflow/status/EricWang1358/dsh-jspace-trigger/ci.yml?branch=main&style=flat-square"></a>
  <a href="./LICENSE"><img alt="License" src="https://img.shields.io/badge/license-MIT-blue?style=flat-square"></a>
  <a href="./package.json"><img alt="Node" src="https://img.shields.io/badge/node-%3E%3D20-green?style=flat-square"></a>
  <a href="./SECURITY.md"><img alt="Security" src="https://img.shields.io/badge/security-policy-8A2BE2?style=flat-square"></a>
</p>

---

## What is this?

`dsh-jspace-trigger` is a lightweight DeepSeek Harness (DSH) plugin that decides **when** to remind the agent to use the [J-Space Cognition Suite](https://github.com/Tiger3807861189/J-Space-Cognition-Suite-V3.6).

It does **not** inject J-Space every turn. Instead:

- It watches **real user messages**.
- It evaluates **configurable rules**: regex / keywords / length / score / explicit commands.
- Only when a rule fires does it append a small **near-field** nudge to the agent inbox.
- When nothing fires, it stays completely silent.

## Compatibility

| DSH runtime | Status |
| --- | --- |
| DSH `0.1.0-rc.7` (`@deepseek-ai/cordis` `4.x`) | ✅ verified against installed type contracts |
| later `0.1.0-rc.x` | expected compatible; report issues otherwise |
| `< 0.1.0-rc.7` | unsupported (event/data shapes differ) |

This plugin is **runtime dependency-free** (Node built-ins only). It pegs
`peerDependencies` to `@deepseek-ai/cordis >=4.0.0-rc <5` and the DSH service
packages so npm can warn on major mismatches without bundling anything.

## Why?

Plain J-Space as a DSH skill is available but not automatic. A fixed J-Space system-prompt injection is too noisy for simple tasks.

This plugin is the middle ground:

| Mode | Behavior |
| --- | --- |
| `near-field` (default) | Matched tasks receive one short nudge in the inbox; everything else is silent |
| `none` | Observe-only: rules still run and metrics still update, but **no message is ever injected** |

## Features

- **No blanket injection** — no J-Space section forced into every system prompt.
- **Configurable rule engine** — regex/keyword patterns, `any` / `all` / `score` matching, rule-local thresholds, and opt-out exclusions.
- **Length fallback** — long non-chat messages can automatically route to `full` or `loop`.
- **Session-safe delivery** — a hit in one session is never delivered to an agent from another session.
- **Deduplication** — one event triggers at most one nudge.
- **Observe-only mode** — `injectMode: none` gives pure telemetry without touching the conversation.
- **Skill detection & guided install** — `jspace_trigger_status` reports whether `j-space` is installed; triggered nudges include a missing-skill hint, and `jspace_install_skill` installs it explicitly.
- **Runtime metrics** — `jspace_trigger_status` reports events, triggers, injections, and observe-only hits.
- **Invocation funnel analysis** — `jspace_trigger_analytics` connects a rule hit to delivery and following tool calls, including whether the `j-space` skill was actually loaded.
- **Dry-run tool** — `jspace_trigger_test` shows exactly what the current config would do.

## Quick start

### Prerequisites

- DSH web profile installed and working.
- [J-Space Cognition Suite](https://github.com/Tiger3807861189/J-Space-Cognition-Suite-V3.6) installed as a DSH skill, e.g. at `~/.agents/skills/j-space/`.

### Install

From GitHub (recommended for end users):

```powershell
dsh plugin --profile web add "github:EricWang1358/dsh-jspace-trigger"
```

Or, install the packed tarball from a local clone or a [GitHub release](https://github.com/EricWang1358/dsh-jspace-trigger/releases):

```powershell
dsh plugin --profile web add "<path-or-url-to>/dsh-jspace-trigger-<version>.tgz"
```

Local development link (replace `<repo>` with your own clone path):

```powershell
dsh plugin --profile web add "link:<repo>"
```

Then restart:

```powershell
dsh --profile web
```

### Verify

```powershell
dsh --profile web --dump-config | Select-String dsh-jspace-trigger
```

After restart, the tools `jspace_trigger_status`, `jspace_trigger_test`, `jspace_trigger_analytics`, and `jspace_install_skill` are available to the agent.

### Marketplace discoverability

This is a **host bundle plugin**: `package.json` declares
`dsh.bundle.patch = ./cordis.patch.yml`, which is what DSH plugin markets use to
classify it as an `plugin` (auto-enable-able) rather than a `client` or
`nonplugin`. For the GitHub-topic-driven markets, the repository must carry the
`dsh-plugin` GitHub topic — with a non-empty repository description, so search
and one-click install can find it.

```text
GitHub topic: dsh-plugin  (plus: dsh, dsh-bundle, j-space)
```

Keepers of a fork: add the topic via `gh repo edit <owner>/<repo> --add-topic dsh-plugin`.

## How triggering works today

Priority order (first match wins, short-circuit):

```text
built-in opt-out (always first) > explicit > ignore/chat > workspace-research > loop > research > complex > length fallback > none
```

The opt-out rule (`jspace-optout`) is **built in and always evaluated first**,
even when you supply a custom `rules` array, so an explicit "不要使用 j-space /
do not use j-space" can never be overridden by a content keyword. The `chat`
rule is configurable too: if you redefine `chat`, your patterns replace the
hardcoded greeting list; if you drop it, a minimal built-in greeting guard still
keeps one-word pleasantries silent.

### Default rules

| Rule | Examples | Decision |
| --- | --- | --- |
| `explicit` | `/j-space`, `use j-space`, `启用 j-space`, `加载 j-space` | `loop` + `capacity, broadcast` |
| `jspace-optout` | `不需要使用 j-space`, `do not use j-space` | **ignore** (silent; overrides complexity signals) |
| `chat` | `你好`, `hello`, `thanks`, `ok`, `嗯` | **ignore** (silent) |
| `workspace-research` | 文件夹/目录/仓库 + 调研/盘点/画像等综合意图 | `loop` + `capacity, broadcast, markers, self-monitoring` |
| `loop` | 仓库级、跨文件、多阶段、多轮、long-horizon、multi-file | `loop` + `capacity, broadcast, markers, self-monitoring` |
| `research` | 调研、盘点、梳理、尽调、research、survey | `full` + `deep-reasoning, self-monitoring` |
| `complex` | 重构、架构、全面、详细、调试、审查、refactor、architecture | `full` + `deep-reasoning, self-monitoring` |

### Real trigger examples

```text
# explicit -> loop
/j-space 请审计这个仓库并跨文件保持一致

# loop keywords -> loop
做一个仓库级跨文件重构，并保持全局一致

# workspace-research -> loop (two independent signals)
深度调研此文件夹下的内容、TODO 和 DDL，梳理现状与潜在风险

# research intent -> full
调研一下这个技术方案的可行性

# complex keywords -> full
详细分析一下这个项目的架构，并检查潜在风险

# long fallback -> full
超过 120 个字符的非寒暄任务……

# long fallback -> loop
超过 1800 个字符的多阶段长任务……

# chat -> silent
你好
```

### Dry-run a message

```text
jspace_trigger_test "仓库级跨文件重构"
```

Expected output shape:

```text
action=trigger
pass=loop
modules=capacity,broadcast,markers,self-monitoring
matched=loop
reason=rule:loop
matchMode=any
hits=2
threshold=1
signals=多阶段|多个文件|多轮|长程|长期|仓库级|跨文件|系统化|完整项目|长时|agentic|long-horizon|multi-stage|multi-file|multi-turn|repository-wide|workflow|loop
skillInstalled=true
---
[jspace-trigger] J-space pass: loop. Suggested modules: capacity, broadcast, markers, self-monitoring. If this task needs structured workspace control, load the `j-space` skill and follow its gate.
```

### Observe-only mode

Set in `cordis.patch.yml`:

```yaml
config:
  injectMode: none
```

In this mode matched events are recorded in `jspace_trigger_status` but **never injected** into any session.

### Analyze real invocations

`jspace_trigger_analytics` is a bounded in-memory funnel for checking whether a nudge was useful:

```text
jspace_trigger_analytics scope=current limit=20
```

It reports `rule -> delivery -> toolCalls -> jspaceSkillLoaded`. It deliberately stores no user-message text and no tool arguments—only timestamps, session/event IDs, rule/pass metadata, delivery outcome, and tool names. Set `analytics.enabled: false` to disable it, or use `maxRecords` (1–500) to bound the retained recent records.

## Skill detection & installation

The plugin never downloads or installs J-Space automatically. It only checks and helps when you ask.

- `jspace_trigger_status` reports `skillInstalled` and installed paths.
- When the skill is missing, triggered nudges append:
  ```text
  J-Space skill is not installed. Run `jspace_install_skill` to install it.
  ```
- `jspace_install_skill` explicitly clones the upstream repository and copies `j-space/` into your configured skill root.

### Install the skill manually

```powershell
jspace_install_skill
```

To force a reinstall:

```powershell
jspace_install_skill force=true
```

To install into a custom root:

```powershell
jspace_install_skill root="C:\path\to\skills"
```

## Coexistence with routing presets

This plugin does not change a preset's persona or tool surface. It only appends a
near-field message after a matched real user message. The following combinations
therefore have no tool-name or system-prompt collision, but may affect whether a
guide is visible to the model.

### Router Standard

When Router Standard selects its `weak` band, it appends its own routing guide
after each real user message. If a J-Space rule also matches, the session can
receive **two** near-field guides: Router Standard's build/fix guidance and this
plugin's J-Space suggestion.

`dsh-jspace-trigger` deliberately does not detect or mute Router Standard. If
you want Router Standard to be the only near-field guide, use observe-only mode:

```yaml
config:
  injectMode: none
```

Otherwise, the two messages are compatible but add prompt noise. This is most
likely for a `weak`-band task containing J-Space complexity keywords such as
`详细` or `分析`.

### 梁神模式 (Liangshen / anchored standard)

梁神模式的首轮锚定阶段只允许真实用户消息到达模型。本插件的提示使用
`source.kind: plugin`，因此即使规则命中，首轮提示也会被梁神模式过滤；这
保护了它的 Minimal 锚定，不是错误。模式晋升后，本插件的后续提示可以正常
参与会话。

如果你要保持全程最纯净的梁神模式轨迹，同样建议使用 `injectMode: none`；
如果希望在完成首轮锚定后获得 J-Space 建议，则保持默认 `near-field` 即可。

## Configuration

Configuration lives in the plugin `config`, normally edited in `cordis.patch.yml`.

```yaml
- insert:
    - id: jspace-trigger
      name: dsh-jspace-trigger
      config:
        enabled: true
        injectMode: near-field      # near-field | none
        analytics:
          enabled: true             # metadata only; no prompts or tool arguments
          maxRecords: 50            # bounded to 1..500
        trigger:
          minScore: 1               # threshold only for matchMode: score
          loopChars: 1800           # text longer than this -> loop fallback
          fullChars: 120            # text longer than this -> full fallback
          rules:
            - id: explicit
              action: trigger
              pass: loop
              excludePatterns: ["不要使用 j-space", "do not use j-space"]
              modules: [capacity, broadcast]
              patterns: ["/j-space", "use j-space"]

            - id: chat
              action: ignore
              patterns: ["^你好[!。.!？?~～]*$", "^(hello|hi|thanks|ok)[!。.!？?~～]*$"]

            - id: workspace-research
              action: trigger
              pass: loop
              matchMode: all
              modules: [capacity, broadcast, markers, self-monitoring]
              patterns:
                - "文件夹|目录|仓库|代码库|工作区|(?:todo|ddl).*(?:文件|列表|状态)|(?:文件|列表).*(?:todo|ddl)|folder|directory|repository|repo|workspace"
                - "调研|盘点|梳理|画像|审计|研究|分析|了解|research|survey|audit"

            - id: loop
              action: trigger
              pass: loop
              modules: [capacity, broadcast, markers, self-monitoring]
              patterns: ["多阶段|多文件|跨文件|长程|仓库级", "long-horizon|multi-file|repository-wide"]

            - id: research
              action: trigger
              pass: full
              modules: [deep-reasoning, self-monitoring]
              patterns: ["调研|盘点|梳理|尽调|研究|调查|research|investigate|survey"]

            - id: complex
              action: trigger
              pass: full
              modules: [deep-reasoning, self-monitoring]
              patterns: ["重构|架构|全面|调试|审查", "refactor|architecture|debug|review"]

        # Optional: skill install/check settings
        skillRoots:
          - ~/.agents/skills
          - ~/.dsh/skills
        repoUrl: https://github.com/Tiger3807861189/J-Space-Cognition-Suite-V3.6.git
        branch: main
```

### Rule fields

| Field | Meaning |
| --- | --- |
| `action` | `trigger`, `ignore`, or `none` |
| `pass` | `fast`, `full`, `loop` |
| `modules` | J-Space modules to suggest on a hit |
| `patterns` | Regex source strings or `RegExp` objects |
| `matchMode` | `any` (default), `all`, or `score` |
| `minScore` | Per-rule score threshold; overrides `trigger.minScore` for `matchMode: score` |
| `excludePatterns` | Regexes that veto this rule, useful for explicit opt-outs |

## Tools

| Tool | Purpose |
| --- | --- |
| `jspace_trigger_status` | Show config, counters, skill installation state, and recent hit count |
| `jspace_trigger_test <text>` | Dry-run a message through the current rules |
| `jspace_trigger_analytics` | Inspect the bounded, privacy-safe trigger → delivery → tool-call funnel |
| `jspace_install_skill` | Explicitly install/repair the J-Space skill from upstream |

## Project structure

```text
dsh-jspace-trigger/
├── docs/design.md                # research + rule design rationale
├── src/trigger-core.mjs          # pure rule engine (zero dependencies)
├── src/skill-utils.mjs           # skill detection + explicit installer
├── src/call-analysis.mjs         # bounded privacy-safe funnel
├── src/index.js                  # DSH plugin entry (Cordis lifecycle)
├── scripts/check.mjs             # cross-platform pre-pack validator
├── scripts/build.sh              # CI/pipeline build entry (bash)
├── index.js                      # package entry (re-exports plugin)
├── index.d.ts                    # TypeScript declarations
├── cordis.patch.yml              # DSH bundle mount
├── .github/                      # CI, release, dependabot, CODEOWNERS, issue/PR templates
├── SECURITY.md                   # security policy
└── tests/                        # rule engine + simulated Cordis event tests
```

## Development

```powershell
node scripts/check.mjs   # validate entry + manifest (no child-process capture)
npm test                 # full rule + simulated Cordis event suite
```

The suite runs on Node built-ins only — there is nothing to `npm install`, and
CI deliberately skips install to prove it (see `.github/workflows/ci.yml`).

Not yet done: real-session validation after a DSH restart.

See [docs/design.md](docs/design.md) for the complete design rationale.

## Supply-chain & repository hygiene

- **No runtime npm dependencies** — the shipped code imports only `node:*`
  built-ins; `peerDependencies` are declared for warning purposes only.
- **`.npmrc` sets `ignore-scripts=true`** so no postinstall can run during any
  install.
- **`SECURITY.md`** documents supported versions and private reporting.
- **`CODEOWNERS`** routes review ownership; **Dependabot** keeps the (nearly
  empty) dependency graph and GitHub Actions up to date.
- **CI** (`ci.yml`) runs the suite on Node 20/22 plus an `npm audit` gate;
  **`release.yml`** publishes a signed-by-tag GitHub release with the packed
  tarball.

## Contributing

Bug reports, feature requests, docs improvements, and PRs are welcome.

Please read [CONTRIBUTING.md](CONTRIBUTING.md) first.

## License

[MIT](LICENSE)
