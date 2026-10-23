/**
 * Vercel sometimes delivers the same deployment event twice, as two events with
 * different ids a second apart (seen with deployment.canceled). One Discord
 * message is the right outcome, so repeats of the same event type for the same
 * deployment are dropped for a while.
 *
 * The memory is per warm function instance: duplicates that land on different
 * instances both get through. That is the cheap, dependency-free trade-off; the
 * near-simultaneous pairs Vercel sends almost always hit the same instance.
 */

const DEFAULT_WINDOW_MS = 10 * 60 * 1000
const seen = new Map<string, number>()

type Dict = Record<string, unknown>
const dict = (v: unknown): Dict =>
  v !== null && typeof v === 'object' && !Array.isArray(v) ? (v as Dict) : {}
const text = (v: unknown): string | undefined => (typeof v === 'string' && v.trim() ? v.trim() : undefined)

/** The identity of a deployment event, or null for events that are not deduplicated. */
export function dedupeKey(body: unknown): string | null {
  const b = dict(body)
  const type = text(b.type)
  if (!type || !type.startsWith('deployment.')) return null
  const payload = dict(b.payload)
  const deploymentId = text(dict(payload.deployment).id) ?? text(payload.url)
  return deploymentId ? `${type}:${deploymentId}` : null
}

/** True when the key was already recorded inside the window; records it otherwise. */
export function seenRecently(key: string, now = Date.now(), windowMs = DEFAULT_WINDOW_MS): boolean {
  for (const [k, at] of seen) if (now - at > windowMs) seen.delete(k)
  const at = seen.get(key)
  if (at !== undefined && now - at <= windowMs) return true
  seen.set(key, now)
  return false
}

export function resetSeen(): void {
  seen.clear()
}
