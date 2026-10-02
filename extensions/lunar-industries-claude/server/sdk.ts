import { createRequire } from 'node:module'

type Sdk = typeof import('@anthropic-ai/claude-agent-sdk')

let loaded: Sdk | null = null

/**
 * Taken from quack-board (connectors/claude_sdk.ts): the Agent SDK, loaded on first use (the sessions are often off),
 * with require() rather than import. Its main entry starts with a `#!` line, which a loader putting code before
 * every ES module turns into a syntax error; require() of an ES module does not go through such loaders.
 */
export function sdk(): Sdk {
  // require() answers untyped: the module is the SDK's (its types are `Sdk`).
  const found: Sdk = loaded ?? createRequire(import.meta.url)('@anthropic-ai/claude-agent-sdk')
  loaded = found
  return found
}
