import { formatEvent } from '../src/format.js'
import { postToDiscord } from '../src/discord.js'
import { isValidSignature, secretsFromEnv } from '../src/verify.js'

export const config = { maxDuration: 10 }

/** A liveness check with nothing sensitive in it. */
export function GET(): Response {
  return Response.json({ ok: true, service: 'vercel-discord-alerts' })
}

/**
 * The webhook target. Point Vercel's team webhooks and the Spend Management
 * webhook at this URL. Every delivery must carry a valid x-vercel-signature;
 * without the secrets and the Discord URL configured the relay refuses to run.
 */
export async function POST(request: Request): Promise<Response> {
  const secrets = secretsFromEnv()
  const discordUrl = process.env.DISCORD_WEBHOOK_URL
  if (secrets.length === 0 || !discordUrl) {
    return Response.json({ error: 'Relay not configured' }, { status: 503 })
  }

  const rawBody = await request.text()
  if (!isValidSignature(rawBody, request.headers.get('x-vercel-signature'), secrets)) {
    return Response.json({ error: 'Bad signature' }, { status: 401 })
  }

  let body: unknown
  try {
    body = JSON.parse(rawBody)
  } catch {
    return Response.json({ error: 'Body is not JSON' }, { status: 400 })
  }

  const result = await postToDiscord(discordUrl, formatEvent(body))
  if (result.ok) return Response.json({ ok: true })

  console.error(`[vercel-discord-alerts] Discord answered ${result.status}: ${result.detail}`)
  return result.retryable
    ? Response.json({ error: 'Discord unavailable, please retry' }, { status: 502 })
    : Response.json({ ok: false, discordStatus: result.status })
}
