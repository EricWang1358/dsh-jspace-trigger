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
import { createCallAnalytics } from './call-analysis.mjs'

export const name = 'dsh-jspace-trigger'
// `tools` (tool registration), `systemPrompt` (assemble watermark to learn
// agent/session associations), and `agents` (live agent registry) are the only
// hosts this plugin needs. Cordis resolves these service names; the live agent
// object itself is a Context property (`ctx.agent`), not a service.
export const inject = ['tools', 'systemPrompt', 'agents']

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
  const processed = new Map() // sid:eventId -> { decision, analyticsRecord }
  const processedOrder = []
  const processedIdlessEvents = new WeakMap()
  const analytics = createCallAnalytics(cfg.analytics)
  const metrics = {
    userEvents: 0,
    triggered: 0,
    injected: 0,
    observeOnly: 0,
    inboxFailures: 0,
    missingAgent: 0,
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

  const eventKey = (session, event) => (
    session?.id !== undefined && event?.id !== undefined ? `${session.id}:${event.id}` : null
  )

  const lookupProcessed = (key, event) => {
    if (key) return processed.get(key)
    return event && typeof event === 'object' ? processedIdlessEvents.get(event) : undefined
  }

  const rememberProcessed = (key, event, value) => {
    if (key) {
      processed.set(key, value)
      processedOrder.push(key)
      if (processedOrder.length > 2000) processed.delete(processedOrder.shift())
    } else if (event && typeof event === 'object') {
      processedIdlessEvents.set(event, value)
    }
  }

  // Resolve the live agent for a session id. DSH exposes the current agent as
  // `ctx.agent` (a Context property) and every live agent through `ctx.agents`
  // (the AgentRegistry service). On DSH 0.1.0-rc.7 the authoritative path is
  // `ctx.agents.get(sessionId)`; `ctx.agent` only applies when the plugin runs
  // inside an agent-scoped context.
  const resolveAgent = (sessionId) => {
    if (sessionId === undefined) return ctx.agent ?? undefined
    if (ctx.agent?.session?.id === sessionId) return ctx.agent
    const fromRegistry = typeof ctx.agents?.get === 'function' ? ctx.agents.get(sessionId) : undefined
    if (fromRegistry) return fromRegistry
    // Legacy-host fallback: some older harnesses carried `agent` on the
    // assemble context; rc.7's AssembleContext has no such field.
    return agents.get(sessionId)
  }

  // Best-effort agent association for hosts whose assemble context carries an
  // agent. On DSH rc.7 this never fires (AssembleContext scope/signal only), but
  // it is a cheap, safe fallback for older/compatible hosts. We must return
  // next()'s result unchanged to preserve the waterfall.
  ctx.on('system-prompt/assemble', async (_assembly, context, next) => {
    const assembled = await next()
    const agent = context?.agent
    if (agent?.session?.id) {
      agents.set(agent.session.id, agent)
    }
    return assembled
  })

  ctx.on('session/event', (session, event) => {
    if (event?.type === 'tool/call') {
      if (cfg.analytics.enabled) analytics.noteToolCall(session, event.data)
      return
    }
    if (event?.type !== 'user/message') return
    const data = event.data ?? {}
    if (data.source?.kind !== 'user') return

    const text = extractText(data)
    if (!text) return

    const key = eventKey(session, event)
    const prior = lookupProcessed(key, event)
    let decision = prior?.decision
    let analyticsRecord = prior?.analyticsRecord
    const firstObservation = prior === undefined
    if (firstObservation) {
      metrics.userEvents += 1
      if (cfg.analytics.enabled) analytics.closeTurn(session)
      decision = evaluateRules(cfg, text)
      if (decision.action === ACTION_TRIGGER) {
        metrics.triggered += 1
        if (cfg.analytics.enabled) analyticsRecord = analytics.start(session, event, decision)
      }
      rememberProcessed(key, event, { decision, analyticsRecord })
    }
    if (decision.action !== ACTION_TRIGGER) return

    // `none` is deliberately observe-only: dry-runs and status still reveal
    // matches, but no extra message reaches the model.
    if (cfg.injectMode !== INJECT_MODE_NEAR_FIELD) {
      if (firstObservation) {
        metrics.observeOnly += 1
        if (cfg.analytics.enabled) analytics.deliver(analyticsRecord, 'observe-only')
      }
      return
    }

    // 找到目标 agent 的 inbox
    const agent = resolveAgent(session?.id)
    if (!agent || !agent.inbox) {
      metrics.missingAgent += 1
      if (cfg.analytics.enabled) analytics.deliver(analyticsRecord, 'missing-agent')
      return
    }

    // 同一轮只提示一次。无 event.id 时仍允许投递，避免因上游事件形状缺少
    // id 而把所有命中静默丢弃。
    if (key && seen.has(key)) return
    if (!key && event && typeof event === 'object' && seenIdlessEvents.has(event)) return

    rememberDeliveredEvent(key, event)

    const guide = buildGuideText(decision, text, cfg, {
      missingSkill: !isSkillInstalled(cfg),
    })
    const guideMessage = {
      id: `jspace-trigger-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      role: 'user',
      source: { kind: 'plugin', plugin: name },
      content: [{ type: 'text', text: guide }],
    }

    // IMPORTANT: `session/event` for the user message is dispatched while the
    // owning `session.append` publication boundary is still open. A synchronous
    // `agent.inbox.append()` here would re-enter `session.append` and throw
    // "session append cannot reenter while another append is being published"
    // (verified against DSH 0.1.0-rc.7). Defer one microtask so the delivery
    // commits after the current publication unwinds.
    queueMicrotask(() => {
      try {
        const target = resolveAgent(session?.id)
        if (!target || !target.inbox) {
          // The agent may have been disposed between event dispatch and this
          // microtask; record a missing-agent/observe outcome instead of double
          // counting an inbox failure that is really a lifecycle race.
          if (cfg.analytics.enabled && analyticsRecord && analyticsRecord.delivery === 'pending') {
            analytics.deliver(analyticsRecord, 'missing-agent')
          }
          return
        }
        target.inbox.append('next-step', guideMessage)
        metrics.injected += 1
        if (cfg.analytics.enabled) analytics.deliver(analyticsRecord, 'injected')
      } catch (error) {
        metrics.inboxFailures += 1
        if (cfg.analytics.enabled) analytics.deliver(analyticsRecord, 'inbox-failure')
        ctx.logger?.warn?.(`[${name}] inbox append failed: ${error?.message ?? error}`)
      }
    })
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
        `analyticsEnabled=${cfg.analytics.enabled}`,
        `analyticsMaxRecords=${cfg.analytics.maxRecords}`,
        `minScore=${cfg.trigger.minScore}`,
        `loopChars=${cfg.trigger.loopChars}`,
        `fullChars=${cfg.trigger.fullChars}`,
        `rules=${cfg.trigger.rules.length}`,
        `skillInstalled=${isSkillInstalled(cfg)}`,
        `installedSkillPaths=${installedSkillPaths(cfg).join(',') || '-'}`,
        `deliveredEvents=${seen.size}`,
        `userEvents=${metrics.userEvents}`,
        `triggered=${metrics.triggered}`,
        `injected=${metrics.injected}`,
        `observeOnly=${metrics.observeOnly}`,
        `inboxFailures=${metrics.inboxFailures}`,
        `missingAgent=${metrics.missingAgent}`,
        `recentHits=${cfg.analytics.enabled ? analytics.snapshot({ limit: cfg.analytics.maxRecords }).records.length : 0}`,
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
    name: 'jspace_trigger_analytics',
    description: 'Inspect the privacy-safe trigger-to-tool-call funnel. It stores rule IDs, delivery outcomes, and tool names only—never prompt text or tool arguments.',
    parameters: {
      scope: { type: 'string', enum: ['current', 'all'], description: 'current session (default) or all in-memory sessions' },
      limit: { type: 'number', description: 'Maximum recent records to show (default 20; maximum 500)' },
    },
    output: { schema: { type: 'string' }, render: (_a, v) => [{ type: 'text', text: v }] },
    execute(args) {
      if (!cfg.analytics.enabled) return 'analytics is disabled by config.analytics.enabled=false'
      const current = ctx.agent
      if (args?.scope !== 'all' && !current?.session?.id) {
        return 'no current agent session; use scope=all only when cross-session metadata is intended'
      }
      const sessionId = args?.scope === 'all' ? undefined : current?.session?.id
      const snapshot = analytics.snapshot({ sessionId, limit: args?.limit })
      const totals = Object.entries(snapshot.totals).map(([key, value]) => `${key}=${value}`)
      const records = snapshot.records.length
        ? snapshot.records.map((record) => [
          `#${record.id}`,
          `at=${record.at}`,
          `session=${record.sessionId ?? '-'}`,
          `rule=${record.rule ?? '-'}`,
          `pass=${record.pass ?? '-'}`,
          `delivery=${record.delivery}`,
          `attempts=${record.deliveryAttempts}`,
          `toolCalls=${record.toolCalls}`,
          `firstTool=${record.firstTool ?? '-'}`,
          `jspaceSkillLoaded=${record.jspaceSkillLoaded}`,
        ].join(' ')).join('\n')
        : '(no triggered turns in scope)'
      return [
        `scope=${args?.scope === 'all' ? 'all' : 'current'}`,
        ...totals,
        `records=${snapshot.records.length}`,
        '---',
        records,
      ].join('\n')
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
