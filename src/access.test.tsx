import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { accessRequest, codeFileText, generateCode } from './access.ts'
import { LockScreen } from './LockScreen.tsx'
import { Settings } from './pages/Settings.tsx'

const status = { enabled: true, unlocked: false, minLength: 12, rememberDays: 7 }

describe('access code (client)', () => {
  it('generates readable codes from the random source', () => {
    expect(generateCode()).toMatch(/^ruang-([2-9A-HJ-NP-Z]{4}-){3}[2-9A-HJ-NP-Z]{4}$/)
    expect(generateCode((values) => values.fill(0))).toBe('ruang-2222-2222-2222-2222')
  })

  it('writes a code file with the code and how to recover', () => {
    const text = codeFileText('ruang-ABCD-EFGH-JKLM-NPQR', 'http://127.0.0.1:3001', new Date('2026-10-01T00:00:00Z'))
    expect(text).toContain('  ruang-ABCD-EFGH-JKLM-NPQR')
    expect(text).toContain('ruang access-code off')
    expect(text).toContain('2026-10-01T00:00:00.000Z')
  })

  it('sends changes with the page header and reports the server error', async () => {
    let seen: RequestInit | undefined
    const result = await accessRequest('unlock', { code: 'x' }, async (_url, init) => { seen = init; return new Response(JSON.stringify({ error: 'Wrong access code.' }), { status: 401 }) })
    expect((seen?.headers as Record<string, string>)['x-ruang-request']).toBe('1')
    expect(result).toEqual({ ok: false, message: 'Wrong access code.' })
  })

  it('renders the unlock screen and the settings states', () => {
    const lock = renderToStaticMarkup(<LockScreen status={status} onUnlocked={() => undefined}/>)
    expect(lock).toContain('Enter access code')
    expect(lock).toContain('Remember this device for 7 days')
    expect(lock).toContain('ruang access-code off')
    expect(renderToStaticMarkup(<Settings access={{ ...status, enabled: false, unlocked: true }} onAccessChange={() => undefined}/>)).toContain('Set up access code')
    const on = renderToStaticMarkup(<Settings access={{ ...status, unlocked: true, since: '2026-10-01T00:00:00Z' }} onAccessChange={() => undefined}/>)
    expect(on).toContain('Change code')
    expect(on).toContain('LOCK THIS BROWSER')
  })
})
