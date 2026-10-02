import { FolderError, readFolderFile, type AgentFolder } from './folders.js'

// Memory & knowledge view of each agent, following Hermes's documented layout
// (user-guide/features/memory.md, context-files.md, personality.md):
// - SOUL.md in the profile folder is the agent identity (system prompt slot #1);
// - memories/MEMORY.md (agent notes) and memories/USER.md (user profile) hold bounded,
//   curated entries separated by "\n§\n", with character limits from config.yaml `memory.*`;
// - AGENTS.md / AGENTS.override.md / HERMES.md / .hermes.md / CLAUDE.md / .cursorrules are
//   context files when present.
// Every read goes through readFolderFile, so it stays inside the agent's folder, never opens
// credential files and is secret-redacted.

export const ENTRY_DELIMITER = '\n§\n'
export const DEFAULT_MEMORY_LIMIT = 2200
export const DEFAULT_USER_LIMIT = 1375
const CONTEXT_FILES = ['HERMES.md', '.hermes.md', 'AGENTS.override.md', 'AGENTS.md', 'CLAUDE.md', '.cursorrules']
const OPENCODE_CONTEXT_FILES = ['AGENTS.md', 'CLAUDE.md']

export interface MemoryDocument {
  name: string
  path: string
  exists: boolean
  size?: number
  modified?: string
  chars?: number
  content?: string
  truncated?: boolean
  redactions?: number
  error?: string
}
export interface MemoryStore extends MemoryDocument {
  entries: string[]
  limit: number
  used: number
  percent: number
}
export interface MemorySettings {
  memoryEnabled: boolean
  userProfileEnabled: boolean
  writeApproval: boolean
  provider?: string
  memoryLimit: number
  userLimit: number
  source: 'config.yaml' | 'defaults'
}
export interface AgentMemory {
  profile: string
  label: string
  path: string
  kind: 'hermes' | 'opencode'
  available: boolean
  reason?: string
  soul?: MemoryDocument
  memory?: MemoryStore
  user?: MemoryStore
  contextFiles: MemoryDocument[]
  settings?: MemorySettings
}
export interface MemorySnapshot { agents: AgentMemory[]; fetchedAt: string }

async function readDocument(folder: AgentFolder, relative: string): Promise<MemoryDocument> {
  const name = relative.split('/').pop() ?? relative
  try {
    const file = await readFolderFile(folder, relative)
    if (file.kind === 'sensitive') return { name, path: relative, exists: true, size: file.size, modified: file.modified, error: 'Credential-like file; not opened.' }
    if (file.kind === 'binary') return { name, path: relative, exists: true, size: file.size, modified: file.modified, error: 'Binary file; no preview.' }
    return { name, path: relative, exists: true, size: file.size, modified: file.modified, chars: file.content?.length ?? 0, content: file.content ?? '', truncated: file.truncated, redactions: file.redactions }
  } catch (error) {
    if (error instanceof FolderError && error.status === 404) return { name, path: relative, exists: false }
    return { name, path: relative, exists: true, error: error instanceof Error ? error.message : 'Could not read this file.' }
  }
}

export function parseEntries(content: string): string[] {
  return content.replace(/\r\n/g, '\n').split(ENTRY_DELIMITER).map((entry) => entry.trim()).filter(Boolean)
}

function toStore(document: MemoryDocument, limit: number): MemoryStore {
  const entries = document.content ? parseEntries(document.content) : []
  // Hermes measures usage as the length of the entries joined by the delimiter.
  const used = entries.join(ENTRY_DELIMITER).length
  return { ...document, entries, limit, used, percent: limit > 0 ? Math.round((used / limit) * 100) : 0 }
}

/** Reads the `memory:` block of config.yaml (flat keys only; enough for the documented settings). */
export function parseMemorySettings(configYaml: string | undefined): MemorySettings {
  const values = new Map<string, string>()
  if (configYaml) {
    let inside = false
    for (const raw of configYaml.replace(/\r\n/g, '\n').split('\n')) {
      if (/^memory:\s*(#.*)?$/.test(raw)) { inside = true; continue }
      if (!inside) continue
      if (/^\S/.test(raw)) break
      const match = raw.match(/^\s+([A-Za-z_]+):\s*("?)([^"#]*)\2\s*(#.*)?$/)
      if (match) values.set(match[1], match[3].trim())
    }
  }
  const flag = (key: string, fallback: boolean) => {
    const value = values.get(key)?.toLowerCase()
    return value === undefined || value === '' ? fallback : ['true', 'yes', 'on', '1'].includes(value)
  }
  const number = (key: string, fallback: number) => {
    const value = Number(values.get(key))
    return Number.isFinite(value) && value > 0 ? value : fallback
  }
  const provider = values.get('provider')
  return {
    memoryEnabled: flag('memory_enabled', true),
    userProfileEnabled: flag('user_profile_enabled', true),
    writeApproval: flag('write_approval', false),
    ...(provider && !['null', 'none', '~'].includes(provider.toLowerCase()) ? { provider } : {}),
    memoryLimit: number('memory_char_limit', DEFAULT_MEMORY_LIMIT),
    userLimit: number('user_char_limit', DEFAULT_USER_LIMIT),
    source: values.size > 0 ? 'config.yaml' : 'defaults',
  }
}

export async function collectAgentMemory(folder: AgentFolder): Promise<AgentMemory> {
  const base = { profile: folder.profile, label: folder.label, path: folder.path }
  if (!folder.available) return { ...base, kind: folder.profile === 'opencode' ? 'opencode' : 'hermes', available: false, reason: folder.reason, contextFiles: [] }
  if (folder.profile === 'opencode') {
    const contextFiles = (await Promise.all(OPENCODE_CONTEXT_FILES.map((name) => readDocument(folder, name)))).filter((document) => document.exists)
    return { ...base, kind: 'opencode', available: true, contextFiles }
  }
  const [soul, memoryFile, userFile, config, ...context] = await Promise.all([
    readDocument(folder, 'SOUL.md'),
    readDocument(folder, 'memories/MEMORY.md'),
    readDocument(folder, 'memories/USER.md'),
    readDocument(folder, 'config.yaml'),
    ...CONTEXT_FILES.map((name) => readDocument(folder, name)),
  ])
  const settings = parseMemorySettings(config.content)
  return {
    ...base,
    kind: 'hermes',
    available: true,
    soul,
    memory: toStore(memoryFile, settings.memoryLimit),
    user: toStore(userFile, settings.userLimit),
    contextFiles: context.filter((document) => document.exists),
    settings,
  }
}

export async function collectMemory(folders: AgentFolder[]): Promise<MemorySnapshot> {
  // One unreadable agent must not take the whole page down.
  const agents = await Promise.all(folders.map((folder) => collectAgentMemory(folder).catch((error: unknown): AgentMemory => ({
    profile: folder.profile, label: folder.label, path: folder.path, kind: folder.profile === 'opencode' ? 'opencode' : 'hermes',
    available: false, reason: error instanceof Error ? error.message : 'Could not read this agent.', contextFiles: [],
  }))))
  return { agents, fetchedAt: new Date().toISOString() }
}
