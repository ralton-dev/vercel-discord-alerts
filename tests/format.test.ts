import { describe, expect, it } from 'vitest'
import { AMBER, formatEvent, GREEN, GREY, RED } from '../src/format.js'

const deploymentError = {
  id: 'evt_123',
  type: 'deployment.error',
  createdAt: 1792768499788,
  payload: {
    name: 'complete_catering_service',
    target: 'production',
    url: 'completecateringservice-abc123-braltons-projects.vercel.app',
    links: {
      deployment: 'https://vercel.com/braltons-projects/complete_catering_service/dpl_1',
      project: 'https://vercel.com/braltons-projects/complete_catering_service',
    },
    deployment: {
      id: 'dpl_1',
      meta: {
        githubCommitRef: 'main',
        githubCommitSha: 'e925f2dd8e8b1b669d0fff270f2bacf9d6a244e3',
        githubCommitMessage: 'feat(deploy): SEED_FORCE, a one-shot re-seed bound to one commit SHA',
        githubCommitAuthorLogin: 'bralton',
      },
    },
    project: { id: 'prj_1' },
  },
}

describe('formatEvent', () => {
  it('turns a failed deployment into a red embed with the project, branch, commit and dashboard link', () => {
    const { embeds, username } = formatEvent(deploymentError)
    expect(username).toBe('Vercel')
    const [embed] = embeds
    expect(embed?.title).toBe('Deployment failed · complete_catering_service')
    expect(embed?.color).toBe(RED)
    expect(embed?.url).toBe('https://vercel.com/braltons-projects/complete_catering_service/dpl_1')
    const fields = Object.fromEntries((embed?.fields ?? []).map((f) => [f.name, f.value]))
    expect(fields).toMatchObject({
      Project: 'complete_catering_service',
      Environment: 'production',
      Branch: 'main',
      Author: 'bralton',
      URL: 'https://completecateringservice-abc123-braltons-projects.vercel.app',
    })
    expect(fields.Commit).toBe('e925f2d feat(deploy): SEED_FORCE, a one-shot re-seed bound to one commit SHA')
    expect(embed?.footer?.text).toBe('deployment.error · evt_123')
    expect(embed?.timestamp).toBe('2026-10-23T15:14:59.788Z')
  })

  it('colours cancellations amber and promotions green, and defaults the environment to preview', () => {
    const cancelled = formatEvent({ ...deploymentError, type: 'deployment.canceled', payload: { name: 'x' } })
    expect(cancelled.embeds[0]?.color).toBe(AMBER)
    expect(cancelled.embeds[0]?.fields?.find((f) => f.name === 'Environment')?.value).toBe('preview')
    const promoted = formatEvent({ ...deploymentError, type: 'deployment.promoted' })
    expect(promoted.embeds[0]?.color).toBe(GREEN)
  })

  it('recognises a Spend Management payload by its shape and goes red at 100%', () => {
    const spend = formatEvent({ budgetAmount: 1, currentSpend: 1, teamId: 'team_1', thresholdPercent: 100 })
    expect(spend.embeds[0]?.title).toBe('Spend alert: 100% of the on-demand budget')
    expect(spend.embeds[0]?.color).toBe(RED)
    expect(
      formatEvent({ budgetAmount: 10, currentSpend: 5, thresholdPercent: 50 }).embeds[0]?.color
    ).not.toBe(RED)
  })

  it('still reports an unknown event type, with a JSON snippet, rather than dropping it', () => {
    const msg = formatEvent({
      id: 'evt_9',
      type: 'project.domain.unverified',
      payload: { name: 'ralton-dev', domain: 'x' },
    })
    expect(msg.embeds[0]?.title).toBe('project.domain.unverified · ralton-dev')
    expect(msg.embeds[0]?.description).toContain('"domain": "x"')
    expect(msg.embeds[0]?.color).toBe(GREY)
  })

  it('reports an alert with its name', () => {
    const msg = formatEvent({
      type: 'alerts.triggered',
      payload: { name: 'Error rate spike', projectId: 'prj' },
    })
    expect(msg.embeds[0]?.title).toBe('Alert: Error rate spike')
    expect(msg.embeds[0]?.color).toBe(RED)
  })

  it('never throws on bodies that are not objects', () => {
    expect(formatEvent(null).embeds[0]?.title).toBe('Unrecognised webhook')
    expect(formatEvent('text').embeds[0]?.title).toBe('Unrecognised webhook')
    expect(formatEvent([1, 2]).embeds[0]?.title).toBe('Unrecognised webhook')
  })

  it('keeps long commit messages and snippets inside Discord limits', () => {
    const long = formatEvent({
      ...deploymentError,
      payload: {
        ...deploymentError.payload,
        deployment: { meta: { githubCommitMessage: 'x'.repeat(5000) } },
      },
    })
    const commit = long.embeds[0]?.fields?.find((f) => f.name === 'Commit')?.value ?? ''
    expect(commit.length).toBeLessThanOrEqual(1000)
    const big = formatEvent({ type: 'something.new', payload: { blob: 'y'.repeat(10000) } })
    expect((big.embeds[0]?.description ?? '').length).toBeLessThanOrEqual(1900)
  })
})
