import { describe, expect, it } from 'vitest'
import { officeBadge, officeStateBadge } from './office-state.ts'

describe('officeBadge', () => {
  it('maps only declared runtime availability without inferring activity', () => {
    expect(officeBadge({ availability: 'available', data: 'Running' })).toEqual({ label: 'Running', tone: 'good' })
    expect(officeBadge({ availability: 'available', data: 'Unknown' })).toEqual({ label: 'Unknown', tone: 'unknown' })
    expect(officeBadge({ availability: 'unavailable', data: 'Unknown' })).toEqual({ label: 'Not Available', tone: 'muted' })
    expect(officeBadge({ availability: 'available', data: '1.2.3' }, 'version')).toEqual({ label: 'Version Available', tone: 'good' })
    expect(officeBadge({ availability: 'available', data: 'Unknown' }, 'version')).toEqual({ label: 'Unknown', tone: 'unknown' })
  })
})

describe('officeStateBadge', () => {
  it('renders only approved Office work states', () => {
    expect(officeStateBadge('Working')).toEqual({ label: 'Working', tone: 'good' })
    expect(officeStateBadge('Reviewing')).toEqual({ label: 'Reviewing', tone: 'good' })
    expect(officeStateBadge('Offline')).toEqual({ label: 'Offline', tone: 'muted' })
    expect(officeStateBadge('Unknown')).toEqual({ label: 'Unknown', tone: 'unknown' })
  })
})
