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
      get(key) {
        return key === 'agent' ? currentAgent : undefined
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

  assert.equal(appended.length, 1)
  assert.equal(appended[0][0], 'next-step')
  assert.match(appended[0][1].content[0].text, /J-space pass: full/)
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

  assert.equal(appended.length, 1)
})
