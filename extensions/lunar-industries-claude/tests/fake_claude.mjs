#!/usr/bin/env node
// A fake Claude Code for the tests, run by the Agent SDK in its place (option pathToClaudeCodeExecutable).
// It speaks the SDK's protocol, one JSON object per line on stdin and stdout, and answers each message
// by what it says:
// - « outil »: asks to run a tool, then tells whether it was allowed;
// - « inconnu »: sends a message of a type the app does not know;
// - « accepte »: changes its permission mode to acceptEdits by itself;
// - anything else: answers « Reçu : <message> ».
import { createInterface } from 'node:readline'

const send = (m) => process.stdout.write(`${JSON.stringify(m)}\n`)
const arg = process.argv.find((a) => a.startsWith('--session-id=') || a.startsWith('--resume='))
const session = arg ? arg.split('=')[1] : 'unknown'
let uuid = 0
const next = () => `u${++uuid}`
let initialized = false
let waitingTool = null

const assistant = (content) =>
  send({
    type: 'assistant',
    session_id: session,
    parent_tool_use_id: null,
    uuid: next(),
    message: { role: 'assistant', content },
  })
const result = () =>
  send({
    type: 'result',
    subtype: 'success',
    is_error: false,
    session_id: session,
    total_cost_usd: 0.42,
    num_turns: 1,
    duration_ms: 1,
    duration_api_ms: 1,
    result: '',
    usage: {},
    // What the app keeps of a session's cost (see ClaudeSession.setUsage).
    modelUsage: {
      'claude-opus-5': {
        inputTokens: 10,
        outputTokens: 20,
        cacheReadInputTokens: 30,
        cacheCreationInputTokens: 40,
        webSearchRequests: 0,
        costUSD: 0.42,
        costBasis: 'list',
      },
    },
    uuid: next(),
  })
const success = (request, response = {}) =>
  send({ type: 'control_response', response: { subtype: 'success', request_id: request, response } })

// What a message asks for, by a word it contains: a command (with a rule to allow it for the session), a
// file edit, a plan to validate, a question.
const ASKS = [
  {
    word: 'outil',
    tool: 'Bash',
    input: { command: 'ls' },
    suggestions: [
      {
        type: 'addRules',
        rules: [{ toolName: 'Bash', ruleContent: 'ls' }],
        behavior: 'allow',
        destination: 'session',
      },
    ],
  },
  {
    word: 'modifie',
    tool: 'Edit',
    input: { file_path: '/w/app/a.ts', old_string: 'const a = 1', new_string: 'const a = 2' },
  },
  { word: 'plan', tool: 'ExitPlanMode', input: { plan: '1. Lire la tâche\n2. Écrire le code' } },
  {
    word: 'question',
    tool: 'AskUserQuestion',
    input: {
      questions: [
        {
          question: 'Quelle base ?',
          header: 'Base',
          options: [
            { label: 'launchpad', description: 'La branche d’intégration' },
            { label: 'main', description: 'La branche par défaut' },
          ],
          multiSelect: false,
        },
      ],
    },
  },
]

async function answer(text) {
  if (!initialized) {
    initialized = true
    send({
      type: 'system',
      subtype: 'init',
      session_id: session,
      model: 'fake',
      claude_code_version: '0.0.0',
      // As Claude Code says it: the API key of its environment, else its login.
      apiKeySource: process.env.ANTHROPIC_API_KEY ? 'ANTHROPIC_API_KEY' : 'none',
      tools: [],
      mcp_servers: [],
      cwd: process.cwd(),
      permissionMode: 'default',
      slash_commands: [],
      skills: ['workspace:task-to-staging', 'mon-skill'],
      uuid: next(),
    })
  }
  const asked = ASKS.find((a) => text.includes(a.word))
  if (asked) {
    assistant([{ type: 'tool_use', id: 'tool1', name: asked.tool, input: asked.input }])
    waitingTool = 'perm1'
    send({
      type: 'control_request',
      request_id: 'perm1',
      request: {
        subtype: 'can_use_tool',
        tool_name: asked.tool,
        input: asked.input,
        tool_use_id: 'tool1',
        permission_suggestions: asked.suggestions ?? [],
      },
    })
    return
  }
  // Claude Code leaves a mode by itself, as when a plan is accepted.
  if (text.includes('accepte')) {
    send({ type: 'system', subtype: 'status', status: null, permissionMode: 'acceptEdits', session_id: session, uuid: next() })
  }
  if (text.includes('inconnu')) {
    send({ type: 'mystery_event', session_id: session, text: 'Un message venu du futur', uuid: next() })
  }
  if (text.includes('markdown')) {
    const md = [
      '## Plan',
      '',
      'Je vais **modifier** deux fichiers :',
      '',
      '1. `routes.ts` : ajouter la route',
      '2. `days_controller.ts` : écrire le CSV',
      '',
      '```ts',
      "router.get('week/:day/csv', [controllers.Days, 'csv'])",
      '```',
      '',
      '| Fichier | Lignes |',
      '|---|---|',
      '| routes.ts | +1 |',
      '',
      '> Les parts sont déjà calculées.',
    ].join('\n')
    for (let i = 0; i < 12; i++) assistant([{ type: 'text', text: md }])
    result()
    return
  }
  // The text as it is written (option includePartialMessages), then the complete message.
  for (const piece of ['Reçu', ' : ', text]) {
    await new Promise((r) => setTimeout(r, 40))
    send({
      type: 'stream_event',
      session_id: session,
      parent_tool_use_id: null,
      uuid: next(),
      event: { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: piece } },
    })
  }
  assistant([{ type: 'text', text: `Reçu : ${text}` }])
  result()
}

// The models Claude Code offers, as its answer to the SDK's `initialize`.
const MODELS = [
  {
    value: 'opus',
    displayName: 'Opus',
    description: 'Le plus capable',
    supportsEffort: true,
    supportedEffortLevels: ['low', 'medium', 'high', 'xhigh', 'max'],
  },
  { value: 'haiku', displayName: 'Haiku', description: 'Le plus rapide', supportsEffort: false },
]

for await (const line of createInterface({ input: process.stdin })) {
  const m = JSON.parse(line)
  if (m.type === 'control_request') {
    const { subtype } = m.request
    success(m.request_id, subtype === 'initialize' ? { commands: [], models: MODELS } : {})
    // What the SDK asked to change, for the tests to read.
    if (subtype === 'set_model' || subtype === 'apply_flag_settings') {
      send({ type: 'system', subtype: 'asked', session_id: session, text: JSON.stringify(m.request), uuid: next() })
    }
  } else if (m.type === 'control_response' && m.response.request_id === waitingTool) {
    waitingTool = null
    // The tool's result is the decision received, for the tests to read.
    const decision = m.response.response ?? {}
    const allowed = decision.behavior === 'allow'
    send({
      type: 'user',
      session_id: session,
      parent_tool_use_id: null,
      uuid: next(),
      message: {
        role: 'user',
        content: [
          { type: 'tool_result', tool_use_id: 'tool1', content: JSON.stringify(decision), is_error: !allowed },
        ],
      },
    })
    assistant([{ type: 'text', text: allowed ? 'Outil lancé' : 'Outil refusé' }])
    result()
  } else if (m.type === 'user') {
    const content = m.message.content
    await answer(typeof content === 'string' ? content : '')
  }
}
