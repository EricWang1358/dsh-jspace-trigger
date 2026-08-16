// dsh-jspace-trigger: 可配置规则触发的 J-Space 轻量 DSH 插件。
//
// 设计要点：
// - 不做全局/每次会话强制注入；
// - 只监听真实用户消息；
// - 命中规则时才向 agent inbox 追加一条 near-field 提示；
// - 未命中规则时完全静默。
//
// 参考 dsh-routing-suite / dsh-router-jspace 的 `session/event` +
// `agent.inbox.append('next-step', ...)` 近场引导模式。

import {
  ACTION_TRIGGER,
  INJECT_MODE_NEAR_FIELD,
  buildGuideText,
  evaluateRules,
  extractText,
  formatDecision,
  mergeConfig,
} from './trigger-core.mjs'
import {
  installedSkillPaths,
  installJSpaceSkill,
  isSkillInstalled,
} from './skill-utils.mjs'

export const name = 'dsh-jspace-trigger'
export const inject = ['tools', 'systemPrompt', 'llm']

function toJsonSchema(spec) {
  if (!spec) return { type: 'object', properties: {}, additionalProperties: false }
  const properties = {}
  const required = []
  for (const [key, meta] of Object.entries(spec)) {
    const prop = { type: meta.type }
    if (Array.isArray(meta.enum)) prop.enum = meta.enum
    if (meta.description) prop.description = meta.description
    properties[key] = prop
    if (meta.required) required.push(key)
  }
  return { type: 'object', properties, required, additionalProperties: false }
}

export function apply(ctx, config = {}) {
  const cfg = mergeConfig(config)
  const agents = new Map() // session.id -> Agent
  const seen = new Set() // sid:eventId
  const seenOrder = []
  const seenIdlessEvents = new WeakSet()
  const metrics = {
    userEvents: 0,
    triggered: 0,
    injected: 0,
    observeOnly: 0,
    inboxFailures: 0,
    missingAgent: 0,
  }
  const recentHits = []

  const rememberHit = (session, event, decision) => {
    recentHits.push({
      sessionId: session?.id ?? null,
      eventId: event?.id ?? null,
      reason: decision.reason,
      pass: decision.pass,
      mode: cfg.injectMode,
      at: new Date().toISOString(),
    })
    if (recentHits.length > 20) recentHits.shift()
  }

  const rememberDeliveredEvent = (key, event) => {
    if (key) {
      if (seen.has(key)) return
      seen.add(key)
      seenOrder.push(key)
      if (seenOrder.length > 2000) seen.delete(seenOrder.shift())
      return
    }
    if (event && typeof event === 'object') seenIdlessEvents.add(event)
  }

  // 记录所有装配时可见的 agent，供后续 session/event 找到对应 inbox。
  ctx.on('system-prompt/assemble', async (_assembly, context, next) => {
    const assembled = await next()
    const agent = context?.agent
    if (agent?.session?.id) {
      agents.set(agent.session.id, agent)
    }
    return assembled
  })

  ctx.on('session/event', (session, event) => {
    if (event?.type !== 'user/message') return
    const data = event.data ?? {}
    if (data.source?.kind !== 'user') return

    const text = extractText(data)
    if (!text) return

    metrics.userEvents += 1
    const decision = evaluateRules(cfg, text)
    if (decision.action !== ACTION_TRIGGER) return
    metrics.triggered += 1
    rememberHit(session, event, decision)

    // `none` is deliberately observe-only: dry-runs and status still reveal
    // matches, but no extra message reaches the model.
    if (cfg.injectMode !== INJECT_MODE_NEAR_FIELD) {
      metrics.observeOnly += 1
      return
    }

    // 找到目标 agent 的 inbox
    const current = ctx.get('agent')
    let agent = current && current.session?.id === session?.id ? current : agents.get(session?.id)
    if (!agent || !agent.inbox) {
      metrics.missingAgent += 1
      return
    }

    // 同一轮只提示一次。无 event.id 时仍允许投递，避免因上游事件形状缺少
    // id 而把所有命中静默丢弃。
    const key = session?.id !== undefined && event?.id !== undefined
      ? `${session.id}:${event.id}`
      : null
    if (key && seen.has(key)) return
    if (!key && event && typeof event === 'object' && seenIdlessEvents.has(event)) return

    const guide = buildGuideText(decision, text, cfg, {
      missingSkill: !isSkillInstalled(cfg),
    })
    try {
      agent.inbox.append('next-step', {
        id: `jspace-trigger-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        role: 'user',
        source: { kind: 'plugin', plugin: name },
        content: [{ type: 'text', text: guide }],
      })
      rememberDeliveredEvent(key, event)
      metrics.injected += 1
    } catch (error) {
      metrics.inboxFailures += 1
      ctx.logger?.warn?.(`[${name}] inbox append failed: ${error?.message ?? error}`)
    }
  })

  const registerTool = (tool) => {
    try {
      ctx.effect(() => ctx.tools.register({
        ...tool,
        parameters: toJsonSchema(tool.parameters),
      }))
    } catch {
      // 重复注册/工具注册表不可用时跳过
    }
  }

  registerTool({
    name: 'jspace_trigger_status',
    description: 'Show dsh-jspace-trigger configuration and event/injection counters.',
    parameters: {},
    output: { schema: { type: 'string' }, render: (_a, v) => [{ type: 'text', text: v }] },
    execute() {
      return [
        `enabled=${cfg.enabled}`,
        `injectMode=${cfg.injectMode}`,
        `minScore=${cfg.trigger.minScore}`,
        `loopChars=${cfg.trigger.loopChars}`,
        `fullChars=${cfg.trigger.fullChars}`,
        `rules=${cfg.trigger.rules.length}`,
        `skillInstalled=${isSkillInstalled(cfg)}`,
        `installedSkillPaths=${installedSkillPaths(cfg).join(',') || '-'}`,
        `deduplicatedEvents=${seen.size}`,
        `userEvents=${metrics.userEvents}`,
        `triggered=${metrics.triggered}`,
        `injected=${metrics.injected}`,
        `observeOnly=${metrics.observeOnly}`,
        `inboxFailures=${metrics.inboxFailures}`,
        `missingAgent=${metrics.missingAgent}`,
        `recentHits=${recentHits.length}`,
      ].join('\n')
    },
  })

  registerTool({
    name: 'jspace_trigger_test',
    description: 'Dry-run a message through the configurable J-Space trigger rules and show the decision + guide text.',
    parameters: {
      text: { type: 'string', required: true, description: 'Message text to test' },
    },
    output: { schema: { type: 'string' }, render: (_a, v) => [{ type: 'text', text: v }] },
    execute(args) {
      const text = String(args?.text ?? '').trim()
      const decision = evaluateRules(cfg, text)
      const missingSkill = !isSkillInstalled(cfg)
      const guide = buildGuideText(decision, text, cfg, { missingSkill })
      const delivery = decision.action === ACTION_TRIGGER && cfg.injectMode !== INJECT_MODE_NEAR_FIELD
        ? `(not injected: injectMode=${cfg.injectMode})`
        : guide || '(silent)'
      return `${formatDecision(decision)}\nskillInstalled=${!missingSkill}\n---\n${delivery}`
    },
  })

  registerTool({
    name: 'jspace_install_skill',
    description: 'Explicitly install the J-Space Cognition Suite skill from its upstream GitHub repo into the DSH skill library. Never runs automatically.',
    parameters: {
      force: {
        type: 'boolean',
        description: 'Reinstall/overwrite even if the skill already exists (default false).',
      },
      root: {
        type: 'string',
        description: 'Optional skill root directory to install into. Defaults to the first configured skill root.',
      },
    },
    output: { schema: { type: 'string' }, render: (_a, v) => [{ type: 'text', text: v }] },
    async execute(args) {
      const preferredRoot = typeof args?.root === 'string' && args.root.trim() ? args.root.trim() : undefined
      try {
        const result = await installJSpaceSkill(cfg, {
          force: args?.force === true,
          preferredRoot,
        })
        if (result.ok) {
          return `J-Space skill installed at ${result.target}`
        }
        if (result.alreadyInstalled) {
          return `J-Space skill already installed at ${result.target}. Use force:true to reinstall.`
        }
        return `Install returned without result: ${JSON.stringify(result)}`
      } catch (error) {
        return `Install failed: ${error?.message ?? String(error)}`
      }
    },
  })

  ctx.logger?.info?.('[dsh-jspace-trigger] active')
}
