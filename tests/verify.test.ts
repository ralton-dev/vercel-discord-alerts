import { createHmac } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { isValidSignature, secretsFromEnv } from '../src/verify'

const body = '{"type":"deployment.error"}'
const sign = (secret: string) => createHmac('sha1', secret).update(body).digest('hex')

describe('isValidSignature', () => {
  it('accepts the HMAC-SHA1 of the raw body under a configured secret', () => {
    expect(isValidSignature(body, sign('s1'), ['s1'])).toBe(true)
  })
  it('accepts any of several secrets, so each webhook can keep its own', () => {
    expect(isValidSignature(body, sign('spend'), ['team', 'spend'])).toBe(true)
  })
  it('rejects a signature made with another secret, a missing header, or no configured secrets', () => {
    expect(isValidSignature(body, sign('other'), ['s1'])).toBe(false)
    expect(isValidSignature(body, null, ['s1'])).toBe(false)
    expect(isValidSignature(body, sign('s1'), [])).toBe(false)
  })
  it('rejects a signature of a different body', () => {
    expect(isValidSignature(body + ' ', sign('s1'), ['s1'])).toBe(false)
  })
  it('is case-insensitive about the hex digest', () => {
    expect(isValidSignature(body, sign('s1').toUpperCase(), ['s1'])).toBe(true)
  })
})

describe('secretsFromEnv', () => {
  it('splits VERCEL_WEBHOOK_SECRETS on commas and drops blanks', () => {
    expect(secretsFromEnv({ VERCEL_WEBHOOK_SECRETS: ' a , b,,c ' })).toEqual(['a', 'b', 'c'])
    expect(secretsFromEnv({})).toEqual([])
  })
})
