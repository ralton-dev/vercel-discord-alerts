import { createHmac, timingSafeEqual } from 'node:crypto'

/**
 * Vercel signs every webhook delivery: `x-vercel-signature` is the hex HMAC-SHA1
 * of the raw request body, keyed with the secret shown once when the webhook
 * was created. Each webhook has its own secret, so the relay accepts a list.
 */
export function isValidSignature(rawBody: string, signature: string | null, secrets: string[]): boolean {
  if (!signature || secrets.length === 0) return false
  const given = Buffer.from(signature.trim().toLowerCase(), 'utf8')
  return secrets.some((secret) => {
    const expected = Buffer.from(createHmac('sha1', secret).update(rawBody).digest('hex'), 'utf8')
    return expected.length === given.length && timingSafeEqual(expected, given)
  })
}

/** VERCEL_WEBHOOK_SECRETS: one or more secrets, comma-separated. */
export function secretsFromEnv(env: NodeJS.ProcessEnv = process.env): string[] {
  return (env.VERCEL_WEBHOOK_SECRETS ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
}
