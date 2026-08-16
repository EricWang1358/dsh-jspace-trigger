# dsh-jspace-trigger

<p align="center">
  <b>Configurable, near-field trigger for J-Space in DeepSeek Harness</b><br>
  No blanket injection. No forced system prompt. Only prompt the model to load <code>j-space</code> when rules say it is worth it.
</p>

<p align="center">
  <a href="./README.zh-CN.md">简体中文</a> ·
  <a href="docs/design.md">Design</a> ·
  <a href="CONTRIBUTING.md">Contributing</a> ·
  <a href="https://github.com/EricWang1358/dsh-jspace-trigger/issues">Issues</a>
</p>

<p align="center">
  <img alt="License" src="https://img.shields.io/badge/license-MIT-blue?style=flat-square">
  <img alt="Node" src="https://img.shields.io/badge/node-%3E%3D20-green?style=flat-square">
  <img alt="Tests" src="https://img.shields.io/badge/tests-24%2F24-passing-brightgreen?style=flat-square">
</p>

---

## What is this?

`dsh-jspace-trigger` is a lightweight DeepSeek Harness (DSH) plugin that decides **when** to remind the agent to use the [J-Space Cognition Suite](https://github.com/Tiger3807861189/J-Space-Cognition-Suite-V3.6).

It does **not** inject J-Space every turn. Instead:

- It watches **real user messages**.
- It evaluates **configurable rules**: regex / keywords / length / score / explicit commands.
- Only when a rule fires does it append a small **near-field** nudge to the agent inbox.
- When nothing fires, it stays completely silent.

## Why?

Plain J-Space as a DSH skill is available but not automatic. A fixed J-Space system-prompt injection is too noisy for simple tasks.

This plugin is the middle ground:

| Mode | Behavior |
| --- | --- |
| `near-field` (default) | Matched tasks receive one short nudge in the inbox; everything else is silent |
| `none` | Observe-only: rules still run and metrics still update, but **no message is ever injected** |

## Features

- **No blanket injection** — no J-Space section forced into every system prompt.
- **Configurable rule engine** — regex/keyword patterns, `any` / `all` / `score` matching, `minScore`.
- **Length fallback** — long non-chat messages can automatically route to `full` or `loop`.
- **Session-safe delivery** — a hit in one session is never delivered to an agent from another session.
- **Deduplication** — one event triggers at most one nudge.
- **Observe-only mode** — `injectMode: none` gives pure telemetry without touching the conversation.
- **Skill detection & guided install** — `jspace_trigger_status` reports whether `j-space` is installed; triggered nudges include a missing-skill hint, and `jspace_install_skill` installs it explicitly.
- **Runtime metrics** — `jspace_trigger_status` reports events, triggers, injections, and observe-only hits.
- **Dry-run tool** — `jspace_trigger_test` shows exactly what the current config would do.

## Quick start

### Prerequisites

- DSH web profile installed and working.
- [J-Space Cognition Suite](https://github.com/Tiger3807861189/J-Space-Cognition-Suite-V3.6) installed as a DSH skill, e.g. at `~/.agents/skills/j-space/`.

### Install

Local development link:

```powershell
dsh plugin --profile web add "link:D:\A\1CMU\dsh-jspace-trigger"
```

Or from GitHub:

```powershell
dsh plugin --profile web add "github:EricWang1358/dsh-jspace-trigger"
```

Then restart:

```powershell
dsh --profile web
```

### Verify

```powershell
dsh --profile web --dump-config | Select-String dsh-jspace-trigger
```

After restart, the tools `jspace_trigger_status`, `jspace_trigger_test`, and `jspace_install_skill` are available to the agent.

## How triggering works today

Priority order (first match wins):

```text
explicit > ignore > loop > full > length fallback > none
```

### Default rules

| Rule | Examples | Decision |
| --- | --- | --- |
| `explicit` | `/j-space`, `use j-space`, `启用 j-space`, `加载 j-space` | `loop` + `capacity, broadcast` |
| `chat` | `你好`, `hello`, `thanks`, `ok`, `嗯` | **ignore** (silent) |
| `loop` | 仓库级、跨文件、多阶段、多轮、long-horizon、multi-file | `loop` + `capacity, broadcast, markers, self-monitoring` |
| `complex` | 重构、架构、全面、详细、调试、审查、refactor、architecture | `full` + `deep-reasoning, self-monitoring` |

### Real trigger examples

```text
# explicit -> loop
/j-space 请审计这个仓库并跨文件保持一致

# loop keywords -> loop
做一个仓库级跨文件重构，并保持全局一致

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
        trigger:
          minScore: 1               # minimum pattern hit count for trigger rules
          loopChars: 1800           # text longer than this -> loop fallback
          fullChars: 120            # text longer than this -> full fallback
          rules:
            - id: explicit
              action: trigger
              pass: loop
              modules: [capacity, broadcast]
              patterns: ["/j-space", "use j-space"]

            - id: chat
              action: ignore
              patterns: ["^你好[!。.!？?~～]*$", "^(hello|hi|thanks|ok)[!。.!？?~～]*$"]

            - id: loop
              action: trigger
              pass: loop
              modules: [capacity, broadcast, markers, self-monitoring]
              patterns: ["多阶段|多文件|跨文件|长程|仓库级", "long-horizon|multi-file|repository-wide"]

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

## Tools

| Tool | Purpose |
| --- | --- |
| `jspace_trigger_status` | Show config, counters, skill installation state, and recent hit count |
| `jspace_trigger_test <text>` | Dry-run a message through the current rules |
| `jspace_install_skill` | Explicitly install/repair the J-Space skill from upstream |

## Project structure

```text
dsh-jspace-trigger/
├── docs/design.md               # research + rule design
├── src/trigger-core.mjs         # pure rule engine (zero dependencies)
├── src/skill-utils.mjs          # skill detection + explicit installer
├── src/index.js                 # DSH plugin entry
├── index.js                     # package entry
├── cordis.patch.yml             # DSH bundle mount
└── tests/                       # trigger-core + simulated Cordis event tests
```

## Development

```powershell
npm test
```

Current status: 24/24 tests pass.

Not yet done: real-session validation after a DSH restart.

See [docs/design.md](docs/design.md) for the complete design rationale.

## Contributing

Bug reports, feature requests, docs improvements, and PRs are welcome.

Please read [CONTRIBUTING.md](CONTRIBUTING.md) first.

## License

[MIT](LICENSE)
