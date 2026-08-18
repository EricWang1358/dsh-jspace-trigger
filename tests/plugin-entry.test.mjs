import test from 'node:test'
import assert from 'node:assert/strict'
import { apply } from '../src/index.js'

function createContext(currentAgent = null) {
  const handlers = new Map()
  const tools = []
  return {
    handlers,
    tools,
    ctx: {
      on(event, handler) {
        handlers.set(event, handler)
      },
      // DSH rc.7 exposes the live agent as a Context property `ctx.agent`
      // (not a reflector service reachable through ctx.get()).
      agent: currentAgent,
      // Live agent registry: ctx.agents.get(sessionId) -> Agent.
      agents: {
        get(id) {
          return currentAgent?.session?.id === id ? currentAgent : undefined
        },
      },
      effect(callback) {
        callback()
      },
      tools: {
        register(tool) {
          tools.push(tool)
        },
      },
      logger: { info() {}, warn() {} },
    },
  }
}

function userEvent(id, text) {
  return {
    id,
    type: 'user/message',
    data: {
      source: { kind: 'user' },
      message: { content: [{ type: 'text', text }] },
    },
  }
}

// DSH rc.7 `session/event` for a real user message: event.data IS the
// UserMessage ({id, role, source, content}), with no nested `message`.
function rc7UserEvent(id, text) {
  return {
    id,
    type: 'user/message',
    data: {
      id,
      role: 'user',
      source: { kind: 'user' },
      content: [{ type: 'text', text }],
    },
  }
}

test('near-field mode injects once for a matched event in the matching session', async () => {
  const appended = []
  const agent = {
    session: { id: 'session-a' },
    inbox: { append: (...args) => appended.push(args) },
  }
  const { ctx, handlers } = createContext(agent)
  apply(ctx)

  await handlers.get('system-prompt/assemble')({}, { agent }, async () => 'assembled')
  const event = userEvent('event-1', '请重构这个项目')
  handlers.get('session/event')({ id: 'session-a' }, event)
  handlers.get('session/event')({ id: 'session-a' }, event)
  await Promise.resolve()

  assert.equal(appended.length, 1)
  assert.equal(appended[0][0], 'next-step')
  assert.match(appended[0][1].content[0].text, /J-space pass: full/)
})

test('near-field mode handles the DSH rc.7 user/message event shape', async () => {
  const appended = []
  const agent = {
    session: { id: 'session-a' },
    inbox: { append: (...args) => appended.push(args) },
  }
  const { ctx, handlers } = createContext(agent)
  apply(ctx)

  await handlers.get('system-prompt/assemble')({}, { agent }, async () => 'assembled')
  handlers.get('session/event')({ id: 'session-a' }, rc7UserEvent('event-rc7', '请重构这个项目'))
  await Promise.resolve()

  assert.equal(appended.length, 1)
  assert.match(appended[0][1].content[0].text, /J-space pass: full/)
})

test('an uploaded-image message never triggers a J-Space nudge', async () => {
  const appended = []
  const agent = {
    session: { id: 'session-a' },
    inbox: { append: (...args) => appended.push(args) },
  }
  const { ctx, handlers, tools } = createContext(agent)
  apply(ctx)

  await handlers.get('system-prompt/assemble')({}, { agent }, async () => 'assembled')
  const imageEvent = {
    id: 'img-1',
    type: 'user/message',
    data: {
      id: 'img-1',
      role: 'user',
      source: { kind: 'user' },
      content: [
        { type: 'image', attachment: { attachmentId: 'sha256:abc', mediaType: 'image/png', bytes: 99999, width: 1200, height: 800, name: 'long.png' } },
        { type: 'text', text: '看这张图' },
      ],
    },
  }
  handlers.get('session/event')({ id: 'session-a' }, imageEvent)
  await Promise.resolve()

  assert.equal(appended.length, 0)
  const status = tools.find((tool) => tool.name === 'jspace_trigger_status').execute()
  assert.match(status, /userEvents=0/)
  assert.match(status, /triggered=0/)
})

test('inbox append is deferred, avoiding session.append re-entrancy on DSH rc.7', async () => {
  const appended = []
  let publishing = false
  const agent = {
    session: { id: 'session-a' },
    inbox: {
      append(...args) {
        // The real DSH Session.append throws if an inbox append re-enters
        // while the owning user/message publication is still open.
        if (publishing) throw new Error('session append cannot reenter while another append is being published')
        appended.push(args)
      },
    },
  }
  const { ctx, handlers } = createContext(agent)
  apply(ctx)

  await handlers.get('system-prompt/assemble')({}, { agent }, async () => 'assembled')
  publishing = true
  try {
    handlers.get('session/event')({ id: 'session-a' }, userEvent('event-1', '请重构这个项目'))
  } finally {
    publishing = false
  }
  await Promise.resolve()

  assert.equal(appended.length, 1)
  assert.match(appended[0][1].content[0].text, /J-space pass: full/)
})

test('analytics links an injected trigger to a following J-Space skill call without retaining user text', async () => {
  const appended = []
  const agent = {
    session: { id: 'session-a' },
    inbox: { append: (...args) => appended.push(args) },
  }
  const { ctx, handlers, tools } = createContext(agent)
  apply(ctx)

  await handlers.get('system-prompt/assemble')({}, { agent }, async () => 'assembled')
  handlers.get('session/event')({ id: 'session-a' }, userEvent('event-1', '请重构这个项目，内部提示不得保留'))
  handlers.get('session/event')({ id: 'session-a' }, {
    id: 'call-1', type: 'tool/call', data: { name: 'skill', arguments: { name: 'j-space' } },
  })
  await Promise.resolve()

  const report = tools.find((tool) => tool.name === 'jspace_trigger_analytics').execute({ scope: 'current' })
  assert.equal(appended.length, 1)
  assert.match(report, /jspaceSkillCalls=1/)
  assert.match(report, /jspaceSkillLoaded=true/)
  assert.doesNotMatch(report, /不得保留/)
})

test('observe-only mode records a trigger without appending to an inbox', () => {
  const appended = []
  const agent = {
    session: { id: 'session-a' },
    inbox: { append: (...args) => appended.push(args) },
  }
  const { ctx, handlers, tools } = createContext(agent)
  apply(ctx, { injectMode: 'none' })

  handlers.get('session/event')({ id: 'session-a' }, userEvent('event-1', '请重构这个项目'))

  assert.equal(appended.length, 0)
  const status = tools.find((tool) => tool.name === 'jspace_trigger_status').execute()
  const dryRun = tools.find((tool) => tool.name === 'jspace_trigger_test').execute({ text: '请重构这个项目' })
  assert.match(status, /triggered=1/)
  assert.match(status, /observeOnly=1/)
  assert.match(dryRun, /not injected: injectMode=none/)
})

test('an agent from another session is never used as a delivery fallback', () => {
  const appended = []
  const currentAgent = {
    session: { id: 'session-a' },
    inbox: { append: (...args) => appended.push(args) },
  }
  const { ctx, handlers } = createContext(currentAgent)
  apply(ctx)

  handlers.get('session/event')({ id: 'session-b' }, userEvent('event-1', '请重构这个项目'))

  assert.equal(appended.length, 0)
})

test('a match is not permanently dropped when the agent becomes available after the event', async () => {
  const appended = []
  const agent = {
    session: { id: 'session-a' },
    inbox: { append: (...args) => appended.push(args) },
  }
  const { ctx, handlers, tools } = createContext()
  apply(ctx)

  const event = userEvent('event-1', '请重构这个项目')
  handlers.get('session/event')({ id: 'session-a' }, event)
  await handlers.get('system-prompt/assemble')({}, { agent }, async () => 'assembled')
  handlers.get('session/event')({ id: 'session-a' }, event)
  // Delivery is deferred one microtask to avoid re-entering session.append.
  await Promise.resolve()

  assert.equal(appended.length, 1)
  const status = tools.find((tool) => tool.name === 'jspace_trigger_status').execute()
  assert.match(status, /missingAgent=1/)
})

test('a matched event without an event id can still be delivered', async () => {
  const appended = []
  const agent = {
    session: { id: 'session-a' },
    inbox: { append: (...args) => appended.push(args) },
  }
  const { ctx, handlers } = createContext(agent)
  apply(ctx)

  await handlers.get('system-prompt/assemble')({}, { agent }, async () => 'assembled')
  const event = userEvent(undefined, '请重构这个项目')
  handlers.get('session/event')({ id: 'session-a' }, event)
  handlers.get('session/event')({ id: 'session-a' }, event)
  await Promise.resolve()

  assert.equal(appended.length, 1)
})
