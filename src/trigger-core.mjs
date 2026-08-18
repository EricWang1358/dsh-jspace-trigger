// trigger-core: 纯规则求值，零依赖，可单测。
//
// 设计目标：不搞一刀切注入。
// 优先级（默认按 rules 数组顺序短路）：
//   explicit opt-out > explicit opt-in > ignore > loop > full > 长度兜底 > none

export const PASS_FAST = 'fast'
export const PASS_FULL = 'full'
export const PASS_LOOP = 'loop'

export const ACTION_TRIGGER = 'trigger'
export const ACTION_IGNORE = 'ignore'
export const ACTION_NONE = 'none'

export const INJECT_MODE_NEAR_FIELD = 'near-field'
export const INJECT_MODE_NONE = 'none'

export const MISSING_SKILL_HINT = 'J-Space skill is not installed. Run `jspace_install_skill` to install it.'
export const DEFAULT_LOOP_MODULES = ['capacity', 'broadcast', 'markers', 'self-monitoring']
export const DEFAULT_FULL_MODULES = ['deep-reasoning', 'self-monitoring']

const DEFAULT_RULES = [
  {
    // A direct refusal is stronger than any content-based complexity signal.
    id: 'jspace-optout',
    action: ACTION_IGNORE,
    pass: PASS_FAST,
    modules: [],
    patterns: [
      '(?:不要|不需要|无需|别|禁止)\\s*(?:使用|use|加载|load)?\\s*(?:j-space|/j-space)',
      "(?:don't|do not|no)\\s+(?:use|load)\\s+(?:j-space|/j-space)",
    ],
  },
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
    // A request that explicitly declines J-Space must not be mistaken for an
    // explicit opt-in just because it contains the skill name.
    excludePatterns: [
      '(?:不要|不需要|无需|别|禁止)\\s*(?:使用|use|加载|load)?\\s*(?:j-space|/j-space)',
      "(?:don't|do not|no)\\s+(?:use|load)\\s+(?:j-space|/j-space)",
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
    // 短消息也可能要求跨文件盘点。两个信号必须同时存在，避免把“看这个文件”误判为 loop。
    id: 'workspace-research',
    action: ACTION_TRIGGER,
    pass: PASS_LOOP,
    modules: DEFAULT_LOOP_MODULES,
    matchMode: 'all',
    patterns: [
      '文件夹|目录|仓库|代码库|工作区|(?:todo|ddl).*(?:文件|列表|状态)|(?:文件|列表).*(?:todo|ddl)|folder|directory|repository|repo|workspace',
      '深度调研|调研|盘点|梳理|摸底|画像|审计|清查|研究|调查|分析|了解|research|investigate|survey|inventory|audit|profile',
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
    id: 'research',
    action: ACTION_TRIGGER,
    pass: PASS_FULL,
    modules: DEFAULT_FULL_MODULES,
    patterns: [
      '深度调研|调研|盘点|梳理|摸底|尽调|研究|调查|research|investigate|survey|inventory',
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
    analytics: {
      // Keep a small local funnel. It contains rule and tool metadata only,
      // never prompt text or tool arguments.
      enabled: true,
      maxRecords: 50,
    },
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
    analytics: {
      enabled: input.analytics?.enabled !== false,
      maxRecords: Math.min(500, positiveInteger(input.analytics?.maxRecords, base.analytics.maxRecords)),
    },
    trigger: {
      minScore: positiveInteger(input.trigger?.minScore, base.trigger.minScore),
      loopChars: nonNegativeInteger(input.trigger?.loopChars, base.trigger.loopChars),
      fullChars: nonNegativeInteger(input.trigger?.fullChars, base.trigger.fullChars),
      rules: Array.isArray(input.trigger?.rules) ? input.trigger.rules : base.trigger.rules,
    },
    skillRoots: Array.isArray(input.skillRoots) ? input.skillRoots : undefined,
    repoUrl: typeof input.repoUrl === 'string' ? input.repoUrl : undefined,
    branch: typeof input.branch === 'string' ? input.branch : undefined,
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

/**
 * Precompile one rule into reusable regexes. Every evaluation pass shares these
 * compiled regexes, so a hot `session/event` stream never re-parses rule
 * sources. Returns `null` for a rule with no valid pattern (still evaluated for
 * its action, e.g. `excludePatterns`-only opt-outs).
 */
function compileRule(rule) {
  const patterns = Array.isArray(rule?.patterns) ? rule.patterns : []
  const regexes = patterns
    .map((pattern) => ({ pattern, regex: compilePattern(pattern) }))
    .filter((entry) => entry.regex !== null)
  const excludePatterns = Array.isArray(rule?.excludePatterns) ? rule.excludePatterns : []
  const exclusions = excludePatterns
    .map((pattern) => ({ pattern, regex: compilePattern(pattern) }))
    .filter((entry) => entry.regex !== null)
  return { id: rule?.id, action: rule?.action, pass: rule?.pass, modules: rule?.modules, matchMode: rule?.matchMode, minScore: rule?.minScore, regexes, exclusions, validPatterns: regexes.length }
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

function matchCompiledRule(compiled, text, minScore) {
  const excludedPatterns = compiled.exclusions
    .filter(({ regex }) => hitCount(regex, text) > 0)
    .map(({ pattern }) => pattern)

  if (excludedPatterns.length > 0) {
    return {
      matched: false,
      hits: 0,
      matchedPatterns: [],
      excludedPatterns,
      threshold: null,
      validPatterns: compiled.validPatterns,
    }
  }

  if (compiled.regexes.length === 0) {
    return { matched: false, hits: 0, matchedPatterns: [], excludedPatterns, threshold: null, validPatterns: 0 }
  }

  const mode = compiled.matchMode ?? 'any'
  const matches = compiled.regexes.map(({ pattern, regex }) => ({ pattern, hits: hitCount(regex, text) }))

  if (mode === 'all') {
    const ok = matches.every(({ hits }) => hits > 0)
    return {
      matched: ok,
      hits: ok ? matches.reduce((sum, entry) => sum + entry.hits, 0) : 0,
      matchedPatterns: ok ? matches.map(({ pattern }) => pattern) : [],
      excludedPatterns,
      threshold: compiled.regexes.length,
      validPatterns: compiled.validPatterns,
    }
  }

  if (mode === 'score') {
    const hits = matches.reduce((sum, entry) => sum + entry.hits, 0)
    const threshold = positiveInteger(compiled.minScore, minScore)
    return {
      matched: hits >= threshold,
      hits,
      matchedPatterns: matches.filter(({ hits }) => hits > 0).map(({ pattern }) => pattern),
      excludedPatterns,
      threshold,
      validPatterns: compiled.validPatterns,
    }
  }

  // any
  const hits = matches.reduce((sum, entry) => sum + entry.hits, 0)
  return {
    matched: hits > 0,
    hits,
    matchedPatterns: matches.filter(({ hits }) => hits > 0).map(({ pattern }) => pattern),
    excludedPatterns,
    threshold: 1,
    validPatterns: compiled.validPatterns,
  }
}

function decision(action, pass, modules, matched, reason, evidence = {}) {
  return {
    action,
    pass,
    modules,
    matched,
    reason,
    hitCount: evidence.hitCount ?? 0,
    matchedPatterns: evidence.matchedPatterns ?? [],
    matchMode: evidence.matchMode ?? null,
    threshold: evidence.threshold ?? null,
    validPatterns: evidence.validPatterns ?? 0,
  }
}

// 内置安全规则：显式拒绝必须永远高于任何内容复杂度信号，且不能被自定义
// rules 数组意外覆盖掉。`chat` 同理保留为硬兜底，但允许通过配置覆盖关键词。
const BUILTIN_OPTOUT_ID = 'jspace-optout'
const BUILTIN_OPTOUT_RULE = DEFAULT_RULES.find((rule) => rule.id === BUILTIN_OPTOUT_ID)
const BUILTIN_CHAT_RULE = DEFAULT_RULES.find((rule) => rule.id === 'chat')

/**
 * 组装实际求值用的规则序列：
 *   1. 内置 opt-out（永远第一，保证“显式拒绝 > 一切”）。
 *   2. 用户/默认 rules（去掉与内置 opt-out 重复的同 id 项，避免被覆盖）。
 */
function resolveRules(configuredRules) {
  const userRules = Array.isArray(configuredRules) ? configuredRules.filter((r) => r?.id !== BUILTIN_OPTOUT_ID) : []
  const compiled = [BUILTIN_OPTOUT_RULE, ...userRules].map(compileRule)
  return compiled
}

export function isChatTask(text, config = {}) {
  const t = String(text ?? '').trim()
  if (!t) return true
  const cfg = mergeConfig(config)
  const chatRule = cfg.trigger.rules.find((rule) => rule?.id === 'chat') || BUILTIN_CHAT_RULE
  const compiled = compileRule(chatRule)
  return matchCompiledRule(compiled, t, 1).matched
}

export function evaluateRules(config, text) {
  const cfg = mergeConfig(config)
  const t = String(text ?? '').trim()

  if (!cfg.enabled) {
    return decision(ACTION_NONE, PASS_FAST, [], [], 'disabled')
  }
  if (!t) {
    return decision(ACTION_NONE, PASS_FAST, [], [], 'empty')
  }

  const minScore = cfg.trigger.minScore
  const compiledRules = resolveRules(cfg.trigger.rules)

  for (const rule of compiledRules) {
    const matched = matchCompiledRule(rule, t, minScore)
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
      {
        hitCount: matched.hits,
        matchedPatterns: matched.matchedPatterns,
        matchMode: rule.matchMode ?? 'any',
        threshold: matched.threshold,
        validPatterns: matched.validPatterns,
      },
    )
  }

  // 规则未命中：chat 让位、长度兜底
  if (isChatTask(t, cfg)) {
    return decision(ACTION_NONE, PASS_FAST, [], [], 'chat')
  }

  const len = t.length
  if (cfg.trigger.loopChars > 0 && len > cfg.trigger.loopChars) {
    return decision(ACTION_TRIGGER, PASS_LOOP, DEFAULT_LOOP_MODULES, ['length-loop'], 'length-loop', {
      threshold: cfg.trigger.loopChars,
    })
  }
  if (cfg.trigger.fullChars > 0 && len > cfg.trigger.fullChars) {
    return decision(ACTION_TRIGGER, PASS_FULL, DEFAULT_FULL_MODULES, ['length-full'], 'length-full', {
      threshold: cfg.trigger.fullChars,
    })
  }

  return decision(ACTION_NONE, PASS_FAST, [], [], 'no-rule')
}

export function extractText(data) {
  if (!data) return ''
  // DSH `user/message` data is a UserMessage { content: ContentBlock[] }.
  // Older harness payloads wrapped it under `data.message`; accept both.
  const payload =
    data && typeof data.message === 'object' && data.message !== null ? data.message : data
  const content = Array.isArray(payload.content) ? payload.content : []
  return content
    .map((block) => {
      if (typeof block === 'string') return block
      if (block && typeof block === 'object') {
        if (typeof block.text === 'string') return block.text
        if (typeof block.content === 'string') return block.content
      }
      return ''
    })
    .join(' ')
    .trim()
}

export function buildGuideText(decisionValue, text = '', config = {}, options = {}) {
  if (!decisionValue || decisionValue.action !== ACTION_TRIGGER) return ''
  const cfg = mergeConfig(config)
  const passText = decisionValue.pass ? `J-space pass: ${decisionValue.pass}.` : ''
  const modules = Array.isArray(decisionValue.modules) ? decisionValue.modules : []
  const moduleText = modules.length ? ` Suggested modules: ${modules.join(', ')}.` : ''
  const prefix = cfg.injectMode === INJECT_MODE_NEAR_FIELD ? '[jspace-trigger] ' : ''
  let guide = `${prefix}${passText}${moduleText} If this task needs structured workspace control, load the \`j-space\` skill and follow its gate.`.trim()
  if (options.missingSkill) {
    guide += `\n${MISSING_SKILL_HINT}`
  }
  return guide
}

export function formatDecision(decisionValue) {
  if (!decisionValue) return ''
  return [
    `action=${decisionValue.action}`,
    `pass=${decisionValue.pass ?? '-'}`,
    `modules=${(decisionValue.modules ?? []).join(',') || '-'}`,
    `matched=${(decisionValue.matched ?? []).join(',') || '-'}`,
    `reason=${decisionValue.reason ?? '-'}`,
    `matchMode=${decisionValue.matchMode ?? '-'}`,
    `hits=${decisionValue.hitCount ?? 0}`,
    `threshold=${decisionValue.threshold ?? '-'}`,
    `signals=${(decisionValue.matchedPatterns ?? []).join(' | ') || '-'}`,
  ].join('\n')
}
