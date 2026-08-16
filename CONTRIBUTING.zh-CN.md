# 参与贡献 dsh-jspace-trigger

感谢你愿意帮助改进这个项目。本指南用于让 Issue 和 PR 保持可审查、一致。

## 行为准则

保持尊重、建设性，并默认他人是善意的。

## Issue

### Bug 报告

使用 [Bug Report 模板](./.github/ISSUE_TEMPLATE/bug_report.yml)。好的 bug 报告应包含：

- DSH 版本与 profile 名称。
- 插件版本（`dsh-jspace-trigger` 版本号或 commit SHA）。
- 复现步骤。
- 期望行为。
- 实际行为。
- 相关日志 / `jspace_trigger_status` 输出。
- 如果可能，提供最小化的 `cordis.patch.yml` 复现。

### 功能建议

使用 [Feature Request 模板](./.github/ISSUE_TEMPLATE/feature_request.yml)。请描述：

- 你想解决的问题。
- 期望的行为。
- 为什么它符合本插件范围（可配置、非侵入、near-field）。
- 你考虑过的其他方案。

## Pull Request

### 开启 PR 前

1. 确保 `npm test` 通过。
2. 如果改变了可见行为，请同步更新：
   - `README.md` 和/或 `README.zh-CN.md`；
   - 涉及规则模型或架构变化时更新 `docs/design.md`；
   - `tests/` 下的测试。
3. 用户可见变更请附验证证据（测试输出、干跑输出或截图）。

### 提交信息规范

- 遵循 [Conventional Commits](https://www.conventionalcommits.org/)。
- 允许类型：`feat`、`fix`、`docs`、`test`、`refactor`、`perf`、`chore`、`ci`、`style`。
- 示例：
  - `feat(core): support matchMode score`
  - `fix(trigger): keep injectMode none observe-only`
  - `docs(readme): add bilingual usage examples`
- **代码、文档与提交信息中禁止 emoji**，除非仓库内容本身明确使用。

### 代码风格

- 保持 `src/trigger-core.mjs` 无第三方依赖、无副作用。
- 保持 `src/index.js` 宿主逻辑薄。
- 使用纯 ESM JavaScript，不引入构建步骤。
- 保持当前行为：
  - `near-field` 只向匹配会话注入一次；
  - `none` 绝不注入；
  - 未命中消息保持静默。

### PR 检查清单

- [ ] 本地 `npm test` 通过。
- [ ] 没有提交密钥或包含个人信息的本地路径。
- [ ] 行为变化时已更新文档和测试。
- [ ] 没有无关的格式修改/文件改动。

## 发布流程

项目按实际情况采用语义化版本。由维护者决定何时打 tag。

## License

通过贡献，你同意你的贡献以 [MIT License](LICENSE) 授权。