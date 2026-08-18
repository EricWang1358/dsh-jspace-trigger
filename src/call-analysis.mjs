// Bounded, privacy-safe funnel for one user turn:
// rule decision -> delivery outcome -> subsequent tool calls.
// It stores no user prompt and no tool arguments.

const DEFAULT_MAX_RECORDS = 50

export function normalizeMaxRecords(value, fallback = DEFAULT_MAX_RECORDS) {
  const number = Number(value)
  if (!Number.isFinite(number) || number <= 0) return fallback
  return Math.min(500, Math.floor(number))
}

function pickString(...values) {
  return values.find((value) => typeof value === 'string' && value.trim())?.trim() ?? ''
}

function compactArgumentText(value) {
  if (typeof value === 'string') return value.slice(0, 1000)
  if (!value || typeof value !== 'object') return ''
  try { return JSON.stringify(value).slice(0, 1000) } catch { return '' }
}

export function extractToolCall(data) {
  // DSH `tool/call` data (rc.7): { turn, step, callId, name, arguments: string }
  // where `arguments` is the raw JSON string the model produced. Older hosts or
  // synthetic mocks have used `{ call: {...} }` with `args`/`input` objects.
  const payload = data?.call && typeof data.call === 'object' ? data.call : (data ?? {})
  const name = pickString(
    payload.name,
    payload.toolName,
    payload.tool?.name,
    payload.function?.name,
    payload.tool_call?.function?.name,
  )
  const args = payload.arguments ?? payload.args ?? payload.input ?? payload.tool?.input ?? payload.function?.arguments
  return { name, argumentText: compactArgumentText(args) }
}

/**
 * Decode the "was the J-Space skill actually loaded?" signal.
 *
 * Ground truth on DSH 0.1.0-rc.7: the model loads a skill by calling the
 * built-in `skill` tool with `{ "name": "<skill-name>" }`. Anything else —
 * including this plugin's own `jspace_trigger_status` / `jspace_trigger_test`
 * tools, whose names merely CONTAIN "jspace" — is NOT evidence that J-Space was
 * loaded. Counting those would pollute the product's core "did the nudge work?"
 * metric, so we only accept the exact `skill -> name=j-space` shape (plus a few
 * equivalent transport spellings for older hosts).
 */
export function isJSpaceSkillCall(call) {
  const name = String(call?.name ?? '').trim()
  if (!name) return false
  const lower = name.toLowerCase()

  // The canonical DSH `skill` loader tool.
  if (lower === 'skill' || lower === 'skills') {
    return skillArgsNameIsJSpace(call)
  }

  // Legacy/transport spellings that load a skill by name.
  if (/^(?:load[-_. ]?skill|dsh[-_. ]?tool[-_. ]?skill)$/.test(lower)) {
    return skillArgsNameIsJSpace(call)
  }

  // `tool_skill` / `skills_loader`-style names seen on some hosts; still require
  // a j-space name argument, never a bare name substring.
  if (/\bskill(s)?\b/.test(lower) && skillArgsNameIsJSpace(call)) {
    return true
  }

  return false
}

function skillArgsNameIsJSpace(call) {
  const raw = call?.argumentText
  if (typeof raw !== 'string' || !raw) return false
  const text = raw.toLowerCase()
  // Direct string argument (pre-parsed shape) or JSON-string argument.
  if (text.trim().startsWith('j-space') || /^["']?j[ -]?space["']?$/.test(text.trim())) {
    return true
  }
  let parsed = null
  try { parsed = JSON.parse(raw) } catch { /* not JSON */ }
  if (parsed && typeof parsed === 'object') {
    const name = parsed.name ?? parsed.skill ?? parsed.skillName
    return typeof name === 'string' && /^j[ -]?space$/.test(name.trim().toLowerCase())
  }
  return false
}

export function createCallAnalytics(options = {}) {
  const maxRecords = normalizeMaxRecords(options.maxRecords)
  const records = []
  const pendingBySession = new Map()
  let sequence = 0
  const totals = {
    triggered: 0,
    delivered: 0,
    observeOnly: 0,
    missingAgent: 0,
    inboxFailure: 0,
    toolCalls: 0,
    correlatedToolCalls: 0,
    jspaceSkillCalls: 0,
  }

  function trim() {
    while (records.length > maxRecords) {
      const removed = records.shift()
      if (removed?.sessionId && pendingBySession.get(removed.sessionId) === removed) {
        pendingBySession.delete(removed.sessionId)
      }
    }
  }

  function start(session, event, decision) {
    const record = {
      id: ++sequence,
      sessionId: session?.id ?? null,
      eventId: event?.id ?? null,
      at: new Date().toISOString(),
      rule: decision.matched?.[0] ?? null,
      reason: decision.reason,
      pass: decision.pass ?? null,
      hits: decision.hitCount ?? 0,
      delivery: 'pending',
      deliveryAttempts: 0,
      toolCalls: 0,
      firstTool: null,
      jspaceSkillLoaded: false,
    }
    records.push(record)
    trim()
    if (record.sessionId) pendingBySession.set(record.sessionId, record)
    totals.triggered += 1
    return record
  }

  function deliver(record, outcome) {
    if (!record) return
    record.delivery = outcome
    record.deliveryAttempts += 1
    if (outcome === 'injected') totals.delivered += 1
    else if (outcome === 'observe-only') totals.observeOnly += 1
    else if (outcome === 'missing-agent') totals.missingAgent += 1
    else if (outcome === 'inbox-failure') totals.inboxFailure += 1
  }

  function noteToolCall(session, data) {
    totals.toolCalls += 1
    const record = pendingBySession.get(session?.id)
    if (!record) return null
    const call = extractToolCall(data)
    record.toolCalls += 1
    record.firstTool ??= call.name || '(unknown)'
    totals.correlatedToolCalls += 1
    if (isJSpaceSkillCall(call)) {
      record.jspaceSkillLoaded = true
      totals.jspaceSkillCalls += 1
    }
    return record
  }

  function closeTurn(session) {
    pendingBySession.delete(session?.id)
  }

  function snapshot({ sessionId, limit } = {}) {
    const cappedLimit = normalizeMaxRecords(limit, 20)
    const selected = records
      .filter((record) => !sessionId || record.sessionId === sessionId)
      .slice(-cappedLimit)
      .reverse()
      .map(({ sessionId: id, eventId, ...record }) => ({ ...record, sessionId: id, eventId }))
    return { totals: { ...totals }, records: selected }
  }

  return { start, deliver, noteToolCall, closeTurn, snapshot }
}
