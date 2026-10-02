import { describe, expect, it } from 'vitest'
import { collectTaskDetail, parseTaskDetail } from './mission-control.js'

// Shape of `hermes kanban show <id> --json` (hermes_cli/kanban.py _cmd_show).
const show = {
  task: {
    id: 't_1a2b3c4d', title: 'Wire Telegram alerts', body: 'Send alerts to chat.\nUse token=abcdefghijklmnopqrstu', assignee: 'default', status: 'running', priority: 2,
    tenant: null, workspace_kind: 'worktree', workspace_path: '/home/ubuntu/work/alerts', branch_name: 'feat/alerts', project_id: null, created_by: 'coder',
    created_at: 1790500000, started_at: 1790500600, completed_at: null, result: null, skills: ['github-pr'], max_runtime_seconds: null, max_retries: null,
    model_override: 'anthropic/claude-sonnet-4', provider_override: null, session_id: 's1', workflow_template_id: null, current_step_key: null, completion_contract: null, last_failure_error: null,
  },
  latest_summary: 'Half done: webhook wired.',
  parents: ['t_0000aaaa'], children: [],
  comments: [{ author: 'reviewer', body: 'Please add retries', created_at: 1790500700 }],
  events: [{ kind: 'claimed', payload: { profile: 'default' }, created_at: 1790500600, run_id: 7 }],
  runs: [{ id: 7, profile: 'default', step_key: null, status: 'running', outcome: null, summary: null, error: null, metadata: null, worker_pid: 4242, started_at: 1790500600, ended_at: null }],
}

describe('Kanban task detail', () => {
  it('normalizes the show payload, redacts secrets and shortens home paths', () => {
    const detail = parseTaskDetail(JSON.stringify(show))
    expect(detail).toMatchObject({
      id: 't_1a2b3c4d', title: 'Wire Telegram alerts', status: 'running', assignee: 'default', priority: 2,
      workspace: 'worktree @ ~/work/alerts', branch: 'feat/alerts', skills: ['github-pr'], model: 'anthropic/claude-sonnet-4',
      createdBy: 'coder', createdAt: new Date(1790500000 * 1000).toISOString(), result: 'Half done: webhook wired.',
      parents: ['t_0000aaaa'], children: [],
      comments: [{ author: 'reviewer', body: 'Please add retries' }],
      events: [{ kind: 'claimed', detail: '{"profile":"default"}', runId: '7' }],
      runs: [{ id: '7', profile: 'default', status: 'running' }],
    })
    expect(detail.body).toContain('Send alerts to chat.')
    expect(detail.body).not.toContain('abcdefghijklmnopqrstu')
    expect(JSON.stringify(detail)).not.toContain('worker_pid')
    expect(detail.completedAt).toBeUndefined()
  })

  it('reports unknown output as unavailable and rejects option-like ids', async () => {
    expect((await collectTaskDetail('t_1', async () => 'no such task')).task.availability).toBe('unavailable')
    const calls: string[][] = []
    const ok = await collectTaskDetail('t_1a2b3c4d', async (_file, args) => { calls.push(args); return JSON.stringify(show) })
    expect(ok.task.availability).toBe('available')
    expect(calls).toEqual([['kanban', 'show', 't_1a2b3c4d', '--json']])
    await expect(collectTaskDetail('--all')).rejects.toThrow('Invalid task id.')
    await collectTaskDetail('t_1a2b3c4d', async (_file, args) => { calls.push(args); return JSON.stringify(show) }, 'launch')
    expect(calls[1]).toEqual(['kanban', '--board', 'launch', 'show', 't_1a2b3c4d', '--json'])
    await expect(collectTaskDetail('t_1a2b3c4d', async () => '', '--all')).rejects.toThrow('Invalid board.')
  })
})
