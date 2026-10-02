import type { ScheduledJob } from './types.ts'

// Places Hermes cron jobs on a month calendar. Times stay in the Hermes host's wall-clock time:
// cron fields are read as written, and next/last-run timestamps by their own date and time
// (ignoring the offset), so nothing shifts when the browser is in another time zone.

export type EntryKind = 'run' | 'interval' | 'overdue' | 'last-ok' | 'last-failed'
export interface CalendarEntry { job: string; kind: EntryKind; label: string; agent?: string }

/** yyyy-mm-dd for a calendar day. */
export function dayKey(year: number, month: number, day: number): string {
  return `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}

/** The wall-clock date and time written in an ISO timestamp, e.g. 2026-09-28T08:00:00+07:00. */
function wallClock(stamp: string | undefined): { day: string; time: string } | undefined {
  const match = stamp?.match(/^(\d{4}-\d{2}-\d{2})(?:[T ](\d{2}:\d{2}))?/)
  return match ? { day: match[1], time: match[2] ?? '' } : undefined
}

/** Values allowed by one cron field (`*`, lists, ranges and steps), or undefined if unreadable. */
export function cronField(field: string, min: number, max: number): number[] | undefined {
  const values = new Set<number>()
  for (const part of field.split(',')) {
    const match = part.match(/^(\*|\d+)(?:-(\d+))?(?:\/(\d+))?$/)
    if (!match) return undefined
    const step = match[3] ? Number(match[3]) : 1
    const start = match[1] === '*' ? min : Number(match[1])
    const end = match[1] === '*' ? max : match[2] ? Number(match[2]) : match[3] ? max : start
    if (step < 1 || start < min || end > max || start > end) return undefined
    for (let value = start; value <= end; value += step) values.add(value)
  }
  return [...values].sort((a, b) => a - b)
}

interface Cron { minutes: number[]; hours: number[]; days: number[]; months: number[]; weekdays: number[]; anyDay: boolean; anyWeekday: boolean }

export function parseCron(schedule: string): Cron | undefined {
  const fields = schedule.trim().split(/\s+/)
  if (fields.length !== 5) return undefined
  const [minutes, hours, days, months, weekdays] = [cronField(fields[0], 0, 59), cronField(fields[1], 0, 23), cronField(fields[2], 1, 31), cronField(fields[3], 1, 12), cronField(fields[4].replace(/\b7\b/g, '0'), 0, 6)]
  if (!minutes || !hours || !days || !months || !weekdays) return undefined
  return { minutes, hours, days, months, weekdays, anyDay: fields[2] === '*', anyWeekday: fields[4] === '*' }
}

function cronRunsOn(cron: Cron, year: number, month: number, day: number): boolean {
  if (!cron.months.includes(month + 1)) return false
  const weekday = new Date(year, month, day).getDay()
  const dayMatch = cron.days.includes(day)
  const weekdayMatch = cron.weekdays.includes(weekday)
  // Standard cron: when both day-of-month and day-of-week are restricted, either one matches.
  if (!cron.anyDay && !cron.anyWeekday) return dayMatch || weekdayMatch
  return dayMatch && weekdayMatch
}

const pad = (value: number) => String(value).padStart(2, '0')

/** Every entry of every job in one month, keyed by yyyy-mm-dd. Future runs start at `today`. */
export function monthEntries(jobs: ScheduledJob[], year: number, month: number, today: string): Map<string, CalendarEntry[]> {
  const entries = new Map<string, CalendarEntry[]>()
  const add = (key: string, entry: CalendarEntry) => entries.set(key, [...(entries.get(key) ?? []), entry])
  const daysInMonth = new Date(year, month + 1, 0).getDate()
  for (const job of jobs) {
    const tag = job.agent ? { agent: job.agent } : {}
    const status = (job.status ?? '').toLowerCase()
    const schedules = !['paused', 'completed', 'done', 'disabled'].includes(status)
    const next = wallClock(job.nextRun)
    const last = wallClock(job.lastRun)
    if (last && last.day.startsWith(dayKey(year, month, 1).slice(0, 7))) add(last.day, { ...tag, job: job.name, kind: job.lastRunOk === false ? 'last-failed' : 'last-ok', label: last.time })
    if (job.overdue && next) { add(next.day, { ...tag, job: job.name, kind: 'overdue', label: next.time }) }
    if (!schedules) continue
    const cron = parseCron(job.schedule)
    const interval = job.schedule.match(/^every\s+(\d+)\s*([mhd])/i)
    for (let day = 1; day <= daysInMonth; day += 1) {
      const key = dayKey(year, month, day)
      if (key < today || (job.overdue && key === next?.day)) continue
      if (cron) {
        if (!cronRunsOn(cron, year, month, day)) continue
        const count = cron.hours.length * cron.minutes.length
        add(key, count > 3 ? { ...tag, job: job.name, kind: 'interval', label: `${count}× a day` } : { ...tag, job: job.name, kind: 'run', label: cron.hours.flatMap((hour) => cron.minutes.map((minute) => `${pad(hour)}:${pad(minute)}`)).join(', ') })
      } else if (interval) {
        const amount = Number(interval[1])
        const unit = interval[2].toLowerCase()
        if (unit === 'd' && amount > 1) {
          const start = next?.day ?? today
          const gap = Math.round((Date.parse(key) - Date.parse(start)) / 86_400_000)
          if (gap < 0 || gap % amount !== 0) continue
          add(key, { ...tag, job: job.name, kind: 'run', label: next?.time ?? '' })
        } else add(key, { ...tag, job: job.name, kind: 'interval', label: job.schedule })
      } else if (next && next.day === key) {
        add(key, { ...tag, job: job.name, kind: 'run', label: next.time })
      }
    }
  }
  return entries
}
