# dsh-jspace-trigger

> **DeepSeek Harness 中 J-Space 的可配置近场触发插件。**\
> 不搞一刀切注入。不强制塞 system prompt。只在规则判定值得时，提示模型加载 `j-space`。

<p align="center">
  <a href="./README.md">English</a> ·
  <a href="docs/design.md">设计文档</a> ·
  <a href="CONTRIBUTING.zh-CN.md">贡献指南</a> ·
  <a href="https://github.com/EricWang1358/dsh-jspace-trigger/issues">Issues</a>
</p>

<p align="center">
  <a href="https://github.com/EricWang1358/dsh-jspace-trigger/actions/workflows/ci.yml"><img alt="CI" src="https://img.shields.io/github/actions/workflow/status/EricWang1358/dsh-jspace-trigger/ci.yml?branch=main&style=flat-square"></a>
  <a href="./LICENSE"><img alt="License" src="https://img.shields.io/badge/license-MIT-blue?style=flat-square"></a>
  <a href="./package.json"><img alt="Node" src="https://img.shields.io/badge/node-%3E%3D20-green?style=flat-square"></a>
  <a href="./SECURITY.md"><img alt="安全策略" src="https://img.shields.io/badge/security-policy-8A2BE2?style=flat-square"></a>
</p>

---

## 这是什么？

`dsh-jspace-trigger` 是一个轻量 DSH 插件，用来决定**什么时候**提醒 agent 使用 [J-Space Cognition Suite](https://github.com/Tiger3807861189/J-Space-Cognition-Suite-V3.6)。

它**不会每轮都注入 J-Space**。实际行为是：

- 监听**真实用户消息**；
- 评估**可配置规则**：正则 / 关键词 / 长度 / 计分 / 显式命令；
- 只有规则命中时，才向对应 agent inbox 追加一条小的 **near-field 提示**；
- 未命中时，完全静默。

## 兼容性

| DSH 运行时 | 状态 |
| --- | --- |
| DSH `0.1.0-rc.7`（`@deepseek-ai/cordis` `4.x`） | ✅ 已对照安装的类型契约验证 |
| 后续 `0.1.0-rc.x` | 预期兼容，发现问题请提 issue |
| `< 0.1.0-rc.7` | 不支持（事件/data 结构不同） |

本插件**运行期零依赖**（仅 Node 内置模块）。`peerDependencies` 对齐
`@deepseek-ai/cordis >=4.0.0-rc <5` 与 DSH 服务包，仅用于大版本不一致告警，不打包任何第三方代码。

## 为什么需要它？

纯 J-Space Skill 在 DSH 里可用但不会自动触发；而把 J-Space 固定注入 system prompt 又太吵。

这个插件取中间态：

| 模式 | 行为 |
| --- | --- |
| `near-field`（默认） | 命中任务时投递一条简短提示；其余全部静默 |
| `none` | 仅观测：规则照跑、指标照记，但**绝不向模型注入任何消息** |

## 特性

- **不搞一刀切注入** —— 不会把 J-Space 协议段塞进每个 system prompt。
- **可配置规则引擎** —— 正则/关键词、`any` / `all` / `score` 匹配、规则独立阈值和排除信号。
- **长度兜底** —— 长文本非寒暄消息可自动路由到 `full` 或 `loop`。
- **跨会话安全投递** —— 某个会话的命中绝不会投递给另一个会话的 agent。
- **去重** —— 同一条事件最多触发一次提示。
- **仅观测模式** —— `injectMode: none` 只产生遥测，不碰对话。
- **Skill 检测与引导安装** —— `jspace_trigger_status` 会报告 `j-space` 是否已安装；未安装时触发提示会附带安装提示，`jspace_install_skill` 可显式安装。
- **运行指标** —— `jspace_trigger_status` 显示事件数、触发数、注入数和 observe-only 命中数。
- **调用漏斗分析** —— `jspace_trigger_analytics` 串起规则命中、投递和后续工具调用，并识别是否实际加载了 `j-space`。
- **干跑工具** —— `jspace_trigger_test` 显示当前配置下某条消息会得到什么结果。

## 快速开始

### 前置条件

- DSH web profile 已可用。
- 已安装 [J-Space Cognition Suite](https://github.com/Tiger3807861189/J-Space-Cognition-Suite-V3.6) 到 DSH 技能库，例如 `~/.agents/skills/j-space/`。

### 安装

从 GitHub 安装（面向最终用户，推荐）：

```powershell
dsh plugin --profile web add "github:EricWang1358/dsh-jspace-trigger"
```

或从本地 clone 或 [GitHub release](https://github.com/EricWang1358/dsh-jspace-trigger/releases) 安装打包产物：

```powershell
dsh plugin --profile web add "<path-or-url-to>/dsh-jspace-trigger-<version>.tgz"
```

本地开发 link（请把 `<repo>` 换成你自己的 clone 路径）：

```powershell
dsh plugin --profile web add "link:<repo>"
```

然后重启：

```powershell
dsh --profile web
```

### 验证

```powershell
dsh --profile web --dump-config | Select-String dsh-jspace-trigger
```

重启后，agent 会看到 `jspace_trigger_status`、`jspace_trigger_test`、`jspace_trigger_analytics` 和 `jspace_install_skill` 四个工具。

### 市场可发现性

本插件是**宿主 bundle 插件**：`package.json` 声明了
`dsh.bundle.patch = ./cordis.patch.yml`，这正是 DSH 各插件市场用来把它归类为
`plugin`（可自动启用）而不是 `client` / `nonplugin` 的依据。面向 GitHub topic
的市场还需要仓库带有 `dsh-plugin` topic 与非空 description，搜索和一键安装
才能命中。

```text
GitHub topic: dsh-plugin  （另加：dsh、dsh-bundle、j-space）
```

fork 维护者请执行 `gh repo edit <owner>/<repo> --add-topic dsh-plugin` 补上。

## 当前触发方式

优先级顺序（第一个命中生效，短路求值）：

```text
内置 opt-out（永远第一）> explicit > ignore/chat > workspace-research > loop > research > complex > 长度兜底 > none
```

`jspace-optout` 规则**内置且永远最先求值**：即使你提供自定义 `rules`，
“不要使用 j-space / do not use j-space”也绝不会被内容关键词覆盖。`chat` 规则
同样可配置：重定义 `chat` 会用你的 patterns 替换内置寒暄表；若删除 `chat`，
仍保留一个最小内置寒暄护栏让单词问候保持静默。

### 默认规则

| 规则 | 示例 | 决策 |
| --- | --- | --- |
| `explicit` | `/j-space`、`use j-space`、`启用 j-space`、`加载 j-space` | `loop` + `capacity, broadcast` |
| `jspace-optout` | `不需要使用 j-space`、`do not use j-space` | **忽略**（静默；优先于复杂度信号） |
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
matchMode=any
hits=2
threshold=1
signals=多阶段|多个文件|多轮|长程|长期|仓库级|跨文件|系统化|完整项目|长时|agentic|long-horizon|multi-stage|multi-file|multi-turn|repository-wide|workflow|loop
skillInstalled=true
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

### 分析真实调用

`jspace_trigger_analytics` 提供有界的内存调用漏斗，用于检查提示是否真的促成了后续动作：

```text
jspace_trigger_analytics scope=current limit=20
```

它按 `规则 -> 投递 -> 工具调用 -> jspaceSkillLoaded` 报告；**绝不保存用户消息原文和工具参数**，只保留时间、会话/事件 ID、规则与 pass、投递结果和工具名。设置 `analytics.enabled: false` 可关闭；`maxRecords` 可限制保留记录（1–500）。

## Skill 检测与安装

插件**不会自动下载或安装** J-Space，只做检测和显式安装：

- `jspace_trigger_status` 会报告 `skillInstalled` 和已安装路径。
- 未安装时，触发提示会追加：
  ```text
  J-Space skill is not installed. Run `jspace_install_skill` to install it.
  ```
- `jspace_install_skill` 会从上游仓库克隆并复制 `j-space/` 到你的技能库。

手动安装：

```powershell
jspace_install_skill
```

强制重装：

```powershell
jspace_install_skill force=true
```

安装到自定义目录：

```powershell
jspace_install_skill root="C:\path\to\skills"
```

## 配置

配置放在插件 `config` 中，通常编辑 `cordis.patch.yml`：

```yaml
- insert:
    - id: jspace-trigger
      name: dsh-jspace-trigger
      config:
        enabled: true
        injectMode: near-field      # near-field | none
        analytics:
          enabled: true             # 仅元数据；不保存提示词和工具参数
          maxRecords: 50            # 限制在 1..500
        trigger:
          minScore: 1               # 触发规则的最低命中数
          loopChars: 1800           # 文本超过该长度 -> loop 兜底
          fullChars: 120            # 文本超过该长度 -> full 兜底
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

        # 可选：Skill 安装/检测配置
        skillRoots:
          - ~/.agents/skills
          - ~/.dsh/skills
        repoUrl: https://github.com/Tiger3807861189/J-Space-Cognition-Suite-V3.6.git
        branch: main
```

### 规则字段

| 字段 | 含义 |
| --- | --- |
| `action` | `trigger`、`ignore` 或 `none` |
| `pass` | `fast`、`full`、`loop` |
| `modules` | 命中后建议加载的 J-Space 模块 |
| `patterns` | 正则字符串或 `RegExp` 对象 |
| `matchMode` | `any`（默认）、`all` 或 `score` |
| `minScore` | `matchMode: score` 时的规则独立阈值，优先于全局 `trigger.minScore` |
| `excludePatterns` | 命中即否决本规则的正则，适合表达显式不使用 |

## 工具

| 工具 | 作用 |
| --- | --- |
| `jspace_trigger_status` | 查看配置、计数器、Skill 安装状态和近期命中数 |
| `jspace_trigger_test <text>` | 用当前规则干跑一条消息，显示决策结果 |
| `jspace_trigger_analytics` | 查看有界、隐私安全的触发 → 投递 → 工具调用漏斗 |
| `jspace_install_skill` | 显式安装/修复 J-Space Skill |

## 项目结构

```text
dsh-jspace-trigger/
├── docs/design.md                # 调研 + 规则设计
├── src/trigger-core.mjs          # 纯规则引擎（零依赖）
├── src/skill-utils.mjs           # Skill 检测 + 显式安装
├── src/call-analysis.mjs         # 有界隐私安全的调用漏斗
├── src/index.js                  # DSH 插件入口（Cordis 生命周期）
├── scripts/check.mjs             # 跨平台打包前校验
├── scripts/build.sh              # CI/流水线构建入口（bash）
├── index.js                      # 包入口
├── index.d.ts                    # TypeScript 声明
├── cordis.patch.yml              # DSH bundle 装配
├── .github/                      # CI、release、dependabot、CODEOWNERS、issue/PR 模板
├── SECURITY.md                   # 安全策略
└── tests/                        # 规则测试 + 模拟 Cordis 事件测试
```

## 开发

```powershell
node scripts/check.mjs   # 校验入口与清单（不捕获子进程输出）
npm test                 # 完整规则 + 模拟 Cordis 事件测试
```

测试只依赖 Node 内置模块——无需 `npm install`，CI 有意跳过安装以证明这一点
（见 `.github/workflows/ci.yml`）。

尚未完成：DSH 重启后的真机会话触发验证。

完整设计见 [docs/design.md](docs/design.md)。

## 供应链与仓库治理

- **运行期零 npm 依赖** —— 发布代码仅 import Node 内置模块；`peerDependencies` 仅作告警。
- **`.npmrc` 设置 `ignore-scripts=true`** —— 任何安装都不会执行 postinstall。
- **`SECURITY.md`** 声明支持版本与私下上报渠道。
- **`CODEOWNERS`** 路由评审责任；**Dependabot** 保持依赖图与 GitHub Actions 更新。
- **CI**（`ci.yml`）在 Node 20/22 跑测试并附带 `npm audit` 门禁；**`release.yml`** 按 tag 发布 GitHub Release 与打包产物。

## 参与贡献

欢迎提交 bug、功能建议、文档改进和 PR。

请先阅读 [CONTRIBUTING.zh-CN.md](CONTRIBUTING.zh-CN.md)。

## License

[MIT](LICENSE)
