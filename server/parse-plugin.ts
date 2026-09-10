import Anthropic from '@anthropic-ai/sdk'
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Plugin } from 'vite'
import { MeetingRequestSchema, buildSystemPrompt } from '../src/intent'

const readBody = (req: import('node:http').IncomingMessage): Promise<string> =>
  new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    req.on('data', (c) => chunks.push(c))
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
    req.on('error', reject)
  })

/** Minimal KEY=VALUE reader for .env / .env.local — enough for one API key. */
const readEnvFile = (dir: string): Record<string, string> => {
  const out: Record<string, string> = {}
  for (const name of ['.env', '.env.local']) {
    let text: string
    try {
      text = readFileSync(join(dir, name), 'utf8')
    } catch {
      continue // absent is normal
    }
    for (const line of text.split('\n')) {
      const trimmed = line.trim()
      if (!trimmed || trimmed.startsWith('#')) continue
      const eq = trimmed.indexOf('=')
      if (eq === -1) continue
      const key = trimmed.slice(0, eq).trim().replace(/^export\s+/, '')
      const value = trimmed.slice(eq + 1).trim().replace(/^["']|["']$/g, '')
      if (key) out[key] = value
    }
  }
  return out
}

/**
 * Dev-only endpoint that parses a spoken request into a MeetingRequest.
 *
 * It lives in the Vite dev server purely so ANTHROPIC_API_KEY stays on this
 * side of the wire — calling Anthropic from the browser would ship the key in
 * the bundle. Any 4xx/5xx here makes the client fall back to its local parser,
 * so the feature degrades instead of breaking.
 */
export const parsePlugin = (): Plugin => ({
  name: 'clockwiser-parse-api',
  configureServer(server) {
    // Vite parses .env into import.meta.env and only exposes VITE_* to the
    // client — it never populates process.env, and loadEnv() didn't reliably
    // merge the file here either. So read it ourselves: a real env var wins,
    // otherwise fall back to the file. Dev-server-only; never in the bundle.
    const apiKey = process.env.ANTHROPIC_API_KEY || readEnvFile(server.config.envDir || server.config.root).ANTHROPIC_API_KEY

    server.config.logger.info(
      apiKey
        ? `  \x1b[32m➜\x1b[0m  parse api: using Claude (key …${apiKey.slice(-4)})`
        : `  \x1b[33m➜\x1b[0m  parse api: no ANTHROPIC_API_KEY — falling back to local parser`,
    )

    server.middlewares.use('/api/parse', async (req, res) => {
      const send = (status: number, body: unknown) => {
        res.statusCode = status
        res.setHeader('content-type', 'application/json')
        res.end(JSON.stringify(body))
      }

      if (req.method !== 'POST') return send(405, { error: 'POST only' })
      if (!apiKey) return send(503, { error: 'ANTHROPIC_API_KEY not set — using local parser' })

      try {
        const { transcript } = JSON.parse(await readBody(req)) as { transcript?: string }
        if (!transcript?.trim()) return send(400, { error: 'empty transcript' })

        const client = new Anthropic({ apiKey })
        const response = await client.messages.parse({
          model: 'claude-opus-5',
          max_tokens: 4000,
          system: buildSystemPrompt(),
          messages: [{ role: 'user', content: transcript }],
          // Low effort keeps this fast enough to feel instant after speech.
          output_config: { effort: 'low', format: zodOutputFormat(MeetingRequestSchema) },
        })

        if (response.stop_reason === 'refusal')
          return send(422, { error: 'refused', details: response.stop_details })
        if (!response.parsed_output) return send(422, { error: 'no structured output' })

        return send(200, { parsed: response.parsed_output, source: 'claude' })
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        console.error('[parse] ', message)
        return send(500, { error: message })
      }
    })
  },
})
