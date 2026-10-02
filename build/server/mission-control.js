import { execFile as execFileCallback } from 'node:child_process';
import { promisify } from 'node:util';
const execFile = promisify(execFileCallback);
const CACHE_MS = 10_000;
const INSIGHTS_CACHE_MS = 60_000;
const COMMAND_TIMEOUT_MS = 8_000;
const COMMAND_LOG_LIMIT = 100;
const LOG_TAIL_LINES = 200;
/** Error thrown by the command runner. Carries stdout so a caller can recognise a benign non-zero exit. */
export class CommandError extends Error {
    code;
    stdout;
    constructor(message, code, stdout = '') {
        super(message);
        this.code = code;
        this.stdout = stdout;
    }
}
// ---------------------------------------------------------------------------
// Shared text helpers
function text(value) {
    return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}
function stripAnsi(output) {
    return output.replace(new RegExp(`${String.fromCharCode(27)}\\[[0-?]*[ -/]*[@-~]`, 'g'), '');
}
function lines(output) {
    return stripAnsi(output).replace(/\r/g, '').split('\n');
}
function toInt(value) {
    const parsed = Number((value ?? '').replace(/,/g, ''));
    return Number.isFinite(parsed) ? parsed : 0;
}
// ---------------------------------------------------------------------------
// Parsers. Formats follow the Hermes CLI (hermes_cli/*) as printed to a pipe.
const PROFILE_ROW = /^(.+?)\s+(\S+)\s+(running|stopped)(?:\s|$)/i;
function profileRows(output) {
    const all = lines(output);
    const headerIndex = all.findIndex((line) => /\bProfile\b/.test(line) && /\bModel\b/.test(line));
    if (headerIndex < 0)
        throw new Error('Unrecognized profile output.');
    return all.slice(headerIndex + 1).flatMap((line) => {
        const row = line.replace(/^[\s◆*>•]+/u, '').trimEnd();
        if (!row || /^[─-]+(\s+[─-]+)*$/.test(row))
            return [];
        const withGateway = row.match(PROFILE_ROW);
        const match = withGateway ?? row.match(/^(\S+)\s{2,}(\S+)/);
        if (!match)
            return [];
        // A display name renders as "Display Name (id)"; the id is the stable profile name.
        const displayed = match[1].trim();
        const name = displayed.match(/\(([\w.-]+)\)$/)?.[1] ?? displayed;
        const model = match[2] === '—' ? 'Not configured' : match[2];
        const gateway = withGateway ? (withGateway[3].toLowerCase() === 'running' ? 'Running' : 'Stopped') : 'Unknown';
        return [{ name, model, gateway }];
    });
}
export function parseProfiles(output) {
    const profiles = profileRows(output);
    if (profiles.length === 0)
        throw new Error('Unrecognized profile output.');
    return profiles;
}
export function parseGatewayStatus(output) {
    const clean = stripAnsi(output);
    // Hermes ends every variant with a ✓/✗ summary line; prefer it over raw systemd/journal text.
    if (/^\s*✗.*\b(not running|stopped|inactive)\b/im.test(clean))
        return 'Stopped';
    if (/^\s*✓.*\b(running|supervised)\b/im.test(clean))
        return 'Running';
    if (/\bparked\b/i.test(clean))
        return 'Stopped';
    if (/\b(stopped|inactive|not running)\b/i.test(clean))
        return 'Stopped';
    if (/\b(running|active)\b/i.test(clean))
        return 'Running';
    return 'Unknown';
}
/** The JSON document in a command's output, skipping any notice lines Hermes prints before it. */
export function jsonPayload(output) {
    const start = output.search(/^\s*[[{]/m);
    return JSON.parse(start > 0 ? output.slice(start) : output);
}
export function parseTasks(output) {
    const parsed = jsonPayload(output);
    const list = Array.isArray(parsed) ? parsed : parsed && typeof parsed === 'object' && Array.isArray(parsed.tasks) ? parsed.tasks : undefined;
    if (!list)
        throw new Error('Kanban response was not an array.');
    const tasks = list.flatMap((item) => {
        if (!item || typeof item !== 'object')
            return [];
        const record = item;
        const title = text(record.title) ?? text(record.name);
        const status = text(record.status) ?? text(record.state);
        const id = text(record.id);
        const assignee = text(record.assignee) ?? text(record.assignedTo) ?? text(record.owner);
        const priority = typeof record.priority === 'number' && Number.isFinite(record.priority) ? record.priority : undefined;
        return title && status ? [{ title, status: status.toLowerCase(), ...(id && /^[A-Za-z0-9_-]+$/.test(id) ? { id } : {}), ...(assignee ? { assignee } : {}), ...(priority !== undefined ? { priority } : {}) }] : [];
    });
    if (list.length > 0 && tasks.length === 0)
        throw new Error('Unrecognized Kanban output.');
    return tasks;
}
function tableRows(output) {
    const all = lines(output);
    const headerLine = all.find((line) => /[│┃]/.test(line) && /\bName\b/.test(line));
    if (!headerLine)
        return { headers: [], rows: [] };
    const headers = headerLine.split(/[│┃]/).slice(1, -1).map((cell) => cell.trim().toLowerCase());
    const headerIndex = all.indexOf(headerLine);
    const rows = [];
    for (const line of all.slice(headerIndex + 1)) {
        if (!line.trimStart().startsWith('│'))
            continue;
        const cells = line.trim().split('│').slice(1, -1).map((cell) => cell.trim());
        if (cells.length !== headers.length)
            continue;
        // Rich wraps long cells onto continuation rows. The last column (Status) is always set on a
        // real row, so a row with an empty last cell continues the previous one.
        const previous = rows[rows.length - 1];
        if (previous && !cells[cells.length - 1]) {
            cells.forEach((cell, index) => { if (cell)
                previous[index] = previous[index].endsWith('-') ? `${previous[index]}${cell}` : `${previous[index]} ${cell}`.trim(); });
            continue;
        }
        rows.push(cells);
    }
    return { headers, rows };
}
function headerValue(headers, row, names) {
    const index = headers.findIndex((header) => names.includes(header));
    return index === -1 ? undefined : text(row[index]);
}
const CRON_JOB_HEADER = /^\s{0,4}(\S+)\s+\[(active|paused|completed|disabled)\]\s*$/;
const CRON_FIELD = /^\s{2,}(Name|Schedule|Repeat|Next run|Overdue|Last run):\s*(.*)$/;
export function parseCronJobs(output) {
    const clean = stripAnsi(output);
    if (/^\s*No scheduled jobs\./im.test(clean))
        return [];
    const jobs = [];
    let current;
    const flush = () => {
        if (current?.schedule)
            jobs.push({ name: current.name ?? current.id, schedule: current.schedule, id: current.id, status: current.status, ...(current.nextRun ? { nextRun: current.nextRun } : {}), ...(current.overdue ? { overdue: true } : {}), ...(current.repeat ? { repeat: current.repeat } : {}), ...(current.lastRun ? { lastRun: current.lastRun, lastRunOk: current.lastRunOk } : {}) });
        current = undefined;
    };
    for (const line of lines(clean)) {
        const header = line.match(CRON_JOB_HEADER);
        if (header) {
            flush();
            current = { id: header[1], status: header[2] };
            continue;
        }
        const field = current && line.match(CRON_FIELD);
        if (!field || !current)
            continue;
        const value = field[2].trim();
        if (field[1] === 'Name')
            current.name = value === '(unnamed)' ? undefined : value;
        if (field[1] === 'Schedule')
            current.schedule = value;
        if (field[1] === 'Repeat')
            current.repeat = value;
        if (field[1] === 'Next run')
            current.nextRun = value;
        if (field[1] === 'Overdue') {
            current.nextRun = value.split(/\s{2,}/)[0];
            current.overdue = true;
        }
        if (field[1] === 'Last run') {
            // Only the timestamp and the ok/failed outcome are exposed; error text is never returned.
            const [at, outcome = ''] = value.split(/\s{2,}/);
            current.lastRun = at;
            current.lastRunOk = /^ok\b/i.test(outcome);
        }
    }
    flush();
    if (jobs.length > 0)
        return jobs;
    // Fallback: an older Hermes rendered cron jobs as a Rich table.
    const { headers, rows } = tableRows(output);
    const tableJobs = rows.flatMap((row) => {
        const name = headerValue(headers, row, ['name', 'title']);
        const schedule = headerValue(headers, row, ['schedule', 'cron']);
        const nextRun = headerValue(headers, row, ['next run', 'next']);
        const status = headerValue(headers, row, ['status']);
        return name && schedule ? [{ name, schedule, ...(nextRun ? { nextRun } : {}), ...(status ? { status } : {}) }] : [];
    });
    if (tableJobs.length === 0)
        throw new Error('Unrecognized cron output.');
    return tableJobs;
}
const SESSION_COLUMNS = ['Title', 'Preview', 'Workspace', 'Last Active', 'Src', 'ID'];
export function parseSessions(output) {
    const all = lines(output);
    if (all.some((line) => /^\s*No sessions found\.?\s*$/.test(line)))
        return [];
    const headerIndex = all.findIndex((line) => /^(Title|Preview)\s/.test(line) && /\bLast Active\b/.test(line) && /\bID\s*$/.test(line));
    if (headerIndex < 0)
        throw new Error('Unrecognized session output.');
    const header = all[headerIndex];
    const columns = SESSION_COLUMNS
        .map((label) => ({ label, start: header.search(new RegExp(`(^|\\s)${label}(\\s|$)`)) }))
        .filter((column) => column.start >= 0)
        .map((column) => ({ ...column, start: column.start === 0 ? 0 : column.start + 1 }))
        .sort((a, b) => a.start - b.start);
    const sessions = [];
    for (const line of all.slice(headerIndex + 1)) {
        if (!line.trim() || /^[\s─-]+$/.test(line))
            continue;
        const id = line.trim().split(/\s+/).pop();
        if (!id || !/^[A-Za-z0-9_-]{6,}$/.test(id))
            continue;
        const cell = (label) => {
            const index = columns.findIndex((column) => column.label === label);
            if (index < 0)
                return undefined;
            const end = columns[index + 1]?.start ?? line.length;
            const value = line.slice(columns[index].start, end).trim();
            return value && value !== '—' ? value : undefined;
        };
        const preview = cell('Preview') ?? '';
        const title = cell('Title') ?? (preview || 'Untitled session');
        const lastActive = cell('Last Active') ?? 'Unknown';
        const workspace = cell('Workspace');
        const source = cell('Src');
        sessions.push({ title, preview, lastActive, id, ...(workspace ? { workspace } : {}), ...(source ? { source } : {}) });
    }
    return sessions;
}
export function parseSkills(output) {
    const { headers, rows } = tableRows(output);
    if (!['name', 'category', 'source', 'trust', 'status'].every((header) => headers.includes(header)))
        throw new Error('Unrecognized skill output.');
    return rows.flatMap((row) => {
        const name = headerValue(headers, row, ['name']);
        const category = headerValue(headers, row, ['category']) ?? '';
        const source = headerValue(headers, row, ['source']);
        const trust = headerValue(headers, row, ['trust']);
        const status = headerValue(headers, row, ['status']);
        return name && source && trust && status === 'enabled' ? [{ name, category, source, trust, status: 'enabled' }] : [];
    });
}
const PLATFORMS = ['WeCom Callback', 'Telegram', 'Discord', 'WhatsApp', 'Signal', 'Slack', 'Email', 'SMS', 'DingTalk', 'Feishu', 'WeCom', 'Weixin', 'BlueBubbles', 'QQBot', 'Yuanbao', 'Matrix', 'Mattermost', 'iMessage'];
const PLATFORM_ROW = new RegExp(`^\\s*(${PLATFORMS.join('|')})(?:\\s*:\\s*|\\s+)(?:[✓✗]\\s*)?(configured|connected)\\b`, 'i');
export function parseChannelStatus(output) {
    const all = lines(output);
    const heading = all.findIndex((line) => /^[^\w\r\n]*Messaging Platforms\s*$/i.test(line.trim()));
    if (heading < 0)
        throw new Error('Unrecognized channel output.');
    const canonical = new Map(PLATFORMS.map((name) => [name.toLowerCase(), name]));
    const channels = [];
    for (const line of all.slice(heading + 1)) {
        if (/^\s*◆/.test(line))
            break;
        const match = line.match(PLATFORM_ROW);
        if (match)
            channels.push({ name: canonical.get(match[1].toLowerCase()), status: match[2].toLowerCase() === 'connected' ? 'Connected' : 'Configured' });
    }
    // Current Hermes: "◆ Sessions" section with "  Active:  3 session(s)". Older: "Active sessions: 3".
    const sessionsHeading = all.findIndex((line) => /^[^\w]*Sessions\s*$/.test(line.trim()));
    const sectionLine = sessionsHeading >= 0 ? all.slice(sessionsHeading + 1).find((line, index, rest) => /^\s*Active:\s+\d+/.test(line) && !rest.slice(0, index).some((previous) => /^\s*◆/.test(previous))) : undefined;
    const legacyLine = all.find((line) => /^\s*Active sessions\s*:?[ ]+\d+\s*$/i.test(line));
    const sessionMatch = (sectionLine ?? legacyLine)?.match(/(\d+)/);
    return { channels, ...(sessionMatch ? { activeSessions: Number(sessionMatch[1]) } : {}) };
}
export function parseInsights(output, days) {
    const all = lines(output);
    const empty = { days, sessions: 0, messages: 0, toolCalls: 0, inputTokens: 0, outputTokens: 0, totalTokens: 0, models: [], tools: [], sources: [] };
    if (all.some((line) => /No sessions found in the last|No session data yet/i.test(line)))
        return empty;
    const overviewIndex = all.findIndex((line) => /Overview\s*$/.test(line));
    if (overviewIndex < 0)
        throw new Error('Unrecognized insights output.');
    const joined = all.join('\n');
    const number = (label) => toInt(joined.match(new RegExp(`${label}:\\s+([\\d,]+)`))?.[1]);
    const section = (title) => {
        const start = all.findIndex((line) => title.test(line));
        if (start < 0)
            return [];
        const rows = [];
        for (const line of all.slice(start + 3)) {
            if (!line.trim())
                break;
            rows.push(line);
        }
        return rows;
    };
    const models = section(/Models Used\s*$/).flatMap((line) => {
        const match = line.match(/^\s+(.+?)\s+(\d+)\s+([\d,]+)\s*$/);
        return match ? [{ model: match[1], sessions: toInt(match[2]), tokens: toInt(match[3]) }] : [];
    });
    const tools = section(/Top Tools\s*$/).flatMap((line) => {
        const match = line.match(/^\s+(\S.*?)\s+([\d,]+)\s+[\d.]+%\s*$/);
        return match ? [{ tool: match[1], calls: toInt(match[2]) }] : [];
    });
    const estimatedCost = joined.match(/Estimated:\s+(~?\$[\d,.]+)/)?.[1];
    const sessions = number('Sessions');
    const totalTokens = number('Total tokens');
    // Hermes prints the Platforms section only when there is more than plain CLI use.
    const platformRows = section(/Platforms\s*$/).flatMap((line) => {
        const match = line.match(/^\s+(\S+)\s+([\d,]+)\s+[\d,]+\s+([\d,]+)\s*$/);
        return match ? [{ source: match[1].toLowerCase(), sessions: toInt(match[2]), tokens: toInt(match[3]) }] : [];
    });
    const sources = platformRows.length > 0 ? platformRows.sort((a, b) => b.tokens - a.tokens) : sessions > 0 ? [{ source: 'cli', sessions, tokens: totalTokens }] : [];
    const top = joined.match(/^\s*Most tokens\s+([\d,]+) tokens\s+\(([^,)]+)/m);
    return {
        days,
        sessions,
        messages: number('Messages'),
        toolCalls: number('Tool calls'),
        inputTokens: number('Input tokens'),
        outputTokens: number('Output tokens'),
        totalTokens,
        ...(estimatedCost ? { estimatedCost, costUsd: Number(estimatedCost.replace(/[^\d.]/g, '')) } : {}),
        models,
        tools,
        sources,
        ...(top ? { topSession: { tokens: toInt(top[1]), date: top[2].trim() } } : {}),
    };
}
const SECRET_PATTERNS = [
    [/\b(sk|pk|rk|xox[abprs]|ghp|gho|ghs|github_pat|glpat|AKIA)[-_A-Za-z0-9]{8,}/g, '[redacted]'],
    [/\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]{8,}/gi, '$1 [redacted]'],
    // Values shorter than 8 characters (e.g. `max_tokens: 4096`) are settings, not secrets.
    [/\b([A-Za-z_]*(?:api[_-]?key|token|secret|password|passwd|authorization|cookie)[A-Za-z_]*)(["']?\s*[:=]\s*["']?)(?!\[redacted\])[^\s"',}]{8,}/gi, '$1$2[redacted]'],
    [/\b\d{8,10}:[A-Za-z0-9_-]{30,}\b/g, '[redacted]'],
    [/(?:\/home|\/Users)\/[^/\s]+|\/root(?=\/|\b)/g, '~'],
];
export function redactLogLine(line, maxLength = 600) {
    const redacted = SECRET_PATTERNS.reduce((value, [pattern, replacement]) => value.replace(pattern, replacement), line);
    return redacted.length > maxLength ? `${redacted.slice(0, maxLength)}…` : redacted;
}
const LOG_LEVEL = /^\d{4}-\d{2}-\d{2}[ T][\d:,.]+\s+(DEBUG|INFO|WARNING|WARN|ERROR|CRITICAL)\b/;
export function parseLogLines(output) {
    let level = 'OTHER';
    return lines(output).flatMap((raw) => {
        if (!raw.trim() || /^---\s.*\s---$/.test(raw.trim()))
            return [];
        const match = raw.match(LOG_LEVEL);
        if (match) {
            const found = match[1];
            level = found === 'CRITICAL' ? 'ERROR' : found === 'WARN' ? 'WARNING' : found;
        }
        return [{ text: redactLogLine(raw), level }];
    });
}
// ---------------------------------------------------------------------------
// Command runner, with a bounded in-memory audit log of fixed read commands.
const commandLog = [];
function recordCommand(entry) {
    commandLog.unshift(entry);
    if (commandLog.length > COMMAND_LOG_LIMIT)
        commandLog.length = COMMAND_LOG_LIMIT;
}
function describeFailure(error) {
    if (error instanceof CommandError)
        return error;
    const detail = (error ?? {});
    const stdout = typeof detail.stdout === 'string' ? detail.stdout : '';
    if (detail.killed || detail.signal === 'SIGTERM' || /timed? ?out/i.test(String(detail.message ?? '')))
        return new CommandError('Read timed out.', 'TIMEOUT', stdout);
    if (detail.code === 'ENOENT')
        return new CommandError('Command not installed or not on PATH.', 'COMMAND_FAILED', stdout);
    if (detail.code === 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER')
        return new CommandError('Command output exceeded the read limit.', 'COMMAND_FAILED', stdout);
    if (typeof detail.code === 'number')
        return new CommandError(`Command exited with code ${detail.code}.`, 'COMMAND_FAILED', stdout);
    return new CommandError('Read command was unavailable.', 'COMMAND_FAILED', stdout);
}
async function systemRun(file, args, options = {}) {
    const started = Date.now();
    const command = [file, ...args].join(' ');
    try {
        const { stdout } = await execFile(file, args, {
            timeout: COMMAND_TIMEOUT_MS,
            maxBuffer: 16 * 1024 * 1024,
            env: { ...process.env, NO_COLOR: '1', TERM: 'dumb', COLUMNS: '200', PYTHONIOENCODING: 'utf-8' },
        });
        recordCommand({ command, ok: true, durationMs: Date.now() - started, at: new Date(started).toISOString() });
        return stdout;
    }
    catch (error) {
        const failure = describeFailure(error);
        const benign = options.benign?.test(failure.stdout) ?? false;
        recordCommand({ command, ok: benign, durationMs: Date.now() - started, at: new Date(started).toISOString(), ...(benign ? {} : { error: failure.message }) });
        throw failure;
    }
}
function commandHealth() {
    const failed = commandLog.filter((entry) => !entry.ok).length;
    const averageMs = commandLog.length ? Math.round(commandLog.reduce((sum, entry) => sum + entry.durationMs, 0) / commandLog.length) : 0;
    return { total: commandLog.length, failed, averageMs };
}
export function getCommandLog() {
    return { entries: commandLog.slice(0, 50), health: commandHealth(), fetchedAt: new Date().toISOString() };
}
export function clearCommandLog() { commandLog.length = 0; }
function failure(error, fallback) {
    const described = error instanceof CommandError ? error : error instanceof Error && /timed out|timeout/i.test(error.message) ? new CommandError('Read timed out.', 'TIMEOUT') : undefined;
    const code = described?.code ?? 'COMMAND_FAILED';
    const message = described?.message ?? (error instanceof SyntaxError ? 'Source returned output that could not be parsed.' : error instanceof Error && /^Unrecognized/.test(error.message) ? error.message : 'Read command was unavailable.');
    return { availability: 'unavailable', data: fallback, error: { code, message: code === 'TIMEOUT' ? 'Read timed out.' : message } };
}
async function read(run, file, args, parse, fallback) {
    try {
        return { availability: 'available', data: parse(await run(file, args)) };
    }
    catch (error) {
        return failure(error, fallback);
    }
}
// ---------------------------------------------------------------------------
// Collectors
/** Profile names passed to `hermes -p`: plain names only, never anything that looks like an option. */
export const PROFILE_NAME = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$/;
export async function collectSnapshot(run = systemRun) {
    const [profiles, openCode] = await Promise.all([
        read(run, 'hermes', ['profile', 'list'], parseProfiles, []),
        read(run, 'opencode', ['--version'], (value) => value.trim().split('\n').pop()?.trim() || 'Unknown', 'Unknown'),
    ]);
    return { profiles, openCode, fetchedAt: new Date().toISOString() };
}
/** Board slugs passed to `hermes kanban --board`: Hermes' own slug rule, never an option. */
export const BOARD_SLUG = /^[a-z0-9][a-z0-9_-]{0,63}$/;
export function parseBoards(output) {
    const parsed = jsonPayload(output);
    if (!Array.isArray(parsed))
        throw new Error('Unrecognized Kanban boards output.');
    return parsed.flatMap((item) => {
        if (!item || typeof item !== 'object')
            return [];
        const record = item;
        const slug = text(record.slug);
        if (!slug || !BOARD_SLUG.test(slug) || record.archived === true)
            return [];
        return [{ slug, name: text(record.name) ?? slug, current: record.is_current === true, total: typeof record.total === 'number' && Number.isFinite(record.total) ? record.total : 0 }];
    });
}
const KANBAN_CONCURRENCY = 4;
/**
 * Tasks of every Kanban board. Hermes keeps one board per slug (shared by all profiles) and
 * `hermes kanban list` only shows the current one, so each board with tasks is read with
 * `--board`. Hermes versions without boards fall back to the plain list.
 */
export async function collectTaskBoard(run = systemRun) {
    const fetchedAt = new Date().toISOString();
    const boards = await read(run, 'hermes', ['kanban', 'boards', 'list', '--json'], parseBoards, []);
    if (boards.availability !== 'available' || boards.data.length === 0)
        return { tasks: await read(run, 'hermes', ['kanban', 'list', '--json'], parseTasks, []), fetchedAt };
    // Boards list only counts non-archived tasks, which is exactly what `kanban list` returns.
    const withTasks = boards.data.filter((board) => board.total > 0 || board.current);
    const results = await mapLimit(withTasks, KANBAN_CONCURRENCY, (board) => read(run, 'hermes', ['kanban', '--board', board.slug, 'list', '--json'], parseTasks, []));
    const failedBoards = withTasks.filter((_, index) => results[index].availability !== 'available').map((board) => board.slug);
    if (withTasks.length > 0 && failedBoards.length === withTasks.length)
        return { tasks: results[0], boards: boards.data, fetchedAt };
    const tasks = results.flatMap((result, index) => result.availability === 'available' ? result.data.map((task) => ({ ...task, board: withTasks[index].slug })) : []);
    return { tasks: { availability: 'available', data: tasks }, boards: boards.data, ...(failedBoards.length ? { failedBoards } : {}), fetchedAt };
}
/**
 * Cron jobs of every Hermes profile. Hermes stores cron per profile, so each profile from
 * `hermes profile list` is read with `hermes -p <profile> cron list --all` and its jobs are
 * tagged with the profile. If the profile list cannot be read, the active profile is read as before.
 */
export async function collectCalendar(run = systemRun) {
    const fetchedAt = new Date().toISOString();
    const profiles = await read(run, 'hermes', ['profile', 'list'], parseProfiles, []);
    const names = profiles.availability === 'available' ? profiles.data.map((profile) => profile.name).filter((name) => PROFILE_NAME.test(name)) : [];
    if (names.length === 0)
        return { jobs: await read(run, 'hermes', ['cron', 'list', '--all'], parseCronJobs, []), fetchedAt };
    const results = await Promise.all(names.map((name) => read(run, 'hermes', ['-p', name, 'cron', 'list', '--all'], parseCronJobs, [])));
    if (results.every((result) => result.availability !== 'available'))
        return { jobs: results[0], fetchedAt };
    const jobs = results.flatMap((result, index) => result.availability === 'available' ? result.data.map((job) => ({ ...job, agent: names[index] })) : []);
    const failedProfiles = names.filter((_, index) => results[index].availability !== 'available');
    return { jobs: { availability: 'available', data: jobs }, ...(failedProfiles.length ? { failedProfiles } : {}), fetchedAt };
}
export async function collectActivity(run = systemRun) {
    const sessions = await read(run, 'hermes', ['sessions', 'list', '--limit', '20'], parseSessions, []);
    return { sessions, fetchedAt: new Date().toISOString() };
}
export async function collectKnowledge(run = systemRun) {
    const skills = await read(run, 'hermes', ['skills', 'list', '--enabled-only'], parseSkills, []);
    return { skills, fetchedAt: new Date().toISOString() };
}
export async function collectChannels(run = systemRun) {
    const channelData = await read(run, 'hermes', ['status', '--all'], parseChannelStatus, { channels: [] });
    return {
        channels: { availability: channelData.availability, data: channelData.data.channels, ...(channelData.error && { error: channelData.error }) },
        ...(channelData.availability === 'available' && channelData.data.activeSessions !== undefined ? { activeSessions: channelData.data.activeSessions } : {}),
        fetchedAt: new Date().toISOString(),
    };
}
export const INSIGHT_DAYS = 7;
export async function collectInsights(run = systemRun) {
    return read(run, 'hermes', ['insights', '--days', String(INSIGHT_DAYS)], (output) => parseInsights(output, INSIGHT_DAYS), null);
}
/** Periods the token view offers, in days. */
export const USAGE_PERIODS = [1, 7, 30];
const USAGE_CONCURRENCY = 4;
function mergeRows(key, rows) {
    const merged = new Map();
    for (const row of rows) {
        const current = merged.get(row[key]) ?? { sessions: 0, tokens: 0 };
        merged.set(row[key], { sessions: current.sessions + row.sessions, tokens: current.tokens + row.tokens });
    }
    return [...merged].map(([name, value]) => ({ [key]: name, ...value })).sort((a, b) => b.tokens - a.tokens);
}
/**
 * Token usage of every agent. Hermes keeps sessions per profile, so `hermes insights` only
 * covers the active one; each profile is read with `-p` (at most four at a time) and summed.
 */
export async function collectUsage(days, profiles, run = systemRun) {
    const names = profiles.filter((name) => PROFILE_NAME.test(name));
    const agents = await mapLimit(names.length > 0 ? names : ['default'], USAGE_CONCURRENCY, async (agent) => {
        const result = await read(run, 'hermes', [...(names.length > 0 ? ['-p', agent] : []), 'insights', '--days', String(days)], (output) => parseInsights(output, days), null);
        return result.availability === 'available' && result.data ? { agent, availability: 'available', usage: result.data } : { agent, availability: 'unavailable', error: result.error?.message ?? 'hermes insights could not be read.' };
    });
    const readable = agents.flatMap((agent) => (agent.usage ? [agent.usage] : []));
    const sum = (field) => readable.reduce((total, usage) => total + usage[field], 0);
    const costs = readable.flatMap((usage) => (usage.costUsd !== undefined && Number.isFinite(usage.costUsd) ? [usage.costUsd] : []));
    return {
        days,
        agents: agents.sort((a, b) => (b.usage?.totalTokens ?? -1) - (a.usage?.totalTokens ?? -1)),
        totals: { sessions: sum('sessions'), messages: sum('messages'), toolCalls: sum('toolCalls'), inputTokens: sum('inputTokens'), outputTokens: sum('outputTokens'), totalTokens: sum('totalTokens'), ...(costs.length ? { costUsd: costs.reduce((total, cost) => total + cost, 0) } : {}) },
        models: mergeRows('model', readable.flatMap((usage) => usage.models)),
        sources: mergeRows('source', readable.flatMap((usage) => usage.sources)),
        tools: [...readable.flatMap((usage) => usage.tools).reduce((calls, tool) => calls.set(tool.tool, (calls.get(tool.tool) ?? 0) + tool.calls), new Map())].map(([tool, calls]) => ({ tool, calls })).sort((a, b) => b.calls - a.calls),
        fetchedAt: new Date().toISOString(),
    };
}
export const LOG_FILES = [
    { name: 'agent', label: 'Agent' },
    { name: 'gateway', label: 'Gateway' },
    { name: 'errors', label: 'Errors' },
];
const LOG_MISSING = /Log file not found/i;
export async function collectLogs(run = systemRun) {
    const files = await Promise.all(LOG_FILES.map(async ({ name, label }) => {
        try {
            return { name, label, source: { availability: 'available', data: parseLogLines(await run('hermes', ['logs', name, '-n', String(LOG_TAIL_LINES)], { benign: LOG_MISSING })) } };
        }
        catch (error) {
            // `hermes logs` exits 1 before a log file has been created; that is an empty log, not an outage.
            if (error instanceof CommandError && LOG_MISSING.test(error.stdout))
                return { name, label, source: { availability: 'available', data: [] } };
            return { name, label, source: failure(error, []) };
        }
    }));
    return { files, fetchedAt: new Date().toISOString() };
}
export const TASK_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;
function clean(value, max = 20_000) {
    const raw = typeof value === 'string' ? value : typeof value === 'number' ? String(value) : value && typeof value === 'object' ? JSON.stringify(value) : undefined;
    if (!raw || !raw.trim())
        return undefined;
    return raw.split('\n').map((line) => redactLogLine(line, Number.POSITIVE_INFINITY)).join('\n').slice(0, max);
}
function epoch(value) {
    if (typeof value === 'number' && Number.isFinite(value) && value > 0)
        return new Date(value * 1000).toISOString();
    if (typeof value === 'string' && value.trim())
        return Number.isFinite(Date.parse(value)) ? new Date(Date.parse(value)).toISOString() : value;
    return undefined;
}
function ids(value) {
    return Array.isArray(value) ? value.filter((item) => typeof item === 'string' && TASK_ID.test(item)) : [];
}
function records(value) {
    return Array.isArray(value) ? value.filter((item) => Boolean(item) && typeof item === 'object') : [];
}
function compact(value) {
    return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined));
}
export function parseTaskDetail(output) {
    const parsed = jsonPayload(output);
    const root = parsed && typeof parsed === 'object' ? parsed : {};
    const task = root.task && typeof root.task === 'object' ? root.task : undefined;
    const id = text(task?.id);
    const title = text(task?.title);
    if (!task || !id || !title)
        throw new Error('Unrecognized Kanban task output.');
    const workspaceKind = text(task.workspace_kind);
    const workspacePath = clean(task.workspace_path, 500);
    const model = text(task.model_override);
    return compact({
        id,
        title: clean(title, 500) ?? title,
        status: (text(task.status) ?? 'unknown').toLowerCase(),
        assignee: text(task.assignee),
        priority: typeof task.priority === 'number' ? task.priority : undefined,
        tenant: text(task.tenant),
        workspace: workspaceKind || workspacePath ? [workspaceKind, workspacePath].filter(Boolean).join(' @ ') : undefined,
        branch: text(task.branch_name),
        skills: Array.isArray(task.skills) ? task.skills.filter((skill) => typeof skill === 'string') : [],
        model: model ? `${model}${text(task.provider_override) ? ` (${text(task.provider_override)})` : ''}` : undefined,
        createdAt: epoch(task.created_at),
        createdBy: text(task.created_by),
        startedAt: epoch(task.started_at),
        completedAt: epoch(task.completed_at),
        body: clean(task.body),
        result: clean(task.result) ?? clean(root.latest_summary),
        lastError: clean(task.last_failure_error, 4_000),
        parents: ids(root.parents),
        children: ids(root.children),
        comments: records(root.comments).map((comment) => compact({ author: text(comment.author) ?? 'unknown', body: clean(comment.body, 4_000) ?? '', createdAt: epoch(comment.created_at) })),
        events: records(root.events).slice(-30).map((event) => compact({ kind: text(event.kind) ?? 'event', detail: clean(event.payload, 400), createdAt: epoch(event.created_at), runId: event.run_id === null || event.run_id === undefined ? undefined : String(event.run_id) })),
        runs: records(root.runs).map((run) => compact({ id: String(run.id ?? ''), profile: text(run.profile), status: text(run.status), outcome: text(run.outcome), summary: clean(run.summary, 4_000), error: clean(run.error, 2_000), startedAt: epoch(run.started_at), endedAt: epoch(run.ended_at) })),
    });
}
export async function collectTaskDetail(id, run = systemRun, board) {
    if (!TASK_ID.test(id))
        throw new Error('Invalid task id.');
    if (board !== undefined && !BOARD_SLUG.test(board))
        throw new Error('Invalid board.');
    const task = await read(run, 'hermes', ['kanban', ...(board ? ['--board', board] : []), 'show', id, '--json'], parseTaskDetail, null);
    return { task, fetchedAt: new Date().toISOString() };
}
// ---------------------------------------------------------------------------
// Live agent activity. Every Hermes profile writes all of its work (gateway chat replies,
// cron runs, tool calls, the agent loop) to its own agent.log, so a recent log line or a
// session active in the last few minutes is direct, attributable evidence of work.
export const ACTIVITY_WINDOW = '3m';
/** At most this many profiles are probed at once, so many profiles do not flood the machine. */
const ACTIVITY_CONCURRENCY = 4;
const LOG_RECORD = /^(\d{4}-\d{2}-\d{2}[ T][\d:,.]+)\s+[A-Z]+(?:\s+\[[^\]]*\])?\s+([\w.]+):\s?(.*)$/;
const CHAT_MESSAGE = /\b(message|reply|replied|respond|inbound|outbound|received|sending|sent|chat)\b/i;
const ACTIVITY_LABELS = {
    chat: 'Replying to a chat',
    cron: 'Running a scheduled job',
    tools: 'Using tools',
    thinking: 'Working on a request',
};
function loggerKind(name, message) {
    if (/^cron\b/.test(name))
        return 'cron';
    if (/^(tools|model_tools)\b/.test(name))
        return 'tools';
    if (/^(agent|run_agent|batch_runner)\b/.test(name))
        return 'thinking';
    if (/^(gateway|hermes_plugins|plugins\.platforms)\b/.test(name))
        return CHAT_MESSAGE.test(message) ? 'chat' : 'gateway';
    return undefined; // hermes_cli, uvicorn, gui: not agent work
}
export function parseRecentActivity(logOutput, sessionOutput) {
    const found = new Set();
    let lastSeen;
    let mentionsOpenCode = false;
    for (const line of lines(logOutput)) {
        const record = line.match(LOG_RECORD);
        if (!record)
            continue;
        const kind = loggerKind(record[2], record[3]);
        if (!kind)
            continue;
        found.add(kind);
        if (kind !== 'gateway')
            lastSeen = record[1];
        if (/\bopencode\b/i.test(record[3]))
            mentionsOpenCode = true;
    }
    // Gateway lines alone can be polling noise; with agent-loop lines they are a chat reply.
    if (found.has('gateway') && (found.has('thinking') || found.has('tools')))
        found.add('chat');
    let sessionActive = false;
    if (sessionOutput) {
        try {
            sessionActive = /^(just now|[0-3]m ago)$/.test(parseSessions(sessionOutput)[0]?.lastActive ?? '');
        }
        catch {
            sessionActive = false;
        }
    }
    if (sessionActive && found.size === 0)
        found.add('chat');
    const kind = ['cron', 'chat', 'tools', 'thinking'].find((item) => found.has(item));
    return { active: kind !== undefined, ...(kind ? { kind, label: ACTIVITY_LABELS[kind] } : {}), ...(lastSeen ? { lastSeen } : {}), mentionsOpenCode };
}
/** Runs `task` over `items` with at most `limit` in flight, keeping the input order. */
async function mapLimit(items, limit, task) {
    const results = new Array(items.length);
    let next = 0;
    const worker = async () => { while (next < items.length) {
        const index = next++;
        results[index] = await task(items[index]);
    } };
    await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
    return results;
}
/** Live activity of every given Hermes profile (see `hermes profile list`). */
export async function collectAgentActivity(profiles, run = systemRun) {
    const agents = await mapLimit(profiles.filter((profile) => PROFILE_NAME.test(profile)), ACTIVITY_CONCURRENCY, async (profile) => {
        const [logs, sessions] = await Promise.all([
            run('hermes', ['-p', profile, 'logs', 'agent', '-n', '80', '--since', ACTIVITY_WINDOW], { benign: LOG_MISSING }).then((output) => ({ ok: true, output }), (error) => (error instanceof CommandError && LOG_MISSING.test(error.stdout) ? { ok: true, output: '' } : { ok: false, output: '' })),
            run('hermes', ['-p', profile, 'sessions', 'list', '--limit', '3']).then((output) => output, () => undefined),
        ]);
        if (!logs.ok && sessions === undefined)
            return { profile, availability: 'unavailable', active: false, mentionsOpenCode: false };
        return { profile, availability: 'available', ...parseRecentActivity(logs.output, sessions) };
    });
    return { agents, fetchedAt: new Date().toISOString() };
}
export function agentRoster(runtime) {
    const profiles = runtime.profiles.availability === 'available' ? runtime.profiles.data : [];
    const agents = profiles.filter((profile) => PROFILE_NAME.test(profile.name)).map((profile) => ({ id: profile.name, role: 'Hermes profile', profile: profile.name, gateway: profile.gateway, aliases: [profile.name.toLowerCase()] }));
    if (runtime.openCode.availability === 'available' && !agents.some((agent) => agent.id === 'opencode'))
        agents.push({ id: 'opencode', role: 'OpenCode', aliases: ['opencode', 'open-code'] });
    return agents;
}
export const officeRooms = [
    { id: 'Workspace', label: 'Workspace', description: 'Desks, collaboration, and neutral presence positions.' },
    { id: 'Lounge', label: 'Lounge', description: 'A quiet break and idle room.' },
];
const ACTIVE_TASK_ORDER = ['running', 'review'];
function attributedTask(tasks, aliases) {
    const mine = tasks.filter((task) => task.assignee && aliases.includes(task.assignee.trim().toLowerCase()));
    // Prefer the task that explains current work; otherwise show the first open task.
    for (const status of ACTIVE_TASK_ORDER) {
        const task = mine.find((item) => item.status.toLowerCase() === status);
        if (task)
            return task;
    }
    return mine.find((task) => !['done', 'archived'].includes(task.status.toLowerCase()));
}
function taskState(task) {
    if (!task)
        return 'Unknown';
    if (task.status.toLowerCase() === 'running')
        return 'Working';
    if (task.status.toLowerCase() === 'review')
        return 'Reviewing';
    return 'Unknown';
}
function collaborationState(sessions, aliases) {
    return sessions.some((session) => session.active === true && session.actor && aliases.includes(session.actor.trim().toLowerCase())) ? 'Collaborating' : 'Unknown';
}
function isFresh(fetchedAt, now) {
    const timestamp = Date.parse(fetchedAt);
    return Number.isFinite(timestamp) && timestamp <= now + 1_000 && now - timestamp <= 30_000;
}
function explicitState(agent, states, now) {
    return states.find((record) => record.station === agent.id && Date.parse(record.expiresAt) > now)?.state;
}
function roomForState(state, index) {
    if (state === 'Idle')
        return { room: 'Lounge', roomPosition: `lounge-seat-${index + 1}` };
    if (state === 'Offline')
        return { room: 'Workspace', roomPosition: 'offline-station' };
    if (state === 'Reviewing')
        return { room: 'Workspace', roomPosition: 'review-desk' };
    if (state === 'Collaborating')
        return { room: 'Workspace', roomPosition: 'meeting-area' };
    if (state === 'Working')
        return { room: 'Workspace', roomPosition: 'assigned-desk' };
    return { room: 'Workspace', roomPosition: 'neutral-presence' };
}
export function buildOfficeSummary(stations, runtime) {
    const gateways = runtime.profiles.availability === 'available' ? runtime.profiles.data.map((profile) => profile.gateway) : [];
    return {
        declared: stations.length,
        active: stations.filter((station) => ['Working', 'Reviewing', 'Collaborating'].includes(station.state)).length,
        idle: stations.filter((station) => station.state === 'Idle').length,
        offline: stations.filter((station) => station.state === 'Offline').length,
        unknown: stations.filter((station) => station.state === 'Unknown').length,
        gatewaysReachable: gateways.filter((gateway) => gateway === 'Running').length,
        gatewaysDeclared: gateways.length,
    };
}
function liveState(agent, snapshot) {
    if (!snapshot)
        return { state: 'Unknown', known: true };
    if (!agent.profile) {
        // OpenCode has no Hermes profile; it counts as working when an agent's recent log shows it being driven.
        const driver = snapshot.agents.find((agent) => agent.mentionsOpenCode);
        return { state: driver ? 'Working' : 'Unknown', probe: driver && { ...driver, label: 'Building via OpenCode' }, known: snapshot.agents.every((agent) => agent.availability === 'available') };
    }
    const probe = snapshot.agents.find((item) => item.profile === agent.profile);
    if (!probe || probe.availability === 'unavailable')
        return { state: 'Unknown', probe, known: false };
    return { state: probe.active ? (probe.kind === 'chat' ? 'Collaborating' : 'Working') : 'Unknown', probe, known: true };
}
export function buildOfficeSnapshot(runtime, board, activity, options = {}) {
    const fetchedAt = new Date().toISOString();
    const now = typeof options.now === 'number' ? options.now : options.now ? Date.parse(options.now) : Date.now();
    const freshRuntime = isFresh(runtime.fetchedAt, now);
    const freshBoard = board.tasks.availability === 'available' && isFresh(board.fetchedAt, now);
    const freshActivity = activity.sessions.availability === 'available' && isFresh(activity.fetchedAt, now);
    const agentActivity = options.agentActivity && isFresh(options.agentActivity.fetchedAt, now) ? options.agentActivity : undefined;
    const explicitStates = options.explicitStates ?? [];
    const stations = agentRoster(runtime).map((agent, index) => {
        const gateway = agent.gateway;
        const task = freshBoard ? attributedTask(board.tasks.data, agent.aliases) : undefined;
        const overlay = explicitState(agent, explicitStates, now);
        const taskWorkState = taskState(task);
        const live = liveState(agent, agentActivity);
        const collaboration = freshActivity ? collaborationState(activity.sessions.data, agent.aliases) : 'Unknown';
        const stopped = gateway === 'Stopped';
        const liveKnown = options.agentActivity ? agentActivity !== undefined && live.known : true;
        // A stopped gateway only means the agent is not listening on messaging platforms; many agents
        // are used from the CLI and never run one, so it does not make an agent Offline. Direct
        // evidence of work wins; a Kanban task explains that work when it is running.
        const direct = overlay ?? (live.state !== 'Unknown' ? (taskWorkState !== 'Unknown' ? taskWorkState : live.state) : undefined);
        const state = direct ?? (taskWorkState !== 'Unknown' ? taskWorkState : collaboration !== 'Unknown' ? collaboration : freshRuntime && freshBoard && freshActivity && liveKnown ? 'Idle' : 'Unknown');
        const currentTask = board.tasks.availability === 'unavailable' ? 'Not Available' : task?.title ?? 'No attributed task';
        const activityLabel = state === 'Working' && taskWorkState === 'Working' && task ? `Kanban: ${task.title}`
            : state === 'Reviewing' && task ? `Reviewing: ${task.title}`
                : ['Working', 'Collaborating'].includes(state) && live.probe?.label ? live.probe.label
                    : state === 'Idle' ? stopped ? 'On a break · gateway stopped' : 'On a break'
                        : '';
        const recentActivity = live.probe
            ? live.probe.active ? `${live.probe.label ?? 'Active'}${live.probe.lastSeen ? ` (last log ${live.probe.lastSeen})` : ''}` : `No activity in the last ${ACTIVITY_WINDOW}`
            : activity.sessions.availability === 'unavailable' ? 'Not Available' : collaboration === 'Collaborating' ? 'Attributed active collaboration session' : 'No attributed recent activity';
        const runtimeProvenance = agent.profile ? `Gateway ${gateway ?? 'Unknown'} (hermes profile list)` : 'OpenCode version availability is not a state signal';
        const managedIdle = state === 'Idle' ? '; Ruang managed-idle placement policy (not agent-reported presence)' : '';
        const liveProvenance = options.agentActivity ? `; live activity (${agent.profile ? `hermes -p ${agent.profile} logs/sessions` : 'agent logs mentioning OpenCode'}, last ${ACTIVITY_WINDOW}): ${!agentActivity || !live.known ? 'unavailable' : live.state !== 'Unknown' ? live.probe?.kind ?? 'active' : 'none'}` : '';
        return {
            id: agent.id,
            name: agent.id,
            role: agent.role,
            ...roomForState(state, index),
            seat: index + 1,
            state,
            currentTask,
            recentActivity,
            activity: activityLabel,
            provenance: `${runtimeProvenance}; explicit state records: ${overlay ? 'fresh declared state' : 'none'}; Kanban: ${board.tasks.availability}${freshBoard ? ' fresh' : ' stale or unavailable'}; activity: ${activity.sessions.availability}${freshActivity ? ' fresh' : ' stale or unavailable'}${liveProvenance}${managedIdle}`,
            freshness: `Runtime ${runtime.fetchedAt}; Kanban ${board.fetchedAt}; activity ${activity.fetchedAt}${agentActivity ? `; live activity ${agentActivity.fetchedAt}` : ''}`,
        };
    });
    return { stations, summary: buildOfficeSummary(stations, runtime), fetchedAt };
}
// ---------------------------------------------------------------------------
// Dashboard aggregation
export function buildDashboard(parts) {
    const { runtime, board, calendar, activity, knowledge, channels, office, commands } = parts;
    const tasks = board.tasks.data;
    const byStatus = tasks.reduce((counts, task) => ({ ...counts, [task.status]: (counts[task.status] ?? 0) + 1 }), {});
    const jobs = calendar.jobs.data;
    const upcoming = jobs.filter((job) => job.status === 'active' && job.nextRun).map((job) => job.nextRun).sort()[0];
    const byCategory = knowledge.skills.data.reduce((counts, skill) => {
        const category = skill.category || 'uncategorized';
        return { ...counts, [category]: (counts[category] ?? 0) + 1 };
    }, {});
    return {
        runtime,
        tasks: { availability: board.tasks.availability, total: tasks.length, byStatus, assigned: tasks.filter((task) => task.assignee).length },
        calendar: { availability: calendar.jobs.availability, total: jobs.length, active: jobs.filter((job) => !job.status || job.status === 'active').length, paused: jobs.filter((job) => job.status === 'paused').length, ...(upcoming ? { nextRun: upcoming } : {}) },
        activity: { availability: activity.sessions.availability, total: activity.sessions.data.length, ...(activity.sessions.data[0] ? { latest: activity.sessions.data[0] } : {}) },
        knowledge: { availability: knowledge.skills.availability, total: knowledge.skills.data.length, byCategory },
        channels: { availability: channels.channels.availability, total: channels.channels.data.length, connected: channels.channels.data.filter((channel) => channel.status === 'Connected').length, ...(channels.activeSessions !== undefined ? { activeSessions: channels.activeSessions } : {}) },
        office: office.summary,
        commands,
        fetchedAt: new Date().toISOString(),
    };
}
// ---------------------------------------------------------------------------
// Cached accessors. Concurrent callers share one in-flight read per source.
function cachedSource(collect, ttl = CACHE_MS) {
    let entry;
    let inflight;
    const get = (now = Date.now()) => {
        if (entry && entry.expires > now)
            return Promise.resolve(entry.value);
        inflight ??= collect().then((value) => {
            entry = { value, expires: Date.now() + ttl };
            return value;
        }).finally(() => { inflight = undefined; });
        return inflight;
    };
    return Object.assign(get, { clear: () => { entry = undefined; } });
}
const runtimeSource = cachedSource(() => collectSnapshot());
const taskBoardSource = cachedSource(() => collectTaskBoard());
const calendarSource = cachedSource(() => collectCalendar());
const activitySource = cachedSource(() => collectActivity());
const knowledgeSource = cachedSource(() => collectKnowledge());
const channelSource = cachedSource(() => collectChannels());
const usageSources = new Map(USAGE_PERIODS.map((days) => [days, cachedSource(async () => collectUsage(days, (await getSnapshot()).profiles.data.map((profile) => profile.name)), INSIGHTS_CACHE_MS)]));
/** Token usage of every agent over 1, 7 or 30 days (anything else reads as 7). */
export function getUsage(days, now = Date.now()) {
    return (usageSources.get(days) ?? usageSources.get(INSIGHT_DAYS))(now);
}
const logsSource = cachedSource(() => collectLogs(), 5_000);
const agentActivitySource = cachedSource(async () => {
    const runtime = await getSnapshot();
    return collectAgentActivity(runtime.profiles.availability === 'available' ? runtime.profiles.data.map((profile) => profile.name) : []);
}, 15_000);
export function getSnapshot(now = Date.now()) { return runtimeSource(now); }
export function clearSnapshotCache() { runtimeSource.clear(); }
export function getTaskBoard(now = Date.now()) { return taskBoardSource(now); }
export function getCalendar(now = Date.now()) { return calendarSource(now); }
export function getActivity(now = Date.now()) { return activitySource(now); }
export function getKnowledge(now = Date.now()) { return knowledgeSource(now); }
export function getChannels(now = Date.now()) { return channelSource(now); }
export function getLogs(now = Date.now()) { return logsSource(now); }
/** Detail for a task on the current board; returns undefined for ids Hermes did not list. */
/** Details of a task on the current board snapshot; `board` picks the board it lives on. */
export async function getTaskDetail(id, now = Date.now(), board) {
    if (!TASK_ID.test(id) || (board !== undefined && !BOARD_SLUG.test(board)))
        return undefined;
    const snapshot = await getTaskBoard(now);
    if (snapshot.tasks.availability === 'available' && !snapshot.tasks.data.some((task) => task.id === id && task.board === board))
        return undefined;
    return collectTaskDetail(id, systemRun, board);
}
export async function getOffice(now = Date.now()) {
    const [runtime, board, activity, agentActivity] = await Promise.all([getSnapshot(now), getTaskBoard(now), getActivity(now), agentActivitySource(now)]);
    return buildOfficeSnapshot(runtime, board, activity, { agentActivity });
}
export async function getDashboard(now = Date.now()) {
    const [runtime, board, calendar, activity, knowledge, channels, agentActivity] = await Promise.all([getSnapshot(now), getTaskBoard(now), getCalendar(now), getActivity(now), getKnowledge(now), getChannels(now), agentActivitySource(now)]);
    const office = buildOfficeSnapshot(runtime, board, activity, { agentActivity });
    return buildDashboard({ runtime, board, calendar, activity, knowledge, channels, office, commands: commandHealth() });
}
