import type { DiscordMessage } from './format'

export type DiscordResult =
  { ok: true; status: number } | { ok: false; status: number; detail: string; retryable: boolean }

/**
 * Posts one message to a Discord webhook URL. Discord answers 204 on success.
 * 429 and 5xx are worth retrying (Vercel retries a non-2xx delivery for 24 hours);
 * any other 4xx means the message itself was refused, so retrying cannot help.
 */
export async function postToDiscord(
  webhookUrl: string,
  message: DiscordMessage,
  fetchImpl: typeof fetch = fetch
): Promise<DiscordResult> {
  const res = await fetchImpl(webhookUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(message),
  })
  if (res.ok) return { ok: true, status: res.status }
  const detail = (await res.text().catch(() => '')).slice(0, 300)
  return { ok: false, status: res.status, detail, retryable: res.status === 429 || res.status >= 500 }
}
