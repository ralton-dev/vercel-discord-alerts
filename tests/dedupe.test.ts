import { afterEach, describe, expect, it } from 'vitest'
import { dedupeKey, resetSeen, seenRecently } from '../src/dedupe.js'

describe('dedupeKey', () => {
  it('identifies a deployment event by type and deployment id, falling back to the deployment url', () => {
    expect(dedupeKey({ type: 'deployment.error', payload: { deployment: { id: 'dpl_1' } } })).toBe(
      'deployment.error:dpl_1'
    )
    expect(dedupeKey({ type: 'deployment.error', payload: { url: 'site-abc.vercel.app' } })).toBe(
      'deployment.error:site-abc.vercel.app'
    )
  })
  it('does not deduplicate other events', () => {
    expect(dedupeKey({ type: 'firewall.attack', payload: { deployment: { id: 'dpl_1' } } })).toBeNull()
    expect(dedupeKey({ budgetAmount: 1, thresholdPercent: 100 })).toBeNull()
    expect(dedupeKey({ type: 'deployment.error', payload: {} })).toBeNull()
  })
})

describe('seenRecently', () => {
  afterEach(() => resetSeen())
  it('reports a repeat inside the window and forgets it afterwards', () => {
    expect(seenRecently('k', 1000)).toBe(false)
    expect(seenRecently('k', 2000)).toBe(true)
    expect(seenRecently('k', 1000 + 10 * 60 * 1000 + 1)).toBe(false)
  })
  it('keeps keys apart', () => {
    expect(seenRecently('a', 1000)).toBe(false)
    expect(seenRecently('b', 1000)).toBe(false)
  })
})
