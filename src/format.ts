/**
 * Turns a Vercel webhook body into one Discord message. Two body shapes arrive:
 *
 *  - team webhooks: `{ id, type: 'deployment.error' | …, createdAt, payload: {…} }`
 *  - Spend Management: `{ budgetAmount, currentSpend, teamId, thresholdPercent }`
 *
 * Anything unrecognised still produces a message, with a trimmed JSON snippet,
 * so that a new event type never disappears silently.
 */

export type DiscordField = { name: string; value: string; inline?: boolean }
export type DiscordEmbed = {
  title: string
  url?: string
  description?: string
  color: number
  fields?: DiscordField[]
  footer?: { text: string }
  timestamp?: string
}
export type DiscordMessage = { username: string; embeds: DiscordEmbed[] }

export const RED = 0xe5484d
export const AMBER = 0xf5a524
export const GREEN = 0x30a46c
export const BLUE = 0x3e63dd
export const GREY = 0x8b8d98

const USERNAME = 'Vercel'

const DEPLOYMENT_TITLES: Record<string, [title: string, color: number]> = {
  'deployment.error': ['Deployment failed', RED],
  'deployment.canceled': ['Deployment cancelled', AMBER],
  'deployment.created': ['Deployment started', BLUE],
  'deployment.ready': ['Deployment ready', GREEN],
  'deployment.succeeded': ['Deployment succeeded', GREEN],
  'deployment.promoted': ['Deployment promoted to production', GREEN],
  'deployment.rollback': ['Instant rollback requested', AMBER],
  'deployment.check-rerequested': ['Deployment check re-requested', BLUE],
}

type Dict = Record<string, unknown>

function dict(value: unknown): Dict {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? (value as Dict) : {}
}

function text(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

function number(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function clip(value: string, max: number): string {
  return value.length <= max ? value : `${value.slice(0, max - 1)}…`
}

/** A JSON snippet that fits in a Discord embed description, for events the relay does not know. */
function snippet(value: unknown): string {
  const json = JSON.stringify(value, null, 2) ?? String(value)
  return `\`\`\`json\n${clip(json, 1800)}\n\`\`\``
}

function timestamp(createdAt: unknown): string | undefined {
  const ms = number(createdAt)
  return ms ? new Date(ms).toISOString() : undefined
}

export function formatEvent(body: unknown): DiscordMessage {
  const b = dict(body)
  if (number(b.thresholdPercent) !== undefined && number(b.budgetAmount) !== undefined) {
    return { username: USERNAME, embeds: [spendEmbed(b)] }
  }
  const type = text(b.type)
  if (!type) {
    return {
      username: USERNAME,
      embeds: [{ title: 'Unrecognised webhook', description: snippet(body), color: GREY }],
    }
  }
  const payload = dict(b.payload)
  const embed = type.startsWith('deployment.')
    ? deploymentEmbed(type, payload)
    : type === 'alerts.triggered'
      ? alertEmbed(payload)
      : type.startsWith('firewall.')
        ? firewallEmbed(type, payload)
        : type.startsWith('budget.')
          ? budgetEmbed(type, payload)
          : genericEmbed(type, payload)
  embed.footer = { text: [type, text(b.id)].filter(Boolean).join(' · ') }
  embed.timestamp = timestamp(b.createdAt)
  return { username: USERNAME, embeds: [embed] }
}

function spendEmbed(b: Dict): DiscordEmbed {
  const percent = number(b.thresholdPercent) ?? 0
  const budget = number(b.budgetAmount) ?? 0
  const spend = number(b.currentSpend) ?? 0
  return {
    title: `Spend alert: ${percent}% of the on-demand budget`,
    description: `Budget ${budget}, spend so far this cycle ${spend}, in the units Vercel reports. At 100% Vercel applies whatever the budget is set to do, which may be pausing every project on the team.`,
    color: percent >= 100 ? RED : percent >= 75 ? AMBER : BLUE,
    fields: [{ name: 'Team', value: text(b.teamId) ?? 'unknown', inline: true }],
    footer: { text: 'spend-management' },
  }
}

function deploymentEmbed(type: string, p: Dict): DiscordEmbed {
  const [title, color] = DEPLOYMENT_TITLES[type] ?? [`Deployment event: ${type}`, BLUE]
  const project = text(p.name) ?? text(dict(p.project).name) ?? 'unknown project'
  const meta = dict(dict(p.deployment).meta)
  const branch = text(meta.githubCommitRef) ?? text(meta.gitlabCommitRef) ?? text(meta.bitbucketCommitRef)
  const message =
    text(meta.githubCommitMessage) ?? text(meta.gitlabCommitMessage) ?? text(meta.bitbucketCommitMessage)
  const sha = text(meta.githubCommitSha) ?? text(meta.gitlabCommitSha) ?? text(meta.bitbucketCommitSha)
  const author =
    text(meta.githubCommitAuthorLogin) ??
    text(meta.gitlabCommitAuthorLogin) ??
    text(meta.bitbucketCommitAuthorName)
  const target = text(p.target) ?? 'preview'
  const siteUrl = text(p.url) ?? text(dict(p.deployment).url)
  const links = dict(p.links)
  const fields: DiscordField[] = [
    { name: 'Project', value: project, inline: true },
    { name: 'Environment', value: target, inline: true },
  ]
  if (branch) fields.push({ name: 'Branch', value: clip(branch, 100), inline: true })
  if (sha || message) {
    fields.push({ name: 'Commit', value: clip([sha?.slice(0, 7), message].filter(Boolean).join(' '), 1000) })
  }
  if (author) fields.push({ name: 'Author', value: author, inline: true })
  if (siteUrl)
    fields.push({ name: 'URL', value: `https://${siteUrl.replace(/^https?:\/\//, '')}`, inline: true })
  if (text(links.project)) fields.push({ name: 'Project dashboard', value: text(links.project) as string })
  return { title: `${title} · ${project}`, url: text(links.deployment), color, fields }
}

function alertEmbed(p: Dict): DiscordEmbed {
  const name = text(p.name) ?? text(dict(p.alert).name) ?? 'Alert triggered'
  return { title: `Alert: ${clip(name, 200)}`, description: snippet(p), color: RED }
}

const FIREWALL_TITLES: Record<string, string> = {
  'firewall.attack': 'Firewall: attack detected and mitigated',
  'firewall.system-rule-anomaly': 'Firewall: system rule anomaly',
  'firewall.custom-rule-anomaly': 'Firewall: custom rule anomaly',
}

function firewallEmbed(type: string, p: Dict): DiscordEmbed {
  const project = text(p.name) ?? text(dict(p.project).name)
  const title = FIREWALL_TITLES[type] ?? `Firewall: ${type.slice('firewall.'.length)}`
  return { title: project ? `${title} · ${project}` : title, description: snippet(p), color: RED }
}

function budgetEmbed(type: string, p: Dict): DiscordEmbed {
  return { title: `Budget: ${type.slice('budget.'.length)}`, description: snippet(p), color: AMBER }
}

function genericEmbed(type: string, p: Dict): DiscordEmbed {
  const project = text(p.name) ?? text(dict(p.project).name)
  return {
    title: project ? `${type} · ${project}` : type,
    description: snippet(p),
    color: type.includes('fail') || type.includes('removed') || type.includes('deleted') ? AMBER : GREY,
  }
}
