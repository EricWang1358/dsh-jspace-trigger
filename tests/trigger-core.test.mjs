import test from 'node:test'
import assert from 'node:assert/strict'
import {
  ACTION_IGNORE,
  ACTION_NONE,
  ACTION_TRIGGER,
  INJECT_MODE_NEAR_FIELD,
  INJECT_MODE_NONE,
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

test('an explicit J-Space opt-out does not accidentally trigger the explicit rule', () => {
  const d = evaluateRules(createDefaultConfig(), '这一步不需要使用 j-space')
  assert.equal(d.action, ACTION_IGNORE)
  assert.equal(d.reason, 'rule:jspace-optout')
})

test('built-in opt-out still wins even when custom rules replace the defaults', () => {
  const cfg = mergeConfig({
    trigger: {
      rules: [
        { id: 'explicit', action: ACTION_TRIGGER, pass: PASS_LOOP, modules: [], patterns: ['j-space', '/j-space'] },
      ],
    },
  })
  const refusal = evaluateRules(cfg, '不要使用 j-space')
  assert.equal(refusal.action, ACTION_IGNORE)
  assert.equal(refusal.reason, 'rule:jspace-optout')

  const ask = evaluateRules(cfg, '请使用 j-space 处理')
  assert.equal(ask.action, ACTION_TRIGGER)
  assert.equal(ask.pass, PASS_LOOP)
})

test('chat detection reads a configured chat rule instead of the hardcoded default', () => {
  const cfg = mergeConfig({
    trigger: {
      rules: [
        { id: 'chat', action: ACTION_IGNORE, patterns: ['^嗨嗨$'] },
        { id: 'complex', action: ACTION_TRIGGER, pass: PASS_FULL, modules: [], patterns: ['分析'] },
      ],
    },
  })
  assert.equal(evaluateRules(cfg, '嗨嗨').action, ACTION_IGNORE)
  // The hardcoded greeting list no longer applies once a chat rule is configured.
  assert.equal(evaluateRules(cfg, '分析一下').action, ACTION_TRIGGER)
})

test('loop keywords trigger loop with loop modules', () => {
  const cfg = createDefaultConfig()
  const d = evaluateRules(cfg, '做一个仓库级跨文件重构并保持全局一致')
  assert.equal(d.action, ACTION_TRIGGER)
  assert.equal(d.pass, PASS_LOOP)
  assert.deepEqual(d.modules, ['capacity', 'broadcast', 'markers', 'self-monitoring'])
})

test('short workspace research routes to loop only when scope and synthesis intent are both present', () => {
  const cfg = createDefaultConfig()
  const d = evaluateRules(cfg, '深度调研此文件夹下的内容，todo、文件，了解我的画像与潜在的 DDL')
  assert.equal(d.action, ACTION_TRIGGER)
  assert.equal(d.pass, PASS_LOOP)
  assert.deepEqual(d.matched, ['workspace-research'])

  assert.equal(evaluateRules(cfg, '查看这个文件').action, ACTION_NONE)
})

test('standalone research intent routes to full', () => {
  const d = evaluateRules(createDefaultConfig(), '调研一下这个技术方案的可行性')
  assert.equal(d.action, ACTION_TRIGGER)
  assert.equal(d.pass, PASS_FULL)
  assert.deepEqual(d.matched, ['research'])
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

test('configuration normalizes unsupported values without disabling valid zero thresholds', () => {
  const cfg = mergeConfig({
    injectMode: 'system-section',
    trigger: { fullChars: 0, loopChars: -1, minScore: 0 },
  })
  assert.equal(cfg.injectMode, INJECT_MODE_NEAR_FIELD)
  assert.equal(cfg.trigger.fullChars, 0)
  assert.equal(cfg.trigger.loopChars, 1800)
  assert.equal(cfg.trigger.minScore, 1)

  assert.equal(mergeConfig({ injectMode: INJECT_MODE_NONE }).injectMode, INJECT_MODE_NONE)
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

test('score rules accept a per-rule threshold and expose their match evidence', () => {
  const cfg = mergeConfig({
    trigger: {
      minScore: 1,
      rules: [{
        id: 'precise-score',
        action: ACTION_TRIGGER,
        pass: PASS_FULL,
        matchMode: 'score',
        minScore: 2,
        patterns: ['架构', '风险', '测试'],
      }],
    },
  })
  assert.equal(evaluateRules(cfg, '分析架构').action, ACTION_NONE)
  const d = evaluateRules(cfg, '分析架构风险')
  assert.equal(d.action, ACTION_TRIGGER)
  assert.equal(d.threshold, 2)
  assert.equal(d.hitCount, 2)
  assert.deepEqual(d.matchedPatterns, ['架构', '风险'])
})

test('regular-expression rules work even when supplied without the global flag', () => {
  const cfg = mergeConfig({
    trigger: {
      rules: [
        {
          id: 'regexp',
          action: ACTION_TRIGGER,
          pass: PASS_FULL,
          patterns: [/hello/i],
        },
      ],
    },
  })
  assert.equal(evaluateRules(cfg, 'Hello there').action, ACTION_TRIGGER)
})

test('extractText handles nested message shape', () => {
  const data = {
    source: { kind: 'user' },
    message: { content: [{ type: 'text', text: '  hello world  ' }] },
  }
  assert.equal(extractText(data), 'hello world')
})

test('extractText handles the DSH rc.7 UserMessage content-block shape', () => {
  const data = {
    id: 'msg-1',
    role: 'user',
    source: { kind: 'user' },
    content: [
      { type: 'text', text: 'hello' },
      { type: 'text', text: 'world' },
    ],
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
  assert.match(text, /signals=/)
})
