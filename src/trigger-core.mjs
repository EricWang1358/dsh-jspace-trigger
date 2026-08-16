// trigger-core: 纯规则求值，零依赖，可单测。
//
// 设计目标：不搞一刀切注入。
// 优先级（默认按 rules 数组顺序短路）：
//   explicit > ignore > loop > full > 长度兜底 > none

export const PASS_FAST = 'fast'
export const PASS_FULL = 'full'
export const PASS_LOOP = 'loop'

export const ACTION_TRIGGER = 'trigger'
export const ACTION_IGNORE = 'ignore'
export const ACTION_NONE = 'none'

export const INJECT_MODE_NEAR_FIELD = 'near-field'
export const INJECT_MODE_NONE = 'none'

export const DEFAULT_LOOP_MODULES = ['capacity', 'broadcast', 'markers', 'self-monitoring']
export const DEFAULT_FULL_MODULES = ['deep-reasoning', 'self-monitoring']

const DEFAULT_RULES = [
  {
    id: 'explicit',
    action: ACTION_TRIGGER,
    pass: PASS_LOOP,
    modules: ['capacity', 'broadcast'],
    patterns: [
      '/j-space',
      'use j-space',
      '启用 j-space',
      '加载 j-space',
      'load j-space',
    ],
  },
  {
    id: 'chat',
    action: ACTION_IGNORE,
    pass: PASS_FAST,
    modules: [],
    patterns: [
      '^(你好|您好|hello|hi|hey|嗨|哈喽|在吗|谢谢|感谢|thanks|thank you|早上好|下午好|晚上好|嗯|好|ok|okay|yes|no|嗯嗯|好的)[!。.!？?~～]*$',
    ],
  },
  {
    id: 'loop',
    action: ACTION_TRIGGER,
    pass: PASS_LOOP,
    modules: DEFAULT_LOOP_MODULES,
    patterns: [
      '多阶段|多个文件|多轮|长程|长期|仓库级|跨文件|系统化|完整项目|长时|agentic|long-horizon|multi-stage|multi-file|multi-turn|repository-wide|workflow|loop',
    ],
  },
  {
    id: 'complex',
    action: ACTION_TRIGGER,
    pass: PASS_FULL,
    modules: DEFAULT_FULL_MODULES,
    patterns: [
      '重构|架构|全面|详细|设计|系统|优化|分析|审查|调试|排查|报错|修复|refactor|architecture|comprehensive|detailed|design|system|optimize|analyze|review|debug|fix',
    ],
  },
]

export function createDefaultConfig() {
  return {
    enabled: true,
    injectMode: INJECT_MODE_NEAR_FIELD,
    trigger: {
      minScore: 1,
      loopChars: 1800,
      fullChars: 120,
      rules: DEFAULT_RULES.map((rule) => ({ ...rule, patterns: [...rule.patterns] })),
    },
  }
}

function positiveInteger(value, fallback) {
  const number = Number(value)
  return Number.isFinite(number) && number > 0 ? Math.floor(number) : fallback
}

function nonNegativeInteger(value, fallback) {
  const number = Number(value)
  return Number.isFinite(number) && number >= 0 ? Math.floor(number) : fallback
}

function normalizeInjectMode(value, fallback) {
  return value === INJECT_MODE_NONE || value === INJECT_MODE_NEAR_FIELD ? value : fallback
}

export function mergeConfig(input) {
  const base = createDefaultConfig()
  if (!input || typeof input !== 'object') return base
  const out = {
    enabled: input.enabled !== false,
    injectMode: normalizeInjectMode(input.injectMode, base.injectMode),
    trigger: {
      minScore: positiveInteger(input.trigger?.minScore, base.trigger.minScore),
      loopChars: nonNegativeInteger(input.trigger?.loopChars, base.trigger.loopChars),
      fullChars: nonNegativeInteger(input.trigger?.fullChars, base.trigger.fullChars),
      rules: Array.isArray(input.trigger?.rules) ? input.trigger.rules : base.trigger.rules,
    },
  }
  return out
}

function compilePattern(pattern) {
  if (typeof pattern !== 'string' && !(pattern instanceof RegExp)) return null
  try {
    const source = pattern instanceof RegExp ? pattern.source : pattern
    const flags = pattern instanceof RegExp ? pattern.flags : 'i'
    return new RegExp(source, flags.includes('g') ? flags : `${flags}g`)
  } catch {
    return null
  }
}

function hitCount(regex, text) {
  try {
    regex.lastIndex = 0
    let count = 0
    for (const _ of text.matchAll(regex)) count += 1
    regex.lastIndex = 0
    return count
  } catch {
    return 0
  }
}

function matchRule(rule, text, minScore) {
  const patterns = Array.isArray(rule?.patterns) ? rule.patterns : []
  const regexes = patterns
    .map((pattern) => ({ pattern, regex: compilePattern(pattern) }))
    .filter((entry) => entry.regex !== null)

  if (regexes.length === 0) {
    return { matched: false, hits: 0, matchedPatterns: [] }
  }

  const mode = rule.matchMode ?? 'any'

  const matches = regexes.map(({ pattern, regex }) => ({ pattern, hits: hitCount(regex, text) }))

  if (mode === 'all') {
    const ok = matches.every(({ hits }) => hits > 0)
    return {
      matched: ok,
      hits: ok ? matches.reduce((sum, entry) => sum + entry.hits, 0) : 0,
      matchedPatterns: ok ? matches.map(({ pattern }) => pattern) : [],
    }
  }

  if (mode === 'score') {
    const hits = matches.reduce((sum, entry) => sum + entry.hits, 0)
    return {
      matched: hits >= minScore,
      hits,
      matchedPatterns: matches.filter(({ hits }) => hits > 0).map(({ pattern }) => pattern),
    }
  }

  // any
  const hits = matches.reduce((sum, entry) => sum + entry.hits, 0)
  return {
    matched: hits > 0,
    hits,
    matchedPatterns: matches.filter(({ hits }) => hits > 0).map(({ pattern }) => pattern),
  }
}

function decision(action, pass, modules, matched, reason, hitCount = 0) {
  return { action, pass, modules, matched, reason, hitCount }
}

export function isChatTask(text) {
  const t = String(text ?? '').trim()
  if (!t) return true
  const chatRule = DEFAULT_RULES.find((rule) => rule.id === 'chat')
  const result = matchRule(chatRule, t, 1)
  return result.matched
}

export function evaluateRules(config, text) {
  const cfg = mergeConfig(config)
  const t = String(text ?? '').trim()

  if (!cfg.enabled) {
    return decision(ACTION_NONE, PASS_FAST, [], [], 'disabled', 0)
  }
  if (!t) {
    return decision(ACTION_NONE, PASS_FAST, [], [], 'empty', 0)
  }

  const rules = Array.isArray(cfg.trigger.rules) ? cfg.trigger.rules : []
  const minScore = cfg.trigger.minScore

  for (const rule of rules) {
    const matched = matchRule(rule, t, minScore)
    if (!matched.matched) continue
    const action = rule.action || ACTION_TRIGGER
    const pass = rule.pass || (action === ACTION_IGNORE ? PASS_FAST : null)
    const modules = Array.isArray(rule.modules) ? rule.modules : []
    return decision(
      action,
      pass,
      modules,
      [rule.id || matched.matchedPatterns[0] || 'matched'],
      `rule:${rule.id || 'matched'}`,
      matched.hits,
    )
  }

  // 规则未命中：chat 让位、长度兜底
  if (isChatTask(t)) {
    return decision(ACTION_NONE, PASS_FAST, [], [], 'chat', 0)
  }

  const len = t.length
  if (cfg.trigger.loopChars > 0 && len > cfg.trigger.loopChars) {
    return decision(ACTION_TRIGGER, PASS_LOOP, DEFAULT_LOOP_MODULES, ['length-loop'], 'length-loop', 0)
  }
  if (cfg.trigger.fullChars > 0 && len > cfg.trigger.fullChars) {
    return decision(ACTION_TRIGGER, PASS_FULL, DEFAULT_FULL_MODULES, ['length-full'], 'length-full', 0)
  }

  return decision(ACTION_NONE, PASS_FAST, [], [], 'no-rule', 0)
}

export function extractText(data) {
  if (!data) return ''
  const payload =
    data && typeof data.message === 'object' && data.message !== null ? data.message : data
  const content = Array.isArray(payload.content) ? payload.content : []
  return content
    .map((c) => (typeof c === 'string' ? c : (c?.text ?? '')))
    .join(' ')
    .trim()
}

export function buildGuideText(decisionValue, text = '', config = {}) {
  if (!decisionValue || decisionValue.action !== ACTION_TRIGGER) return ''
  const cfg = mergeConfig(config)
  const passText = decisionValue.pass ? `J-space pass: ${decisionValue.pass}.` : ''
  const modules = Array.isArray(decisionValue.modules) ? decisionValue.modules : []
  const moduleText = modules.length ? ` Suggested modules: ${modules.join(', ')}.` : ''
  const prefix = cfg.injectMode === INJECT_MODE_NEAR_FIELD ? '[jspace-trigger] ' : ''
  return `${prefix}${passText}${moduleText} If this task needs structured workspace control, load the \`j-space\` skill and follow its gate.`.trim()
}

export function formatDecision(decisionValue) {
  if (!decisionValue) return ''
  return [
    `action=${decisionValue.action}`,
    `pass=${decisionValue.pass ?? '-'}`,
    `modules=${(decisionValue.modules ?? []).join(',') || '-'}`,
    `matched=${(decisionValue.matched ?? []).join(',') || '-'}`,
    `reason=${decisionValue.reason ?? '-'}`,
  ].join('\n')
}
