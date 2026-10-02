// Shared helpers of the token usage views.

export const USAGE_PERIODS = [1, 7, 30] as const
export type Period = typeof USAGE_PERIODS[number]

const SOURCE_LABELS: Record<string, string> = {
  cli: 'Terminal (CLI)', kanban: 'Kanban tasks', cron: 'Cron jobs', telegram: 'Telegram', discord: 'Discord', whatsapp: 'WhatsApp',
  slack: 'Slack', signal: 'Signal', email: 'Email', api: 'API', acp: 'Editor (ACP)', webhook: 'Webhooks', subagent: 'Sub-agents',
}

export function sourceLabel(source: string): string {
  return SOURCE_LABELS[source] ?? source.charAt(0).toUpperCase() + source.slice(1)
}

export function formatCost(usd: number | undefined): string {
  if (usd === undefined) return '—'
  return usd > 0 && usd < 1 ? `$${usd.toFixed(4)}` : `$${usd.toFixed(2)}`
}
