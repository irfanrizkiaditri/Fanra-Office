#!/usr/bin/env node
// Command-line entry point of the installed package: `ruang [--port <n>]`.
import { existsSync, readFileSync } from 'node:fs'

const packageJson = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
const args = process.argv.slice(2)

const help = `Ruang · Hermes 3D Virtual Office ${packageJson.version}
A 3D virtual office and read-only mission control for your Hermes Agent and OpenCode crew.

Usage: ruang [options]
       ruang access-code <status|new|off>

Options:
  -p, --port <port>  Port to listen on (default 3001, or RUANG_PORT)
  -v, --version      Print the version
  -h, --help         Show this help

Access code (optional, set it in Settings):
  ruang access-code status  Show whether an access code is set
  ruang access-code new     Replace it with a new random code and print it
  ruang access-code off     Remove it (use this if the code is lost)

The server listens on 127.0.0.1 only. Open http://127.0.0.1:<port> in a browser;
on a remote machine, forward the port: ssh -L 3001:127.0.0.1:3001 user@host`

async function accessCode(action) {
  const module = new URL('../build/server/access.js', import.meta.url)
  if (!existsSync(module)) { console.error('Ruang is not built. From a source checkout, run: npm run build'); process.exit(1) }
  const { AccessStore, generateCode } = await import(module.href)
  const store = new AccessStore()
  if (action === 'status' || action === undefined) {
    const state = await store.state()
    console.log(!state.enabled ? 'Access code: off' : state.file ? `Access code: on (set ${state.file.createdAt})` : `Access code: on, but ${store.path} cannot be read. Run: ruang access-code off`)
  } else if (action === 'off') {
    await store.clear()
    console.log('Access code removed. Ruang opens without a code; set a new one in Settings.')
  } else if (action === 'new') {
    const code = generateCode()
    await store.set(code)
    console.log(`New access code (shown once, keep it safe):\n\n  ${code}\n\nEvery browser session has been signed out.`)
  } else {
    console.error(`Unknown access-code action: ${action}\n\n${help}`)
    process.exit(2)
  }
  process.exit(0)
}

if (args[0] === 'access-code') await accessCode(args[1])

for (let index = 0; index < args.length; index += 1) {
  const arg = args[index]
  if (arg === '-h' || arg === '--help') { console.log(help); process.exit(0) }
  if (arg === '-v' || arg === '--version') { console.log(packageJson.version); process.exit(0) }
  if (arg === '-p' || arg === '--port' || arg.startsWith('--port=')) {
    const value = arg.startsWith('--port=') ? arg.slice('--port='.length) : args[(index += 1)]
    const port = Number(value)
    if (!Number.isInteger(port) || port < 1 || port > 65535) { console.error(`Invalid port: ${value ?? '(missing)'}`); process.exit(2) }
    process.env.RUANG_PORT = String(port)
    continue
  }
  console.error(`Unknown option: ${arg}\n\n${help}`)
  process.exit(2)
}

const server = new URL('../build/server/index.js', import.meta.url)
if (!existsSync(server)) {
  console.error('Ruang is not built. From a source checkout, run: npm run build')
  process.exit(1)
}
await import(server.href)
