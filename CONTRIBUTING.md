# Contributing to dsh-jspace-trigger

Thanks for helping improve the project. This guide keeps issues and PRs reviewable and consistent.

## Code of Conduct

Be respectful, constructive, and assume good intent.

## Issues

### Bug reports

Use the [Bug Report template](./.github/ISSUE_TEMPLATE/bug_report.yml). A good bug report includes:

- DSH version and profile name.
- Plugin version (`dsh-jspace-trigger` version or commit SHA).
- Steps to reproduce.
- Expected behavior.
- Actual behavior.
- Relevant logs / `jspace_trigger_status` output.
- If possible, a minimal `cordis.patch.yml` reproduction.

### Feature requests

Use the [Feature Request template](./.github/ISSUE_TEMPLATE/feature_request.yml). Describe:

- The problem you are trying to solve.
- The proposed behavior.
- Why it fits this plugin's scope (configurable, non-intrusive, near-field).
- Any alternative designs you considered.

## Pull requests

### Before opening a PR

1. Make sure `npm test` passes.
2. If you change observable behavior, update:
   - `README.md` and/or `README.zh-CN.md`;
   - `docs/design.md` when the rule model or architecture changes;
   - tests under `tests/`.
3. For user-visible changes, include verification evidence (test output, dry-run output, or a screenshot).

### Commit message rules

- Follow [Conventional Commits](https://www.conventionalcommits.org/).
- Allowed types: `feat`, `fix`, `docs`, `test`, `refactor`, `perf`, `chore`, `ci`, `style`.
- Examples:
  - `feat(core): support matchMode score`
  - `fix(trigger): keep injectMode none observe-only`
  - `docs(readme): add bilingual usage examples`
- **No emoji in commit messages, code, or docs** unless the repository explicitly uses them in content.

### Code style

- Keep `src/trigger-core.mjs` free of dependencies and side effects.
- Keep plugin host logic in `src/index.js` thin.
- Use plain ESM JavaScript; no build step is required.
- Preserve the current behavior:
  - `near-field` injects only into the matching session once;
  - `none` never injects;
  - unmatched messages stay silent.

### PR checklist

- [ ] `npm test` passes locally.
- [ ] No secrets or local paths with personal info are committed.
- [ ] Docs and tests updated when behavior changes.
- [ ] No unrelated formatting / file changes.

## Release process

This project is versioned with semantic versioning where practical. Maintainers decide when to tag.

## License

By contributing, you agree that your contributions are licensed under the [MIT License](LICENSE).