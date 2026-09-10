import Anthropic from '@anthropic-ai/sdk'
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod'
import type { Plugin } from 'vite'
import { MeetingRequestSchema, buildSystemPrompt } from '../src/intent'

const readBody = (req: import('node:http').IncomingMessage): Promise<string> =>
  new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    req.on('data', (c) => chunks.push(c))
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
    req.on('error', reject)
  })

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
    server.middlewares.use('/api/parse', async (req, res) => {
      const send = (status: number, body: unknown) => {
        res.statusCode = status
        res.setHeader('content-type', 'application/json')
        res.end(JSON.stringify(body))
      }

      if (req.method !== 'POST') return send(405, { error: 'POST only' })
      if (!process.env.ANTHROPIC_API_KEY)
        return send(503, { error: 'ANTHROPIC_API_KEY not set — using local parser' })

      try {
        const { transcript } = JSON.parse(await readBody(req)) as { transcript?: string }
        if (!transcript?.trim()) return send(400, { error: 'empty transcript' })

        const client = new Anthropic()
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
