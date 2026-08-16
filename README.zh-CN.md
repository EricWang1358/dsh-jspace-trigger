# dsh-jspace-trigger

<p align="center">
  <b>DeepSeek Harness 中 J-Space 的可配置近场触发插件</b><br>
  不搞一刀切注入。不强制塞 system prompt。只在规则判定值得时，提示模型加载 <code>j-space</code>。
</p>

<p align="center">
  <a href="./README.md">English</a> ·
  <a href="docs/design.md">设计文档</a> ·
  <a href="CONTRIBUTING.zh-CN.md">贡献指南</a> ·
  <a href="https://github.com/EricWang1358/dsh-jspace-trigger/issues">Issues</a>
</p>

<p align="center">
  <img alt="License" src="https://img.shields.io/badge/license-MIT-blue?style=flat-square">
  <img alt="Node" src="https://img.shields.io/badge/node-%3E%3D20-green?style=flat-square">
  <img alt="Tests" src="https://img.shields.io/badge/tests-18%2F18-passing-brightgreen?style=flat-square">
</p>

---

## 这是什么？

`dsh-jspace-trigger` 是一个轻量 DSH 插件，用来决定**什么时候**提醒 agent 使用 [J-Space Cognition Suite](https://github.com/Tiger3807861189/J-Space-Cognition-Suite-V3.6)。

它**不会每轮都注入 J-Space**。实际行为是：

- 监听**真实用户消息**；
- 评估**可配置规则**：正则 / 关键词 / 长度 / 计分 / 显式命令；
- 只有规则命中时，才向对应 agent inbox 追加一条小的 **near-field 提示**；
- 未命中时，完全静默。

## 为什么需要它？

纯 J-Space Skill 在 DSH 里可用但不会自动触发；而把 J-Space 固定注入 system prompt 又太吵。

这个插件取中间态：

| 模式 | 行为 |
| --- | --- |
| `near-field`（默认） | 命中任务时投递一条简短提示；其余全部静默 |
| `none` | 仅观测：规则照跑、指标照记，但**绝不向模型注入任何消息** |

## 特性

- **不搞一刀切注入** —— 不会把 J-Space 协议段塞进每个 system prompt。
- **可配置规则引擎** —— 正则/关键词、`any` / `all` / `score` 匹配、`minScore`。
- **长度兜底** —— 长文本非寒暄消息可自动路由到 `full` 或 `loop`。
- **跨会话安全投递** —— 某个会话的命中绝不会投递给另一个会话的 agent。
- **去重** —— 同一条事件最多触发一次提示。
- **仅观测模式** —— `injectMode: none` 只产生遥测，不碰对话。
- **运行指标** —— `jspace_trigger_status` 显示事件数、触发数、注入数和 observe-only 命中数。
- **干跑工具** —— `jspace_trigger_test` 显示当前配置下某条消息会得到什么结果。

## 快速开始

### 前置条件

- DSH web profile 已可用。
- 已安装 [J-Space Cognition Suite](https://github.com/Tiger3807861189/J-Space-Cognition-Suite-V3.6) 到 DSH 技能库，例如 `~/.agents/skills/j-space/`。

### 安装

本地开发 link：

```powershell
dsh plugin --profile web add "link:D:\A\1CMU\dsh-jspace-trigger"
```

或从 GitHub 安装：

```powershell
dsh plugin --profile web add "github:EricWang1358/dsh-jspace-trigger"
```

然后重启：

```powershell
dsh --profile web
```

### 验证

```powershell
dsh --profile web --dump-config | Select-String dsh-jspace-trigger
```

重启后，agent 会看到 `jspace_trigger_status` 和 `jspace_trigger_test` 两个工具。

## 当前触发方式

优先级顺序（第一个命中生效）：

```text
explicit > ignore > loop > full > 长度兜底 > none
```

### 默认规则

| 规则 | 示例 | 决策 |
| --- | --- | --- |
| `explicit` | `/j-space`、`use j-space`、`启用 j-space`、`加载 j-space` | `loop` + `capacity, broadcast` |
| `chat` | `你好`、`hello`、`thanks`、`ok`、`嗯` | **忽略**（静默） |
| `loop` | 仓库级、跨文件、多阶段、多轮、long-horizon、multi-file | `loop` + `capacity, broadcast, markers, self-monitoring` |
| `complex` | 重构、架构、全面、详细、调试、审查、refactor、architecture | `full` + `deep-reasoning, self-monitoring` |

### 触发案例

```text
# 显式触发 -> loop
/j-space 请审计这个仓库并跨文件保持一致

# loop 关键词 -> loop
做一个仓库级跨文件重构，并保持全局一致

# complex 关键词 -> full
详细分析一下这个项目的架构，并检查潜在风险

# 长度兜底 -> full
超过 120 个字符的非寒暄任务……

# 长度兜底 -> loop
超过 1800 个字符的多阶段长任务……

# 寒暄 -> 静默
你好
```

### 干跑一条消息

```text
jspace_trigger_test "仓库级跨文件重构"
```

预期输出：

```text
action=trigger
pass=loop
modules=capacity,broadcast,markers,self-monitoring
matched=loop
reason=rule:loop
---
[jspace-trigger] J-space pass: loop. Suggested modules: capacity, broadcast, markers, self-monitoring. If this task needs structured workspace control, load the `j-space` skill and follow its gate.
```

### 仅观测模式

在 `cordis.patch.yml` 中设置：

```yaml
config:
  injectMode: none
```

该模式下，命中事件仍会计入 `jspace_trigger_status`，但**永远不会注入任何会话**。

## 配置

配置放在插件 `config` 中，通常编辑 `cordis.patch.yml`：

```yaml
- insert:
    - id: jspace-trigger
      name: dsh-jspace-trigger
      config:
        enabled: true
        injectMode: near-field      # near-field | none
        trigger:
          minScore: 1               # 触发规则的最低命中数
          loopChars: 1800           # 文本超过该长度 -> loop 兜底
          fullChars: 120            # 文本超过该长度 -> full 兜底
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
```

### 规则字段

| 字段 | 含义 |
| --- | --- |
| `action` | `trigger`、`ignore` 或 `none` |
| `pass` | `fast`、`full`、`loop` |
| `modules` | 命中后建议加载的 J-Space 模块 |
| `patterns` | 正则字符串或 `RegExp` 对象 |
| `matchMode` | `any`（默认）、`all` 或 `score` |

## 工具

| 工具 | 作用 |
| --- | --- |
| `jspace_trigger_status` | 查看配置、计数器和近期命中数 |
| `jspace_trigger_test <text>` | 用当前规则干跑一条消息，显示决策结果 |

## 项目结构

```text
dsh-jspace-trigger/
├── docs/design.md               # 调研 + 规则设计
├── src/trigger-core.mjs         # 纯规则引擎（零依赖）
├── src/index.js                 # DSH 插件入口
├── index.js                     # 包入口
├── cordis.patch.yml             # DSH bundle 装配
└── tests/                       # 规则测试 + 模拟 Cordis 事件测试
```

## 开发

```powershell
npm test
```

当前状态：18/18 测试通过。

尚未完成：DSH 重启后的真机会话触发验证。

完整设计见 [docs/design.md](docs/design.md)。

## 参与贡献

欢迎提交 bug、功能建议、文档改进和 PR。

请先阅读 [CONTRIBUTING.zh-CN.md](CONTRIBUTING.zh-CN.md)。

## License

[MIT](LICENSE)