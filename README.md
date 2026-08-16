# dsh-jspace-trigger

可配置规则触发的 J-Space 轻量 DSH 插件。

## 目标

- 不搞一刀切注入；
- 根据可配置规则（关键词/正则/长度/显式命令）判断是否提示加载 `j-space`；
- 未命中时零成本；
- 命中时只做 near-field 轻提醒，不强制注入。

## 当前进度

- [x] 调研 DSH 触发机制与现有路由套件
- [x] 输出规则设计草案
- [x] 实现 `trigger-core` 纯逻辑
- [x] 实现 DSH 插件入口
- [x] 单元测试（13 项）
- [x] 安装到 `web` profile（link 模式）
- [ ] 重启 DSH 真机验证触发效果

## 项目结构

```text
dsh-jspace-trigger/
├── docs/design.md            # 调研与规则设计
├── src/trigger-core.mjs      # 纯规则求值引擎（零依赖）
├── src/index.js              # DSH 插件入口
├── index.js                  # 包入口 re-export
├── cordis.patch.yml          # DSH bundle 装配补丁
└── tests/trigger-core.test.mjs
```

## 规则配置

默认规则在 `src/trigger-core.mjs` 的 `DEFAULT_RULES` 中；安装后可通过
`cordis.patch.yml` 的 `config` 覆盖：

```yaml
- insert:
    - id: jspace-trigger
      name: dsh-jspace-trigger
      config:
        enabled: true
        injectMode: near-field
        trigger:
          minScore: 1
          loopChars: 1800
          fullChars: 120
          rules:
            - id: explicit
              action: trigger
              pass: loop
              modules: [capacity, broadcast]
              patterns: ["/j-space", "use j-space"]
            # ... 自定义规则
```

优先级：`explicit > ignore > loop > full > 长度兜底 > none`。

`injectMode` 仅支持以下模式：

- `near-field`（默认）：命中时向对应会话的 agent inbox 追加一条提示。
- `none`：仅统计命中，绝不向模型追加消息；适合先校准规则。

其他值会安全地回退为 `near-field`。

## 安装

已在 `web` profile 安装：

```powershell
dsh plugin --profile web add "link:D:\A\1CMU\dsh-jspace-trigger"
```

修改 `cordis.patch.yml` 或源码后重启 DSH 生效。

## 测试

```powershell
npm test
```

测试覆盖规则求值，以及模拟 Cordis 会话事件中的去重、按会话投递和 observe-only 行为。

## 文档

- [规则设计草案](docs/design.md)
