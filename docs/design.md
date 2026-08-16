# dsh-jspace-trigger 规则设计草案

> 状态：调研完成，待评审。
> 核心目标：不搞一刀切注入；用**可配置规则**判断是否命中，命中才提示加载 `j-space`，未命中零成本。

## 1. 调研结论

### 1.1 J-Space 本身的触发语义

J-Space Cognition Suite V3.6 是一个 Skill，不是 DSH 插件。它内部自带 gate：

| Pass | 何时用 | 加载内容 |
|---|---|---|
| `fast` | 单步、一眼可核验 | 不加载模块 |
| `full` | 多步但单一交付物、可一次验证 | 加载 1-2 个相关模块 |
| `loop` | 多阶段、多文件、多轮、需要持久状态 | 加载 `capacity/broadcast/…` 等模块 |

它没有“关键词自动触发”机制；在 DSH 里纯 Skill 只能靠模型按任务语义主动加载。因此需要外部规则层来决定“什么时候值得把 J-Space 拉上台”。

### 1.2 DSH 现有的成熟做法：dsh-routing-suite

参考 [dsh-router-standard](https://github.com/yjh051108/dsh-router-standard)（231★）与整合项目 [dsh-router-jspace](https://github.com/DreamRift/dsh-router-jspace)：

- 结论：**模型自身无法稳定自路由**，外部分类器是必要组件。
- 分类方式：
  - `CHAT_RE`：问候/感谢/简短确认 → 直接让位，不触发。
  - `REACT_RE` / `SPEC_RE`：关键词命中数比较，决定 build/fix 行为带。
  - `COMPLEX_RE` + 文本长度：判断 `复杂任务`。
  - `LOOP_RE` + 超长文本：判断 `长程/循环任务`。
- 注入机制：
  - `system-prompt/assemble`：首次请求前注入 persona / protocol section。
  - `session/event` + `agent.inbox.append('next-step', ...)`：每条真实用户消息后追加 **near-field 引导**，不进 system 前缀，不破坏缓存。
- 已有测试：`passFor`、`isChatTask`、`isLoopTask`、`modulesFor`、round≥3 强制重新分类等。

### 1.3 对我们的启发

1. 不要用“模型自己觉得要不要用”作为唯一机制，外部规则至少要做**初筛/兜底**。
2. 不要对每条消息注入；先用 chat/ignore 规则快速放行。
3. 触发结果不应只是“是/否”，最好直接给出 `fast / full / loop` 和推荐模块。
4. 注入点建议用 **near-field**（用户消息后追加），而不是固定 system prompt，符合“不能一刀切注入”。
5. 规则要可配置：关键词/正则/长度/显式命令，且可关闭。

## 2. 设计目标

- 默认静默。
- 命中规则时才追加一条轻量引导，例如：
  > 「J-space pass: full. Load: introspection, markers.」
- 未命中任何规则：完全零成本。
- 支持显式触发：`/j-space` 或“使用 j-space”。
- 支持忽略规则：寒暄、纯确认、无需推理的任务。
- 支持优先级：`ignore > loop > full > complex-length > fast`。
- 规则全部可配置，配置改动即时生效或重启后生效（DSH 插件规范决定）。

## 3. 规则决策流程

```text
真实用户消息
  │
  ├─ 1. explicit 规则？          ── 是 → 强制 full/loop
  ├─ 2. ignore/chat 规则？       ── 是 → 不触发（fast，静默）
  ├─ 3. loop 规则或超长文本？     ── 是 → loop + 推荐模块
  ├─ 4. full/complex 规则？      ── 是 → full + 推荐模块
  ├─ 5. 短文本且无规则命中？      ── 不触发
  └─ 6. 不确定 → 可配置 fallback：none / fast / full
```

优先级按顺序短路：`explicit > ignore > loop > full`；同一档内可做评分，例如多个关键词命中增加置信度。

## 4. 可配置规则 Schema（草案）

插件配置放在 DSH plugin config 中（`cordis.patch.yml` 或外部配置文件加载），YAML 形态如下：

```yaml
enabled: true
injectMode: near-field   # near-field | none
trigger:
  minScore: 1            # matchMode: score 时至少命中多少个关键词/正则
  loopChars: 1800        # 超过该长度直接判 loop
  fullChars: 120         # 超过该长度且非 chat 判 full
  rules:
    - id: explicit
      action: trigger
      pass: loop
      modules: [capacity, broadcast]
      patterns:
        - "/j-space"
        - "use j-space"
        - "启用 j-space"
        - "load j-space"

    - id: chat
      action: ignore
      patterns:
        - "^你好[!。.!？?~～]*$"
        - "^(hello|hi|hey|thanks|thank you|ok|okay|好的|嗯|在吗)[!。.!？?~～]*$"

    - id: loop
      action: trigger
      pass: loop
      modules: [capacity, broadcast, markers, self-monitoring]
      patterns:
        - "多阶段|多文件|多轮|长程|长期|仓库级|跨文件|系统化|完整项目|长时"
        - "agentic|long-horizon|multi-stage|multi-file|multi-turn|repository-wide|workflow"

    - id: complex
      action: trigger
      pass: full
      modules: [deep-reasoning, self-monitoring]
      patterns:
        - "重构|架构|全面|详细|设计|系统|优化|分析|审查|调试|排查|报错|修复"
        - "refactor|architecture|comprehensive|detailed|design|system|optimize|analyze|review|debug|fix"

    - id: fast-allow
      action: none       # 不触发也不打扰
      pass: fast
      patterns: []       # 由 fallback 逻辑处理
```

### 字段说明

| 字段 | 说明 |
|---|---|
| `enabled` | 总开关 |
| `injectMode` | `near-field` 推荐；`none` 为仅观测：记录命中但不注入 |
| `trigger.minScore` | `matchMode: score` 时的命中数阈值，减少单关键词误报 |
| `trigger.rules[].action` | `trigger` / `ignore` / `none` |
| `trigger.rules[].pass` | `fast` / `full` / `loop` |
| `trigger.rules[].modules` | 命中后建议加载的 J-Space 模块 |
| `trigger.rules[].patterns` | 关键词或正则（JS RegExp source 字符串） |
| `trigger.matchMode` | 可选 `any` / `all` / `score` |

### 默认建议

- 默认 `minScore: 1`，避免过度敏感。
- 默认 `injectMode: near-field`。
- `ignore/chat` 规则放在最前，防止“谢谢”“好的”被误判。
- `loop` 规则优先级高于 `complex`：跨文件/长任务即使没出现“复杂”词也走 loop。
- 长度兜底：`fullChars` 和 `loopChars` 只对非 chat 消息生效。

## 5. 插件实现草图

### 扩展点

参考 `dsh-router-standard` / `dsh-router-jspace`：

```js
export const name = 'jspace-trigger'
export const inject = ['systemPrompt', 'agent'] // 或最少依赖

export function apply(ctx, config) {
  // 1. 监听真实用户消息
  ctx.on('session/event', (session, event) => {
    if (event.type !== 'user/message') return
    if (event.data?.source?.kind !== 'user') return
    const text = extractText(event.data)
    const decision = evaluateRules(config, text)
    if (decision.action !== 'trigger') return
    // 2. 去重，避免同一轮重复注入
    if (seen.has(event.id)) return
    seen.add(event.id)
    // 3. near-field 注入
    agent.inbox.append('next-step', {
      id: `jspace-trigger-${Date.now()}-${...}`,
      role: 'user',
      source: { kind: 'plugin', plugin: 'jspace-trigger' },
      content: [{ type: 'text', text: guideText(decision) }],
    })
  })
}
```

### 纯逻辑与实现分离

- `src/trigger-core.mjs`：零依赖，纯规则求值，可单测。
- `src/index.js`：Cordis 插件入口，负责事件监听、注入和注册工具。
- `tests/`：用 `node:test` 覆盖规则优先级、chat 让位、loop/full 判定、显式触发、去重。

### 建议工具

- `jspace_trigger_status`：查看当前规则配置，以及命中、注入、observe-only 和失败计数。
- `jspace_trigger_test <text>`：干跑一条消息，输出决策结果，便于调规则。

## 6. 与已装插件/生态的共存

- 已安装 `dsh-mnemon`：本插件只做 J-Space 触发提示，不碰记忆层，可共存。
- 已安装 `dsh-super-injector` / `dsh-mode-boost` / `dsh-agent-teams`：本插件不替换 persona、不改工具面，只追加 near-field 文本，冲突风险低。
- `dsh-router-standard`：在 `weak` 行为带会追加自己的路由引导；若本插件也命中规则，同一轮会出现两条 near-field 引导。两者不争夺 persona 或工具面，但会增加提示噪声。当前不做自动检测或静默；需要 Router Standard 独占 near-field 时，设置 `injectMode: none`。
- 梁神模式（Liangshen / anchored standard）：首轮锚定阶段会过滤 `source.kind: plugin` 的消息，因此本插件首轮命中只计入指标、不影响锚定；模式晋升后，后续提示可正常参与会话。需要全程纯净轨迹时，同样使用 `injectMode: none`。

## 7. 待验证/开放问题

1. **near-field 注入是否足够**：模型是否真的会因此主动调用 `skill` 加载 `j-space`？需要真机跑 2-3 个复杂任务验证。
2. **是否要自动加载 skill**：DSH 插件能否直接触发模型加载 skill 不可控；当前方案是“提示模型按需加载”，不是强制。
3. **规则误报率**：关键词规则需要样本校准；建议先收集 20-30 条真实消息做干跑测试。

## 8. 参考来源

- J-Space Cognition Suite V3.6：https://github.com/Tiger3807861189/J-Space-Cognition-Suite-V3.6
- dsh-routing-suite：https://github.com/yjh051108/dsh-routing-suite
- dsh-router-standard：https://github.com/yjh051108/dsh-router-standard
- dsh-router-jspace：https://github.com/DreamRift/dsh-router-jspace
- Yhx888 DSH resident plugin wrapper：https://github.com/Yhx888/j-space-cognition-suite
