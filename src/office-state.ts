import type { Source } from './types.ts'

export type OfficeBadgeTone = 'good' | 'muted' | 'unknown'
export type OfficeState = 'Idle' | 'Working' | 'Reviewing' | 'Collaborating' | 'Offline' | 'Unknown'

export function officeBadge(source: Source<string> | undefined, kind: 'gateway' | 'version' = 'gateway'): { label: string; tone: OfficeBadgeTone } {
  if (!source || source.availability === 'unavailable') return { label: 'Not Available', tone: 'muted' }
  if (source.data === 'Unknown' || !source.data) return { label: 'Unknown', tone: 'unknown' }
  if (kind === 'version') return { label: 'Version Available', tone: 'good' }
  return { label: source.data, tone: source.data === 'Running' ? 'good' : 'unknown' }
}

export function officeStateBadge(state: OfficeState): { label: OfficeState; tone: OfficeBadgeTone } {
  return { label: state, tone: state === 'Offline' ? 'muted' : state === 'Unknown' || state === 'Idle' ? 'unknown' : 'good' }
}
