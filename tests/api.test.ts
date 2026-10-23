import { createHmac } from 'node:crypto'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { GET, POST } from '../api/vercel.js'
import { resetSeen } from '../src/dedupe.js'

const DISCORD = 'https://discord.example/api/webhooks/1/token'
const body = JSON.stringify({ type: 'deployment.error', payload: { name: 'site', target: 'production' } })
const sign = (secret: string, raw = body) => createHmac('sha1', secret).update(raw).digest('hex')

function post(raw: string, signature?: string): Request {
  return new Request('https://relay.test/api/vercel', {
    method: 'POST',
    headers: signature ? { 'x-vercel-signature': signature } : {},
    body: raw,
  })
}

function discordAnswering(status: number) {
  const fetchMock = vi.fn(async () => new Response(status === 204 ? null : 'nope', { status }))
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

describe('GET /api/vercel', () => {
  it('answers a liveness check', async () => {
    expect(await GET().json()).toEqual({ ok: true, service: 'vercel-discord-alerts' })
  })
})

describe('POST /api/vercel', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    resetSeen()
  })

  it('refuses to run until the secrets and the Discord URL are configured', async () => {
    vi.stubEnv('VERCEL_WEBHOOK_SECRETS', '')
    vi.stubEnv('DISCORD_WEBHOOK_URL', DISCORD)
    expect((await POST(post(body, sign('s')))).status).toBe(503)
  })

  it('rejects a delivery without a valid signature and never calls Discord', async () => {
    vi.stubEnv('VERCEL_WEBHOOK_SECRETS', 's')
    vi.stubEnv('DISCORD_WEBHOOK_URL', DISCORD)
    const fetchMock = discordAnswering(204)
    expect((await POST(post(body))).status).toBe(401)
    expect((await POST(post(body, sign('wrong')))).status).toBe(401)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('rejects a signed body that is not JSON', async () => {
    vi.stubEnv('VERCEL_WEBHOOK_SECRETS', 's')
    vi.stubEnv('DISCORD_WEBHOOK_URL', DISCORD)
    discordAnswering(204)
    expect((await POST(post('not json', sign('s', 'not json')))).status).toBe(400)
  })

  it('relays a signed event to Discord as an embed and answers 200', async () => {
    vi.stubEnv('VERCEL_WEBHOOK_SECRETS', 'team,spend')
    vi.stubEnv('DISCORD_WEBHOOK_URL', DISCORD)
    const fetchMock = discordAnswering(204)
    const res = await POST(post(body, sign('spend')))
    expect(res.status).toBe(200)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe(DISCORD)
    const sent = JSON.parse(String(init.body)) as { username: string; embeds: { title: string }[] }
    expect(sent.username).toBe('Vercel')
    expect(sent.embeds[0]?.title).toBe('Deployment failed · site')
  })

  it('posts a deployment event once when Vercel delivers it twice under different event ids', async () => {
    vi.stubEnv('VERCEL_WEBHOOK_SECRETS', 's')
    vi.stubEnv('DISCORD_WEBHOOK_URL', DISCORD)
    const fetchMock = discordAnswering(204)
    const first = JSON.stringify({
      id: 'evt_1',
      type: 'deployment.canceled',
      payload: { name: 'site', deployment: { id: 'dpl_1' } },
    })
    const second = JSON.stringify({
      id: 'evt_2',
      type: 'deployment.canceled',
      payload: { name: 'site', deployment: { id: 'dpl_1' } },
    })
    expect((await POST(post(first, sign('s', first)))).status).toBe(200)
    const dup = await POST(post(second, sign('s', second)))
    expect(await dup.json()).toEqual({ ok: true, duplicate: true })
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('asks Vercel to retry when Discord is down, but not when Discord refused the message', async () => {
    vi.stubEnv('VERCEL_WEBHOOK_SECRETS', 's')
    vi.stubEnv('DISCORD_WEBHOOK_URL', DISCORD)
    vi.spyOn(console, 'error').mockImplementation(() => {})
    discordAnswering(503)
    expect((await POST(post(body, sign('s')))).status).toBe(502)
    discordAnswering(400)
    const refused = await POST(post(body, sign('s')))
    expect(refused.status).toBe(200)
    expect(await refused.json()).toEqual({ ok: false, discordStatus: 400 })
  })
})
