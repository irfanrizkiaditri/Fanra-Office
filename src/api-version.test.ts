import { describe, expect, it } from 'vitest'
import { API_VERSION as serverVersion } from '../server/api-version.ts'
import { API_VERSION as uiVersion } from './api-version.ts'

describe('API version', () => {
  it('is the same for the UI and the server so a stale server can be detected', () => {
    expect(uiVersion).toBe(serverVersion)
  })
})
