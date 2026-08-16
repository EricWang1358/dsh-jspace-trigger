import test from 'node:test'
import assert from 'node:assert/strict'
import {
  ACTION_IGNORE,
  ACTION_NONE,
  ACTION_TRIGGER,
  PASS_FAST,
  PASS_FULL,
  PASS_LOOP,
  buildGuideText,
  createDefaultConfig,
  evaluateRules,
  extractText,
  formatDecision,
  mergeConfig,
} from '../src/trigger-core.mjs'

test('default config is enabled with near-field injection', () => {
  const cfg = createDefaultConfig()
  assert.equal(cfg.enabled, true)
  assert.equal(cfg.injectMode, 'near-field')
  assert.ok(cfg.trigger.rules.length >= 4)
})

test('chat/greeting stays silent', () => {
  const cfg = createDefaultConfig()
  const d = evaluateRules(cfg, '你好')
  assert.equal(d.action, ACTION_IGNORE)
})

test('explicit /j-space triggers loop', () => {
  const cfg = createDefaultConfig()
  const d = evaluateRules(cfg, '/j-space 请帮我处理这个复杂任务')
  assert.equal(d.action, ACTION_TRIGGER)
  assert.equal(d.pass, PASS_LOOP)
  assert.ok(d.modules.includes('capacity'))
})

test('loop keywords trigger loop with loop modules', () => {
  const cfg = createDefaultConfig()
  const d = evaluateRules(cfg, '做一个仓库级跨文件重构并保持全局一致')
  assert.equal(d.action, ACTION_TRIGGER)
  assert.equal(d.pass, PASS_LOOP)
  assert.deepEqual(d.modules, ['capacity', 'broadcast', 'markers', 'self-monitoring'])
})

test('complex/full keywords trigger full', () => {
  const cfg = createDefaultConfig()
  const d = evaluateRules(cfg, '详细分析一下这个项目的架构')
  assert.equal(d.action, ACTION_TRIGGER)
  assert.equal(d.pass, PASS_FULL)
  assert.ok(d.modules.includes('deep-reasoning'))
})

test('length fallback: long non-chat text triggers full/loop', () => {
  const cfg = createDefaultConfig()
  const text = 'x'.repeat(200)
  assert.equal(evaluateRules(cfg, text).pass, PASS_FULL)

  const loopText = 'x'.repeat(2000)
  assert.equal(evaluateRules(cfg, loopText).pass, PASS_LOOP)
})

test('no rule hit returns none silently', () => {
  const cfg = createDefaultConfig()
  const d = evaluateRules(cfg, '这个数字是 42')
  assert.equal(d.action, ACTION_NONE)
})

test('custom rules can override defaults', () => {
  const cfg = mergeConfig({
    injectMode: 'none',
    trigger: {
      minScore: 2,
      rules: [
        { id: 'only', action: ACTION_TRIGGER, pass: PASS_FULL, modules: ['deep-reasoning'], patterns: ['需要深度', '仔细'] },
      ],
    },
  })
  assert.equal(evaluateRules(cfg, '随便一句').action, ACTION_NONE)
  assert.equal(evaluateRules(cfg, '需要深度也可以仔细想想').action, ACTION_TRIGGER)
})

test('all mode requires every pattern', () => {
  const cfg = mergeConfig({
    trigger: {
      rules: [
        {
          id: 'all-test',
          action: ACTION_TRIGGER,
          pass: PASS_FULL,
          matchMode: 'all',
          patterns: ['重构', '架构'],
        },
      ],
    },
  })
  assert.equal(evaluateRules(cfg, '帮我重构一下').action, ACTION_NONE)
  assert.equal(evaluateRules(cfg, '重构这个架构').action, ACTION_TRIGGER)
})

test('extractText handles nested message shape', () => {
  const data = {
    source: { kind: 'user' },
    message: { content: [{ type: 'text', text: '  hello world  ' }] },
  }
  assert.equal(extractText(data), 'hello world')
})

test('buildGuideText is empty unless trigger', () => {
  const cfg = createDefaultConfig()
  const d = evaluateRules(cfg, '你好')
  assert.equal(buildGuideText(d, '你好', cfg), '')
})

test('buildGuideText includes pass and modules on trigger', () => {
  const cfg = createDefaultConfig()
  const d = evaluateRules(cfg, '/j-space 复杂任务')
  const guide = buildGuideText(d, '/j-space 复杂任务', cfg)
  assert.match(guide, /J-space pass: loop/)
  assert.match(guide, /j-space/)
})

test('formatDecision is inspectable', () => {
  const cfg = createDefaultConfig()
  const d = evaluateRules(cfg, '详细分析架构')
  const text = formatDecision(d)
  assert.match(text, /action=trigger/)
  assert.match(text, /pass=full/)
})