import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { resolveAgentFolders } from './folders.js'
import { collectMemory, parseEntries, parseMemorySettings } from './memory.js'

describe('memory settings', () => {
  it('reads the documented memory block and falls back to Hermes defaults', () => {
    expect(parseMemorySettings('model: x\nmemory:\n  memory_enabled: true\n  user_profile_enabled: false\n  memory_char_limit: 3000   # bigger\n  write_approval: true\n  provider: "honcho"\nskills:\n  write_approval: false\n')).toEqual({
      memoryEnabled: true, userProfileEnabled: false, writeApproval: true, provider: 'honcho', memoryLimit: 3000, userLimit: 1375, source: 'config.yaml',
    })
    expect(parseMemorySettings(undefined)).toEqual({ memoryEnabled: true, userProfileEnabled: true, writeApproval: false, memoryLimit: 2200, userLimit: 1375, source: 'defaults' })
  })

  it('splits entries on the section-sign delimiter, keeping multiline entries', () => {
    expect(parseEntries('Runs Ubuntu 22.04\n§\nProject at ~/code/api\nuses Go 1.22\n§\n')).toEqual(['Runs Ubuntu 22.04', 'Project at ~/code/api\nuses Go 1.22'])
  })
})

describe('agent memory', () => {
  let home: string
  const write = (file: string, content: string) => { mkdirSync(path.dirname(file), { recursive: true }); writeFileSync(file, content) }
  beforeAll(() => {
    home = mkdtempSync(path.join(tmpdir(), 'mc-memory-'))
    const lead = path.join(home, '.hermes', 'profiles', 'default')
    write(path.join(lead, 'SOUL.md'), '# Lead\nYou coordinate the crew.\n')
    write(path.join(lead, 'memories', 'MEMORY.md'), 'Server runs Ubuntu 22.04\n§\nDeploy key: api_key=sk-live-abcdefghijklmnop\n')
    write(path.join(lead, 'memories', 'USER.md'), 'Prefers Bahasa Indonesia\n')
    write(path.join(lead, 'config.yaml'), 'memory:\n  memory_char_limit: 100\n')
    write(path.join(lead, 'AGENTS.md'), '# Conventions\n')
    write(path.join(lead, '.env'), 'SECRET=1\n')
    write(path.join(home, '.hermes', 'profiles', 'coder', 'SOUL.md'), 'Engineer\n')
    write(path.join(home, '.opencode', 'AGENTS.md'), '# OpenCode rules\n')
  })
  afterAll(() => rmSync(home, { recursive: true, force: true }))

  it('collects identity, memory stores with usage, context files and settings per agent', async () => {
    const snapshot = await collectMemory(await resolveAgentFolders(['default', 'coder', 'research'], {}, home))
    const [lead, engineer, research, openCode] = snapshot.agents
    expect(lead).toMatchObject({ profile: 'default', kind: 'hermes', available: true, soul: { exists: true, content: '# Lead\nYou coordinate the crew.\n' } })
    expect(lead.memory).toMatchObject({ exists: true, limit: 100, entries: ['Server runs Ubuntu 22.04', 'Deploy key: api_key=[redacted]'] })
    expect(lead.memory!.used).toBe(lead.memory!.entries.join('\n§\n').length)
    expect(lead.memory!.percent).toBeGreaterThan(50)
    expect(lead.user).toMatchObject({ entries: ['Prefers Bahasa Indonesia'], limit: 1375 })
    expect(lead.contextFiles.map((file) => file.name)).toEqual(['AGENTS.md'])
    expect(lead.settings).toMatchObject({ memoryLimit: 100, source: 'config.yaml' })
    expect(JSON.stringify(snapshot)).not.toContain('sk-live')
    expect(JSON.stringify(snapshot)).not.toContain('SECRET=1')
    expect(engineer).toMatchObject({ available: true, soul: { exists: true }, memory: { exists: false, entries: [], used: 0 }, settings: { source: 'defaults' } })
    expect(research).toMatchObject({ available: false, reason: 'Folder not found on this machine' })
    expect(openCode).toMatchObject({ kind: 'opencode', contextFiles: [{ name: 'AGENTS.md', content: '# OpenCode rules\n' }] })
  })
})
