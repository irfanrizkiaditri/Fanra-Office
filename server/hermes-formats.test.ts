import { beforeEach, describe, expect, it } from 'vitest'
import {
  CommandError,
  buildDashboard,
  buildOfficeSnapshot,
  clearCommandLog,
  collectCalendar,
  collectInsights,
  collectUsage,
  collectLogs,
  collectSnapshot,
  collectTaskBoard,
  getCommandLog,
  parseChannelStatus,
  parseCronJobs,
  parseGatewayStatus,
  parseInsights,
  parseLogLines,
  parseProfiles,
  parseSessions,
  parseSkills,
  parseTasks,
  redactLogLine,
} from './mission-control.js'

// Fixtures mirror the exact print() formats in hermes_cli (piped, so no ANSI colour).
const profileList = [
  '',
  ` ${'Profile'.padEnd(16)} ${'Model'.padEnd(28)} ${'Gateway'.padEnd(12)} ${'Alias'.padEnd(12)} Distribution`,
  ` ${'─'.repeat(15)}    ${'─'.repeat(27)}    ${'─'.repeat(11)}    ${'─'.repeat(11)}    ${'─'.repeat(20)}`,
  ` ◆${'default'.padEnd(15)} ${'anthropic/claude-sonnet-4'.padEnd(28)} ${'running'.padEnd(12)} ${'—'.padEnd(12)} —`,
  `  ${'Code Helper (coder)'.padEnd(15)} ${'openai/gpt-5.5'.padEnd(28)} ${'stopped'.padEnd(12)} ${'ch'.padEnd(12)} —`,
  `  ${'scratch'.padEnd(15)} ${'—'.padEnd(28)} ${'stopped'.padEnd(12)} ${'—'.padEnd(12)} —`,
  '',
].join('\n')

const cronList = `
┌${'─'.repeat(73)}┐
│${' '.repeat(25)}${'Scheduled Jobs'.padEnd(48)}│
└${'─'.repeat(73)}┘

  a1b2c3d4 [active]
    Name:      Morning brief
    Schedule:  0 8 * * *
    Repeat:    ∞
    Next run:  2026-09-28T08:00:00+07:00
    Deliver:   telegram
    Last run:  2026-09-27T08:00:03+07:00  ok

  e5f6a7b8 [paused]
    Name:      (unnamed)
    Schedule:  every 30m
    Repeat:    2/10
    Overdue:   2026-09-27T09:00:00+07:00  (45m ago — the job has not fired; is the scheduler running?)
    Deliver:   local
    Last run:  2026-09-27T08:30:00+07:00  error: API_KEY=sk-live-should-not-leak

  ⚠  Scheduler is not ready: gateway is not running
`

describe('Hermes profile list', () => {
  it('reads display-name ids, long names and unset models by column', () => {
    expect(parseProfiles(profileList)).toEqual([
      { name: 'default', model: 'anthropic/claude-sonnet-4', gateway: 'Running' },
      { name: 'coder', model: 'openai/gpt-5.5', gateway: 'Stopped' },
      { name: 'scratch', model: 'Not configured', gateway: 'Stopped' },
    ])
  })

  it('derives the default gateway from the profile table', async () => {
    const snapshot = await collectSnapshot(async (file, args) => {
      if (args.join(' ') === 'profile list') return profileList
      if (file === 'opencode') return 'opencode 0.14.2\n'
      return '✗ Gateway is not running\n\nTo start:\n  hermes gateway run      # Run in foreground\n'
    })
    expect(snapshot.profiles.data.map((profile) => [profile.name, profile.gateway])).toEqual([['default', 'Running'], ['coder', 'Stopped'], ['scratch', 'Stopped']])
    expect(snapshot.openCode.data).toBe('opencode 0.14.2')
  })
})

describe('Hermes gateway status', () => {
  it('trusts the ✓/✗ summary line over systemd journal text', () => {
    const systemd = '● hermes-gateway.service\n   Active: active (running)\nSep 26 hermes[1]: Stopped old worker\n✓ user gateway service is running\n'
    expect(parseGatewayStatus(systemd)).toBe('Running')
    expect(parseGatewayStatus('✓ Gateway is running (PID: 1234, 5678)\n  (Running manually, not as a system service)\n')).toBe('Running')
    expect(parseGatewayStatus('✓ Gateway is running via the default-profile multiplexer\n')).toBe('Running')
    expect(parseGatewayStatus('✗ user gateway service is stopped\n')).toBe('Stopped')
    expect(parseGatewayStatus("Profile 'coder': parked (hermes -p coder gateway start)\n")).toBe('Stopped')
  })
})

describe('Hermes kanban list --json', () => {
  it('keeps only safe task fields and normalizes status', () => {
    const output = JSON.stringify([
      { id: 't_1a2b3c4d', title: 'Draft Q3 report', body: 'secret body', assignee: 'coder', status: 'running', priority: 2, workspace_path: '/home/me/x' },
      { id: 't_9f8e7d6c', title: 'Triage inbox', body: null, assignee: null, status: 'Triage', priority: 0 },
    ], null, 2)
    expect(parseTasks(output)).toEqual([
      { id: 't_1a2b3c4d', title: 'Draft Q3 report', assignee: 'coder', status: 'running', priority: 2 },
      { id: 't_9f8e7d6c', title: 'Triage inbox', status: 'triage', priority: 0 },
    ])
  })
})

describe('Kanban boards', () => {
  const boards = JSON.stringify([
    { slug: 'default', name: 'Default', db_path: '/home/me/.hermes/kanban.db', archived: false, is_current: false, counts: { todo: 1 }, total: 1 },
    { slug: 'launch', name: 'Launch', db_path: '/home/me/.hermes/kanban/boards/launch/kanban.db', archived: false, is_current: true, counts: { running: 1 }, total: 1 },
    { slug: 'empty', name: 'Empty', archived: false, is_current: false, counts: {}, total: 0 },
    { slug: '--evil', name: 'Evil', archived: false, is_current: false, counts: { todo: 1 }, total: 1 },
  ])
  const tasksOf: Record<string, unknown[]> = {
    default: [{ id: 't_1', title: 'On default', status: 'todo' }],
    launch: [{ id: 't_2', title: 'On launch', status: 'running', assignee: 'coder' }],
  }

  it('reads the tasks of every board with tasks, tagged with their board', async () => {
    const calls: string[][] = []
    const snapshot = await collectTaskBoard(async (_file, args) => {
      calls.push(args)
      if (args[1] === 'boards') return `A new Hermes version is available.\n${boards}`
      return JSON.stringify(tasksOf[args[2]] ?? [])
    })
    expect(snapshot.tasks.data).toEqual([
      { id: 't_1', title: 'On default', status: 'todo', board: 'default' },
      { id: 't_2', title: 'On launch', status: 'running', assignee: 'coder', board: 'launch' },
    ])
    expect(snapshot.boards).toEqual([
      { slug: 'default', name: 'Default', current: false, total: 1 },
      { slug: 'launch', name: 'Launch', current: true, total: 1 },
      { slug: 'empty', name: 'Empty', current: false, total: 0 },
    ])
    expect(JSON.stringify(snapshot)).not.toContain('/home/me')
    expect(calls.flat()).not.toContain('--evil')
    expect(calls).not.toContainEqual(['kanban', '--board', 'empty', 'list', '--json'])
  })

  it('keeps the other boards when one cannot be read, and falls back without boards', async () => {
    const partial = await collectTaskBoard(async (_file, args) => {
      if (args[1] === 'boards') return boards
      if (args[2] === 'launch') throw new Error('boom')
      return JSON.stringify(tasksOf[args[2]])
    })
    expect(partial.tasks.availability).toBe('available')
    expect(partial.tasks.data.map((task) => task.id)).toEqual(['t_1'])
    expect(partial.failedBoards).toEqual(['launch'])

    const calls: string[][] = []
    const legacy = await collectTaskBoard(async (_file, args) => {
      calls.push(args)
      if (args[1] === 'boards') throw new Error('invalid choice')
      return JSON.stringify(tasksOf.default)
    })
    expect(legacy.tasks.data).toEqual([{ id: 't_1', title: 'On default', status: 'todo' }])
    expect(calls[1]).toEqual(['kanban', 'list', '--json'])
  })
})

describe('Hermes cron list', () => {
  it('parses the per-job block format without exposing error text', () => {
    expect(parseCronJobs(cronList)).toEqual([
      { id: 'a1b2c3d4', name: 'Morning brief', schedule: '0 8 * * *', status: 'active', repeat: '∞', nextRun: '2026-09-28T08:00:00+07:00', lastRun: '2026-09-27T08:00:03+07:00', lastRunOk: true },
      { id: 'e5f6a7b8', name: 'e5f6a7b8', schedule: 'every 30m', status: 'paused', repeat: '2/10', nextRun: '2026-09-27T09:00:00+07:00', overdue: true, lastRun: '2026-09-27T08:30:00+07:00', lastRunOk: false },
    ])
    expect(JSON.stringify(parseCronJobs(cronList))).not.toContain('sk-live')
  })

  it('keeps the calendar available for real job output', async () => {
    const calendar = await collectCalendar(async () => cronList)
    expect(calendar.jobs.availability).toBe('available')
    expect(calendar.jobs.data).toHaveLength(2)
  })
})

describe('Hermes sessions list', () => {
  const rule = '─'.repeat(110)
  it('reads the workspace + title layout', () => {
    const output = `${'Title'.padEnd(28)} ${'Workspace'.padEnd(18)} ${'Last Active'.padEnd(13)} ID\n${rule}\n${'Fix login bug'.padEnd(28)} ${'mission-control'.padEnd(18)} ${'5m ago'.padEnd(13)} 20260927_110000_abc123\n${'—'.padEnd(28)} ${'—'.padEnd(18)} ${'yesterday'.padEnd(13)} 20260926_090000_def456\n`
    expect(parseSessions(output)).toEqual([
      { title: 'Fix login bug', preview: '', lastActive: '5m ago', id: '20260927_110000_abc123', workspace: 'mission-control' },
      { title: 'Untitled session', preview: '', lastActive: 'yesterday', id: '20260926_090000_def456' },
    ])
  })

  it('reads the preview + source layout', () => {
    const output = `${'Preview'.padEnd(50)} ${'Last Active'.padEnd(13)} ${'Src'.padEnd(16)} ID\n${'─'.repeat(105)}\n${'halo, tolong cek server'.padEnd(50)} ${'just now'.padEnd(13)} ${'telegram→cli'.padEnd(16)} 20260101_000000_example02\n`
    expect(parseSessions(output)).toEqual([
      { title: 'halo, tolong cek server', preview: 'halo, tolong cek server', lastActive: 'just now', id: '20260101_000000_example02', source: 'telegram→cli' },
    ])
  })

  it('treats "No sessions found." as an empty, available list', () => {
    expect(parseSessions('No sessions found.\n')).toEqual([])
  })
})

describe('Hermes skills list', () => {
  it('merges Rich continuation rows into the wrapped skill', () => {
    const output = '┏━━━━━━━━━━━━━━┳━━━━━━━━━━━━┳━━━━━━━━━┳━━━━━━━━━┳━━━━━━━━━┓\n┃ Name         ┃ Category   ┃ Source  ┃ Trust   ┃ Status  ┃\n┡━━━━━━━━━━━━━━╇━━━━━━━━━━━━╇━━━━━━━━━╇━━━━━━━━━╇━━━━━━━━━┩\n│ google-      │ office     │ builtin │ builtin │ enabled │\n│ workspace    │ suite      │         │         │         │\n│ maps         │ travel     │ local   │ local   │ enabled │\n└──────────────┴────────────┴─────────┴─────────┴─────────┘\n'
    expect(parseSkills(output).map((skill) => skill.name)).toEqual(['google-workspace', 'maps'])
    expect(parseSkills(output)[0].category).toBe('office suite')
  })
})

describe('Hermes status channels', () => {
  it('reads the current Messaging Platforms and Sessions sections', () => {
    const output = '\n◆ Messaging Platforms\n  Telegram      ✓ configured (home: 12345)\n  Discord       ✗ not configured\n  WeCom Callback  ✓ configured\n  Email         ✓ configured\n\n◆ Sessions\n  Active:       3 session(s)\n  Last activity:       5m ago\n'
    expect(parseChannelStatus(output)).toEqual({
      channels: [{ name: 'Telegram', status: 'Configured' }, { name: 'WeCom Callback', status: 'Configured' }, { name: 'Email', status: 'Configured' }],
      activeSessions: 3,
    })
  })
})

describe('Hermes insights', () => {
  const insights = [
    '',
    '  ╔══════════════════════════════════════════════════════════╗',
    '  ║                    📊 Hermes Insights                    ║',
    '  ║                       Last 7 days                        ║',
    '  ╚══════════════════════════════════════════════════════════╝',
    '',
    '  📋 Overview',
    `  ${'─'.repeat(56)}`,
    '  Sessions:          42            Messages:        1,234',
    '  Tool calls:        567           User messages:   300',
    '  Input tokens:      1,234,567     Output tokens:   89,012',
    '  Total tokens:      1,323,579',
    '  Avg msgs/session:  29.4',
    '',
    '  💰 Cost',
    `  ${'─'.repeat(56)}`,
    '  Estimated:          ~$12.34',
    '',
    '  🤖 Models Used',
    `  ${'─'.repeat(56)}`,
    `  ${'Model'.padEnd(30)} ${'Sessions'.padStart(8)} ${'Tokens'.padStart(12)}`,
    `  ${'anthropic/claude-sonnet-4'.padEnd(30)} ${'40'.padStart(8)} ${'1,300,000'.padStart(12)}`,
    '',
    '  🔧 Top Tools',
    `  ${'─'.repeat(56)}`,
    `  ${'Tool'.padEnd(28)} ${'Calls'.padStart(8)} ${'%'.padStart(8)}`,
    `  ${'terminal'.padEnd(28)} ${'300'.padStart(8)} ${'52.9'.padStart(7)}%`,
    '',
  ].join('\n')

  it('extracts overview totals, cost, models and tools', () => {
    expect(parseInsights(insights, 7)).toEqual({
      days: 7, sessions: 42, messages: 1234, toolCalls: 567, inputTokens: 1234567, outputTokens: 89012, totalTokens: 1323579, estimatedCost: '~$12.34',
      models: [{ model: 'anthropic/claude-sonnet-4', sessions: 40, tokens: 1300000 }],
      tools: [{ tool: 'terminal', calls: 300 }],
      costUsd: 12.34,
      sources: [{ source: 'cli', sessions: 42, tokens: 1323579 }],
    })
  })

  const withPlatforms = (tokens: number) => [
    insights.replace('1,323,579', tokens.toLocaleString('en-US')),
    '  📱 Platforms',
    `  ${'─'.repeat(56)}`,
    `  ${'Platform'.padEnd(14)} ${'Sessions'.padStart(8)} ${'Messages'.padStart(10)} ${'Tokens'.padStart(14)}`,
    `  ${'telegram'.padEnd(14)} ${'30'.padStart(8)} ${'900'.padStart(10)} ${'1,000,000'.padStart(14)}`,
    `  ${'kanban'.padEnd(14)} ${'12'.padStart(8)} ${'334'.padStart(10)} ${'2,000,000'.padStart(14)}`,
    '',
    '  🏆 Notable Sessions',
    `  ${'─'.repeat(56)}`,
    `  ${'Most tokens'.padEnd(20)} ${'512,000 tokens'.padEnd(18)} (Sep 28, 20260928_090000_ab)`,
    '',
  ].join('\n')

  it('reads tokens per session source and the biggest session', () => {
    const usage = parseInsights(withPlatforms(1323579), 7)
    expect(usage.sources).toEqual([{ source: 'kanban', sessions: 12, tokens: 2000000 }, { source: 'telegram', sessions: 30, tokens: 1000000 }])
    expect(usage.topSession).toEqual({ tokens: 512000, date: 'Sep 28' })
  })

  it('adds up every profile, ranks agents and keeps the rest when one fails', async () => {
    const calls: string[][] = []
    const usage = await collectUsage(30, ['default', 'coder', 'broken', '--evil'], async (_file, args) => {
      calls.push(args)
      if (args[1] === 'broken') throw new Error('boom')
      return args[1] === 'coder' ? withPlatforms(3000000) : insights
    })
    expect(calls.flat()).not.toContain('--evil')
    expect(calls[0]).toEqual(['-p', 'default', 'insights', '--days', '30'])
    expect(usage.agents.map((agent) => [agent.agent, agent.availability])).toEqual([['coder', 'available'], ['default', 'available'], ['broken', 'unavailable']])
    expect(usage.totals.totalTokens).toBe(3000000 + 1323579)
    expect(usage.totals.costUsd).toBeCloseTo(24.68)
    expect(usage.models).toEqual([{ model: 'anthropic/claude-sonnet-4', sessions: 80, tokens: 2600000 }])
    expect(usage.sources.map((source) => source.source)).toEqual(['kanban', 'cli', 'telegram'])
  })

  it('treats an empty period as zero usage and garbage as unavailable', async () => {
    expect(parseInsights('  No sessions found in the last 7 days.', 7)).toMatchObject({ sessions: 0, totalTokens: 0 })
    expect((await collectInsights(async () => 'loading...')).availability).toBe('unavailable')
  })
})

describe('Hermes logs', () => {
  it('drops the path header, tags levels and carries levels onto tracebacks', () => {
    const output = '--- ~/.hermes/logs/agent.log (last 200) ---\n2026-09-27 10:00:00,123 INFO [sess_abc] gateway.run: started\n2026-09-27 10:00:01,000 ERROR agent.loop: boom\nTraceback (most recent call last):\n  File "/home/user/.hermes/x.py", line 1\n'
    expect(parseLogLines(output)).toEqual([
      { text: '2026-09-27 10:00:00,123 INFO [sess_abc] gateway.run: started', level: 'INFO' },
      { text: '2026-09-27 10:00:01,000 ERROR agent.loop: boom', level: 'ERROR' },
      { text: 'Traceback (most recent call last):', level: 'ERROR' },
      { text: '  File "~/.hermes/x.py", line 1', level: 'ERROR' },
    ])
  })

  it('redacts secrets that slipped past Hermes redaction', () => {
    const line = redactLogLine('auth Bearer abcdefghijklmnop api_key=sk-proj-1234567890abcdef token: 000000000:FAKE_BOT_TOKEN_FOR_TESTS_ONLY_000000000')
    expect(line).not.toMatch(/abcdefghijklmnop|sk-proj|FAKE_BOT/)
  })

  it('reports a missing log file as an empty log, and other failures as unavailable', async () => {
    const logs = await collectLogs(async (_file, args) => {
      if (args[1] === 'agent') return '--- ~/.hermes/logs/agent.log (last 200) ---\n2026-09-27 10:00:00,123 WARNING x: y\n'
      if (args[1] === 'gateway') throw new CommandError('Command exited with code 1.', 'COMMAND_FAILED', 'Log file not found: /root/.hermes/logs/gateway.log\n')
      throw new CommandError('Read timed out.', 'TIMEOUT')
    })
    expect(logs.files.map((file) => [file.name, file.source.availability, file.source.data.length])).toEqual([
      ['agent', 'available', 1], ['gateway', 'available', 0], ['errors', 'unavailable', 0],
    ])
    expect(logs.files[2].source.error).toEqual({ code: 'TIMEOUT', message: 'Read timed out.' })
  })
})

describe('Office attribution', () => {
  it('prefers a running task over an earlier finished one for the same agent', () => {
    const at = '2026-09-27T12:00:00.000Z'
    const runtime = { profiles: { availability: 'available' as const, data: [{ name: 'default', model: 'm', gateway: 'Running' as const }, { name: 'coder', model: 'm', gateway: 'Running' as const }] }, openCode: { availability: 'available' as const, data: '1' }, fetchedAt: at }
    const office = buildOfficeSnapshot(runtime, { tasks: { availability: 'available', data: [{ title: 'Old', status: 'done', assignee: 'default' }, { title: 'Now', status: 'running', assignee: 'default' }] }, fetchedAt: at }, { sessions: { availability: 'available', data: [] }, fetchedAt: at }, { now: at })
    expect(office.stations[0]).toMatchObject({ state: 'Working', currentTask: 'Now' })
  })
})

describe('Dashboard aggregation', () => {
  it('counts tasks by status, jobs, skills and channels', () => {
    const at = '2026-09-27T12:00:00.000Z'
    const runtime = { profiles: { availability: 'available' as const, data: [{ name: 'default', model: 'm', gateway: 'Running' as const }, { name: 'coder', model: 'm', gateway: 'Stopped' as const }] }, openCode: { availability: 'available' as const, data: '1' }, fetchedAt: at }
    const board = { tasks: { availability: 'available' as const, data: [{ title: 'a', status: 'todo' }, { title: 'b', status: 'todo', assignee: 'default' }, { title: 'c', status: 'done' }] }, fetchedAt: at }
    const activity = { sessions: { availability: 'available' as const, data: [{ title: 's', preview: '', lastActive: 'now', id: 'abcdef1' }] }, fetchedAt: at }
    const dashboard = buildDashboard({
      runtime, board, activity,
      calendar: { jobs: { availability: 'available', data: [{ name: 'x', schedule: '* * * * *', status: 'active', nextRun: '2026-09-28' }, { name: 'y', schedule: 'daily', status: 'paused' }] }, fetchedAt: at },
      knowledge: { skills: { availability: 'available', data: [{ name: 'maps', category: 'travel', source: 'builtin', trust: 'builtin', status: 'enabled' }] }, fetchedAt: at },
      channels: { channels: { availability: 'available', data: [{ name: 'Telegram', status: 'Configured' }] }, activeSessions: 2, fetchedAt: at },
      office: buildOfficeSnapshot(runtime, board, activity, { now: at }),
      commands: { total: 0, failed: 0, averageMs: 0 },
    })
    expect(dashboard.tasks).toEqual({ availability: 'available', total: 3, byStatus: { todo: 2, done: 1 }, assigned: 1 })
    expect(dashboard.calendar).toEqual({ availability: 'available', total: 2, active: 1, paused: 1, nextRun: '2026-09-28' })
    expect(dashboard.knowledge.byCategory).toEqual({ travel: 1 })
    expect(dashboard.channels).toEqual({ availability: 'available', total: 1, connected: 0, activeSessions: 2 })
    expect(dashboard.office.gatewaysReachable).toBe(1)
  })
})

describe('Command log', () => {
  beforeEach(() => clearCommandLog())
  it('starts empty and reports health', () => {
    expect(getCommandLog()).toMatchObject({ entries: [], health: { total: 0, failed: 0, averageMs: 0 } })
  })
})
