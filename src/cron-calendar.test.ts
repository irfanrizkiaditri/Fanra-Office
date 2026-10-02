import { describe, expect, it } from 'vitest'
import { cronField, monthEntries, parseCron } from './cron-calendar.ts'
import type { ScheduledJob } from './types.ts'

const job = (overrides: Partial<ScheduledJob>): ScheduledJob => ({ name: 'Job', schedule: '0 8 * * *', status: 'active', ...overrides })
// October 2026 starts on a Thursday.
const october = (jobs: ScheduledJob[], today = '2026-10-01') => monthEntries(jobs, 2026, 9, today)

describe('cron fields', () => {
  it('reads stars, lists, ranges and steps', () => {
    expect(cronField('*/15', 0, 59)).toEqual([0, 15, 30, 45])
    expect(cronField('1-5', 0, 6)).toEqual([1, 2, 3, 4, 5])
    expect(cronField('8,17', 0, 23)).toEqual([8, 17])
    expect(cronField('10-20/5', 0, 59)).toEqual([10, 15, 20])
    expect(cronField('abc', 0, 59)).toBeUndefined()
    expect(cronField('70', 0, 59)).toBeUndefined()
    expect(parseCron('every 30m')).toBeUndefined()
  })
})

describe('month entries', () => {
  it('places a daily cron job on every day from today, with its time', () => {
    const entries = october([job({ name: 'Morning brief' })], '2026-10-10')
    expect(entries.get('2026-10-09')).toBeUndefined()
    expect(entries.get('2026-10-10')).toEqual([{ job: 'Morning brief', kind: 'run', label: '08:00' }])
    expect(entries.get('2026-10-31')).toHaveLength(1)
  })

  it('honours the weekday field and the cron day-of-month/day-of-week OR rule', () => {
    const fridays = october([job({ schedule: '0 17 * * 5' })])
    expect([...fridays.keys()]).toEqual(['2026-10-02', '2026-10-09', '2026-10-16', '2026-10-23', '2026-10-30'])
    const either = october([job({ schedule: '0 9 1 * 1' })])
    expect(either.has('2026-10-01')).toBe(true) // the 1st (a Thursday)
    expect(either.has('2026-10-05')).toBe(true) // a Monday
    expect(either.has('2026-10-06')).toBe(false)
  })

  it('summarises frequent cron jobs and intervals instead of listing every run', () => {
    expect(october([job({ schedule: '*/15 * * * *' })]).get('2026-10-01')).toEqual([{ job: 'Job', kind: 'interval', label: '96× a day' }])
    expect(october([job({ schedule: 'every 30m' })]).get('2026-10-02')).toEqual([{ job: 'Job', kind: 'interval', label: 'every 30m' }])
    const everyTwoDays = october([job({ schedule: 'every 2d', nextRun: '2026-10-03T06:00:00+07:00' })])
    expect([...everyTwoDays.keys()].slice(0, 3)).toEqual(['2026-10-03', '2026-10-05', '2026-10-07'])
  })

  it('does not schedule paused jobs, but shows last runs and overdue runs', () => {
    const entries = october([
      job({ name: 'Paused', status: 'paused', lastRun: '2026-10-04T17:00:00+07:00', lastRunOk: false }),
      job({ name: 'Late', schedule: 'once', nextRun: '2026-10-06T09:00:00+07:00', overdue: true }),
      job({ name: 'One-shot', schedule: 'once', nextRun: '2026-10-20T13:30:00+07:00' }),
    ])
    expect(entries.get('2026-10-04')).toEqual([{ job: 'Paused', kind: 'last-failed', label: '17:00' }])
    expect(entries.get('2026-10-06')).toEqual([{ job: 'Late', kind: 'overdue', label: '09:00' }])
    expect(entries.get('2026-10-20')).toEqual([{ job: 'One-shot', kind: 'run', label: '13:30' }])
    expect([...entries.values()].flat().filter((entry) => entry.job === 'Paused')).toHaveLength(1)
  })

  it('keeps the owning agent on every entry', () => {
    const entries = october([job({ name: 'Nightly review', schedule: '30 22 * * *', agent: 'coder' })])
    expect(entries.get('2026-10-01')).toEqual([{ agent: 'coder', job: 'Nightly review', kind: 'run', label: '22:30' }])
  })
})
