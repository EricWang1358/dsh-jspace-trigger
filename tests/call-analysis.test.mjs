import test from 'node:test'
import assert from 'node:assert/strict'
import {
  createCallAnalytics,
  extractToolCall,
  isJSpaceSkillCall,
} from '../src/call-analysis.mjs'

test('tool-call extraction supports common DSH shapes without retaining arguments', () => {
  const call = extractToolCall({ tool: { name: 'skill', input: { name: 'j-space' } } })
  assert.equal(call.name, 'skill')
  assert.equal(isJSpaceSkillCall(call), true)
})

test('analytics correlates a trigger with a later J-Space skill call and stores metadata only', () => {
  const analytics = createCallAnalytics({ maxRecords: 2 })
  const session = { id: 'session-a' }
  const record = analytics.start(session, { id: 'event-1' }, {
    matched: ['workspace-research'], reason: 'rule:workspace-research', pass: 'loop', hitCount: 2,
  })
  analytics.deliver(record, 'injected')
  analytics.noteToolCall(session, { name: 'skill', arguments: { name: 'j-space', secretPrompt: 'do not retain this' } })

  const snapshot = analytics.snapshot({ sessionId: 'session-a' })
  assert.equal(snapshot.totals.triggered, 1)
  assert.equal(snapshot.totals.delivered, 1)
  assert.equal(snapshot.totals.jspaceSkillCalls, 1)
  assert.equal(snapshot.records[0].jspaceSkillLoaded, true)
  assert.equal(snapshot.records[0].firstTool, 'skill')
  assert.doesNotMatch(JSON.stringify(snapshot), /secretPrompt|do not retain this/)
})

test('a new user turn closes correlation, so later calls are not attributed to the old trigger', () => {
  const analytics = createCallAnalytics()
  const session = { id: 'session-a' }
  analytics.start(session, { id: 'event-1' }, { matched: ['complex'], reason: 'rule:complex', pass: 'full' })
  analytics.closeTurn(session)
  analytics.noteToolCall(session, { name: 'skill', arguments: { name: 'j-space' } })

  const snapshot = analytics.snapshot()
  assert.equal(snapshot.totals.toolCalls, 1)
  assert.equal(snapshot.totals.correlatedToolCalls, 0)
  assert.equal(snapshot.totals.jspaceSkillCalls, 0)
  assert.equal(snapshot.records[0].toolCalls, 0)
})

test('extractToolCall reads the DSH rc.7 tool/call shape {name, arguments: JSON string}', () => {
  const call = extractToolCall({
    turn: 1, step: 1, callId: 'call-1', name: 'skill', arguments: '{"name":"j-space"}',
  })
  assert.equal(call.name, 'skill')
  assert.equal(isJSpaceSkillCall(call), true)
})

test('isJSpaceSkillCall detects j-space in parsed JSON arguments of a non-skill tool name', () => {
  const call = extractToolCall({ name: 'load_skill', arguments: '{"skillName":"j-space"}' })
  assert.equal(isJSpaceSkillCall(call), true)
})

test('plugin diagnostic tools whose names merely contain "jspace" do not count as J-Space loaded', () => {
  const statusCall = extractToolCall({ name: 'jspace_trigger_status' })
  assert.equal(statusCall.name, 'jspace_trigger_status')
  assert.equal(isJSpaceSkillCall(statusCall), false)

  const testCall = extractToolCall({ name: 'jspace_trigger_test', arguments: '{"text":"j-space"}' })
  assert.equal(isJSpaceSkillCall(testCall), false)

  const analyticsCall = extractToolCall({ name: 'jspace_trigger_analytics' })
  assert.equal(isJSpaceSkillCall(analyticsCall), false)
})

test('only the actual skill loader resolving to name=j-space counts as loaded', () => {
  // A skill call for a DIFFERENT skill is not J-Space.
  assert.equal(isJSpaceSkillCall(extractToolCall({ name: 'skill', arguments: '{"name":"some-other-skill"}' })), false)
  // A skill call whose argument text merely mentions j-space in prose is not a name match.
  assert.equal(isJSpaceSkillCall(extractToolCall({ name: 'skill', arguments: '{"name":"use j-space please"}' })), false)
  // The canonical loader with the exact skill name counts.
  assert.equal(isJSpaceSkillCall(extractToolCall({ name: 'skill', arguments: '{"name":"j-space"}' })), true)
})
