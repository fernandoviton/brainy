#!/usr/bin/env node
/**
 * Brainy CLI — unified interface for both file and Supabase backends.
 * Run with "help" or "<resource> help" for usage details.
 */
const fs = require('fs');
const path = require('path');
const { getStorage } = require('./storage');
const captureService = require('./capture-service');

const HELP = {
  main: `Usage: node backend/cli.js <resource> [action] [options]

Resources:
  todo                 Manage TODOs (CRUD, archive, collateral)
  capture              Manage captures (list, get, media, process, delete)
  knowledge            Manage knowledge entries (list, get, upsert)
  check-integrity      Run data integrity checks
  promote-scheduled    Promote scheduled TODOs whose date has arrived
  backup               Export the whole store to a local folder [--target <p>] [--force] [--config <p>]

Run "node backend/cli.js <resource> help" for details on each resource.
All commands support --format json|text (text is the default human output).

Flags are validated: an unknown, misspelled, or single-dash flag (e.g. --priorty,
-status) exits 1 with an error instead of being silently ignored. So does a flag
that needs a value but was given none (--status at the end of the line), a
boolean flag given a value (--all x), an unsupported --format value, and any
extra positional argument the command cannot use (todo update my-task active).`,

  todo: `Usage: node backend/cli.js todo <action> [options]

Actions:
  list [--status <status>] [--all]                 List active TODOs (default); --all for all statuses, --status to filter
  get <name>                                       Get full TODO details (notes, collateral)
  create --name <n> --summary <s> [--status <s>]   Create a new TODO
           [--priority <p>] [--category <c>]
           [--due <date>] [--scheduled-date <date>]
           [--blocked-by <name>]
           [--field notes --file <path>]            Set notes from a UTF-8 file (preferred; encoding-safe)
           [--field notes --stdin]                  Pipe notes via stdin (guarded against '?' corruption)
  update <name> [--summary <s>] [--status <s>]     Update TODO fields (at least one field flag required)
           [--priority <p>] [--category <c>]
           [--due <d>] [--scheduled-date <d>]
           [--blocked-by <name>]
           [--field notes --file <path>]            Set notes from a UTF-8 file (preferred; encoding-safe)
           [--field notes --stdin]                  Pipe notes via stdin (guarded against '?' corruption)
           [--field notes --clear]                  Blank the notes deliberately (empty content is otherwise an error)
  delete <name>                                    Delete a TODO
  archive <name> --summary-text <t>                Archive a completed TODO (summary is required —
           [--completion-date <d>]                  it is the only thing that survives archiving)
  collateral list <name>                           List collateral files
  collateral add <name> <filepath> [--replace]    Attach a file (--replace to overwrite existing)
  collateral remove <name> <filename>              Remove an attachment
  collateral get <name> <filename>                 Get collateral content

Statuses: inbox, active, later, scheduled
Priorities: P0 (urgent), P1 (high), P2 (medium), P3 (low)`,

  capture: `Usage: node backend/cli.js capture <action> [options]

Actions:
  list [--all]          List unprocessed captures (--all includes processed)
  get <id>              Get capture details including media
  media <capture_id>    Get signed download URLs for media (1hr expiry)
  process <id>          Mark a capture as processed
  delete <id>           Delete a capture (processed or unprocessed) and its media`,

  knowledge: `Usage: node backend/cli.js knowledge <action> [options]

Actions:
  list [--prefix <path>]       List knowledge entries, optionally filtered by path prefix
  get <path>                   Get knowledge content
  upsert <path> --file <path>  Create or update knowledge from a UTF-8 file (preferred; encoding-safe)
  upsert <path> --stdin        Create or update knowledge via stdin (guarded against '?' corruption)
           [--topic <t>] [--summary <s>]

upsert REQUIRES exactly one content source (--file or --stdin), and that source must
carry non-empty content: upsert replaces the whole body, so an empty (or missing)
content source would blank an existing entry.`,
};

function showHelp(resource) {
  console.log(HELP[resource] || HELP.main);
}

function parseArgs(argv) {
  const args = {};
  // camelCase key -> the flag exactly as the user typed it, so validation can
  // echo back `--scheduled-date` rather than the internal `scheduledDate`.
  const rawFlags = {};
  const positional = [];
  let i = 0;
  while (i < argv.length) {
    if (argv[i] === '-h') {
      args.help = true;
      rawFlags.help = '-h';
      i += 1;
    } else if (argv[i].startsWith('--')) {
      // Both `--flag value` and `--flag=value` are accepted. Split on the FIRST
      // '=' only, so `--summary=a=b` keeps the value `a=b`.
      const raw = argv[i];
      const eq = raw.indexOf('=');
      const flag = eq === -1 ? raw : raw.slice(0, eq);
      const inlineValue = eq === -1 ? undefined : raw.slice(eq + 1);
      const key = flag.replace(/^--/, '').replace(/-([a-z])/g, (_, c) => c.toUpperCase());
      rawFlags[key] = flag;
      if (inlineValue !== undefined) {
        args[key] = inlineValue;
        i += 1;
      } else if (i + 1 < argv.length && !argv[i + 1].startsWith('--')) {
        args[key] = argv[i + 1];
        i += 2;
      } else {
        args[key] = true;
        i += 1;
      }
    } else {
      positional.push(argv[i]);
      i += 1;
    }
  }
  return { args, positional, rawFlags };
}

const KNOWN_RESOURCES = ['todo', 'capture', 'knowledge'];

// Flags accepted by every command. `--format` selects output shape; `--help`/`-h`
// short-circuits to usage text before anything else runs.
const GLOBAL_FLAGS = ['format', 'help'];

// Flags that carry notes content into a todo (create and update use the same
// readContentInput path, so the encoding handling and '?'-corruption guard behave
// identically on both). `--clear` is update-only: there is nothing to clear on a
// todo that does not exist yet.
const NOTES_FLAGS = ['field', 'file', 'stdin'];

// Flags on `todo update` that actually change something. A bare
// `todo update <name>` has nothing to write, so reporting "Updated:" for it is a
// false success (and a pointless network round trip).
const UPDATE_FIELD_FLAGS = [
  'summary', 'status', 'priority', 'category', 'due', 'scheduledDate', 'blockedBy',
  'field', 'file', 'stdin', 'clear',
];

// Every command's contract, keyed by resource then by action ('' for resources
// that take no action):
//   flags          — the flags it legitimately accepts, as the camelCase keys
//                    parseArgs produces. Anything not listed (a typo like
//                    --priorty, or a flag the command would simply ignore) is
//                    rejected rather than silently discarded.
//   maxPositional  — how many positional words the whole invocation can consume,
//                    INCLUDING the resource and action. Anything beyond that is
//                    an argument the command cannot use, and is reported for the
//                    same reason an unknown flag is: `todo update my-task active`
//                    (a forgotten --status) used to print "Updated:" and change
//                    nothing.
//   usage          — the one-line shape quoted back in error messages.
const FLAG_SPEC = {
  todo: {
    list: { flags: ['status', 'all'], maxPositional: 2, usage: 'todo list [--status <status>] [--all]' },
    get: { flags: ['name'], maxPositional: 3, usage: 'todo get <name>' },
    create: {
      flags: ['name', 'summary', 'status', 'priority', 'category', 'due', 'scheduledDate', 'blockedBy', ...NOTES_FLAGS],
      maxPositional: 2,
      usage: 'todo create --name <name> --summary <summary> [options]',
    },
    update: {
      flags: ['name', 'summary', 'status', 'priority', 'category', 'due', 'scheduledDate', 'blockedBy', ...NOTES_FLAGS, 'clear'],
      maxPositional: 3,
      usage: 'todo update <name> --<field> <value> [...]',
    },
    delete: { flags: ['name'], maxPositional: 3, usage: 'todo delete <name>' },
    archive: {
      flags: ['name', 'summaryText', 'completionDate'],
      maxPositional: 3,
      usage: 'todo archive <name> --summary-text "<text>" [--completion-date <YYYY-MM-DD>]',
    },
    'collateral list': { flags: [], maxPositional: 4, usage: 'todo collateral list <name>' },
    'collateral add': { flags: ['replace'], maxPositional: 5, usage: 'todo collateral add <name> <filepath> [--replace]' },
    'collateral remove': { flags: [], maxPositional: 5, usage: 'todo collateral remove <name> <filename>' },
    'collateral get': { flags: [], maxPositional: 5, usage: 'todo collateral get <name> <filename>' },
  },
  capture: {
    list: { flags: ['all'], maxPositional: 2, usage: 'capture list [--all]' },
    get: { flags: [], maxPositional: 3, usage: 'capture get <id>' },
    media: { flags: [], maxPositional: 3, usage: 'capture media <capture_id>' },
    process: { flags: [], maxPositional: 3, usage: 'capture process <id>' },
    delete: { flags: [], maxPositional: 3, usage: 'capture delete <id>' },
  },
  knowledge: {
    list: { flags: ['prefix'], maxPositional: 2, usage: 'knowledge list [--prefix <path>]' },
    get: { flags: ['path'], maxPositional: 3, usage: 'knowledge get <path>' },
    upsert: {
      flags: ['path', 'topic', 'summary', 'file', 'stdin'],
      maxPositional: 3,
      usage: 'knowledge upsert <path> --file <path> | --stdin',
    },
  },
  'check-integrity': { '': { flags: [], maxPositional: 1, usage: 'check-integrity' } },
  'promote-scheduled': { '': { flags: [], maxPositional: 1, usage: 'promote-scheduled' } },
  backup: { '': { flags: ['target', 'config', 'force'], maxPositional: 1, usage: 'backup [--target <path>] [--force] [--config <path>]' } },
};

// Arity of every flag the CLI knows, so a missing or surplus value is caught by
// one general mechanism instead of a per-flag special case. (`--file`/`--stdin`
// used to have their own guard; it lives here now.)
//
//   boolean   — present or absent; giving it a value means a positional was
//               swallowed (`--stdin a/b.md` loses the path).
//   value     — needs a non-empty value; without one parseArgs yields boolean
//               `true`, which used to reach storage as the field's new value
//               (`todo update a --status` wrote status: true).
//   clearable — needs a value token, but an empty one is meaningful: the CLI
//               maps `--due ""` to null to clear the field. (Notes are NOT
//               clearable this way — see `--clear`, which is explicit because
//               blanking a body is destructive.)
//
// Every flag named in FLAG_SPEC (plus the globals) must appear here; the CLI
// test suite asserts the two tables stay in sync.
const FLAG_ARITY = {
  // boolean
  all: 'boolean',
  clear: 'boolean',
  force: 'boolean',
  help: 'boolean',
  replace: 'boolean',
  stdin: 'boolean',
  // value (non-empty required)
  category: 'value',
  completionDate: 'value',
  config: 'value',
  field: 'value',
  file: 'value',
  format: 'value',
  name: 'value',
  path: 'value',
  prefix: 'value',
  priority: 'value',
  status: 'value',
  summaryText: 'value',
  target: 'value',
  topic: 'value',
  // clearable (empty value allowed, and means "clear this field")
  blockedBy: 'clearable',
  due: 'clearable',
  scheduledDate: 'clearable',
  summary: 'clearable',
};

// Example values quoted back when a flag is missing one.
const VALUE_HINTS = {
  file: 'tmp/content.md',
  format: 'json',
  status: 'active',
  priority: 'P1',
  name: 'my-task',
  field: 'notes',
  due: '2026-01-01',
  scheduledDate: '2026-01-01',
  completionDate: '2026-01-01',
  path: 'category/topic.md',
  prefix: 'tools/',
};

// The accepted `--format` values. `text` is the explicit spelling of the default
// human output; anything else is a typo (`--format jsonn` silently printing the
// human table is the same class of bug as `--priorty`).
const FORMATS = ['json', 'text'];

function flagSpecFor(resource, action, rest) {
  const byAction = FLAG_SPEC[resource];
  if (!byAction) return null;
  // Action-less resources (check-integrity, promote-scheduled, backup) own their
  // single spec regardless of what follows: a word in the action slot is an
  // unexpected positional, not a different command.
  if (byAction['']) return byAction[''];
  const key = resource === 'todo' && action === 'collateral'
    ? `collateral ${rest[0] || ''}`
    : (action || '');
  return byAction[key] || null;
}

// The command name quoted in error messages.
function commandLabel(resource, action, rest) {
  const byAction = FLAG_SPEC[resource];
  if (byAction && byAction['']) return resource;
  if (resource === 'todo' && action === 'collateral') {
    return ['todo', 'collateral', rest[0]].filter(Boolean).join(' ');
  }
  return [resource, action].filter(Boolean).join(' ');
}

function helpPointer(resource) {
  const helpTarget = KNOWN_RESOURCES.includes(resource) ? `${resource} help` : 'help';
  return `Run "node backend/cli.js ${helpTarget}" for the supported options.`;
}

// Reject unknown/unsupported flags instead of dropping them on the floor. Runs
// after the --help short-circuit and before any storage call. An unrecognised
// resource/action has no spec — those are left to the dispatcher's own "Unknown
// <x> action" error so the more useful message wins.
function validateFlags(spec, resource, command, args, rawFlags) {
  const permitted = new Set([...spec.flags, ...GLOBAL_FLAGS]);
  const offenders = Object.keys(args)
    .filter((key) => !permitted.has(key))
    .map((key) => rawFlags[key] || `--${key}`);
  if (!offenders.length) return;

  console.error(
    `Unknown or unsupported flag for '${command}': ${offenders.join(', ')}\n` +
    `${helpPointer(resource)}`,
  );
  process.exit(1);
}

// parseArgs turns a valueless flag into boolean `true`, so `--status` at the end
// of the line used to be handed to storage as the field's new value, and `--file`
// reached fs.readFileSync as a boolean. The mirror image is a boolean flag given
// a value, which means a positional was swallowed.
function validateFlagArity(resource, command, args, rawFlags) {
  const problems = [];
  for (const [key, value] of Object.entries(args)) {
    const arity = FLAG_ARITY[key];
    if (!arity) continue; // unknown flags are validateFlags' business
    const flag = rawFlags[key] || `--${key}`;
    if (arity === 'boolean') {
      if (value !== true) {
        const extra = key === 'stdin'
          ? ' — pipe the content in instead, or use --file <path>'
          : '';
        problems.push(
          `${flag} takes no value (got ${flag} ${value})${extra}. ` +
          `If "${value}" was meant as a positional argument, move it before the flag.`,
        );
      }
    } else if (value === true) {
      const hint = VALUE_HINTS[key] ? ` (e.g. ${flag} ${VALUE_HINTS[key]})` : '';
      problems.push(`${flag} requires a value${hint}`);
    } else if (arity === 'value' && value === '') {
      problems.push(`${flag} requires a non-empty value`);
    }
  }
  if (!problems.length) return;
  console.error(
    `Invalid flag usage for '${command}':\n` +
    problems.map((p) => `  - ${p}`).join('\n') + '\n' +
    `${helpPointer(resource)}`,
  );
  process.exit(1);
}

// An argument the command cannot consume is reported for the same reason an
// unknown flag is: `todo update my-task active` (a forgotten --status) used to
// print "Updated:" and change nothing, and `todo list inbox` silently listed
// active todos.
function validatePositionals(spec, resource, command, positional) {
  if (positional.length <= spec.maxPositional) return;
  const extra = positional.slice(spec.maxPositional);
  console.error(
    `Unexpected argument${extra.length > 1 ? 's' : ''} for '${command}': ${extra.join(', ')}\n` +
    `Usage: ${spec.usage}\n` +
    `Did you mean to pass a flag (e.g. --status ${extra[0]})? Positional arguments are not ` +
    `shorthand for flags.\n` +
    `${helpPointer(resource)}`,
  );
  process.exit(1);
}

function validateFormat(resource, command, args) {
  if (args.format === undefined || FORMATS.includes(args.format)) return;
  console.error(
    `${command}: unsupported --format value "${args.format}" — expected one of: ${FORMATS.join(', ')} ` +
    `(text is the default human output).\n` +
    `${helpPointer(resource)}`,
  );
  process.exit(1);
}

// A single-dash flag (`-status active`) does not match the `--` branch of
// parseArgs, so it lands in `positional` where validateFlags never sees it — and
// the command then runs with the flag silently dropped (`todo update x -status
// active` printed "Updated" and changed nothing). Catch it here instead.
//
// Safe against real positionals: everything that legitimately lands in
// `positional` is a resource, an action/sub-action, a kebab-case TODO name, a
// capture UUID (or its hex prefix), a `category/topic.md` knowledge path, or a
// collateral filename/filepath. None of those begin with a dash, and the pattern
// requires a LETTER right after the dash, so `-5`, `--`, `-.`, `./x`, `C:\x` and
// every dash-containing-but-not-dash-leading name (`build-auth-system`,
// `tools/claude-code/hooks.yml`, `design-notes-v2.md`) are untouched. A file
// literally named `-foo.md` is the one theoretical collision; pass it as
// `./-foo.md`.
const SHORT_FLAG_RE = /^-[a-zA-Z]/;

function assertNoShortFlags(positional) {
  const offenders = positional.filter((arg) => arg !== '-h' && SHORT_FLAG_RE.test(arg));
  if (!offenders.length) return;
  const fixes = offenders.map((o) => `-${o}`).join(', ');
  console.error(
    `Single-dash flags are not supported: ${offenders.join(', ')}\n` +
    `Use the double-dash form instead (${fixes}). A single dash parses as a positional ` +
    `argument, so the flag would be silently ignored.\n` +
    `Run "node backend/cli.js help" for the supported options.`,
  );
  process.exit(1);
}

// Exactly one content source. `--file` and `--stdin` together used to pick a
// silent winner (--file), so the other body was discarded without a word;
// `--clear` conflicts with both because it means "write nothing at all".
function assertSingleContentSource(args, command) {
  const given = [];
  if (args.file !== undefined) given.push('--file');
  if (args.stdin !== undefined) given.push('--stdin');
  if (args.clear !== undefined) given.push('--clear');
  if (given.length <= 1) return;
  console.error(
    `${command}: ${given.join(' and ')} are mutually exclusive — pass exactly one content source.\n` +
    `Only one body can be written, so accepting both would silently discard the other.`,
  );
  process.exit(1);
}

// `knowledge upsert` writes `content` into the row unconditionally, so an
// invocation with no content source would overwrite a live entry's entire body
// with an empty string and still report success. Require an explicit source.
// (There is deliberately no `--clear` here: blanking a knowledge body destroys
// the whole record, which is a delete, not an edit.)
function assertKnowledgeContentFlags(args, command) {
  if (args.file === undefined && args.stdin === undefined) {
    console.error(
      `${command}: content is required — pass --file <path> (preferred; encoding-safe) or --stdin.\n` +
      `Upserting with no content source would replace the entry's existing body with an empty string.`,
    );
    process.exit(1);
  }
  assertSingleContentSource(args, command);
}

// --field/--file/--stdin/--clear only mean anything as the trio
// "--field notes --file|--stdin|--clear". A half-specified trio used to be
// dropped silently, losing the content.
function assertNotesFlags(args, command, { allowClear } = {}) {
  const sources = allowClear ? '--file <path>, --stdin, or --clear' : '--file <path> or --stdin';
  const settersGiven = args.file !== undefined || args.stdin !== undefined
    || (allowClear && args.clear !== undefined);
  if (args.field === undefined && !settersGiven) return;
  if (args.field !== 'notes') {
    const got = args.field && args.field !== true ? ` (got --field ${args.field})` : '';
    const names = allowClear ? '--file/--stdin/--clear' : '--file/--stdin';
    console.error(`${command}: ${names} set notes content and require "--field notes"${got}`);
    process.exit(1);
  }
  if (!settersGiven) {
    console.error(`${command}: --field notes requires ${sources}`);
    process.exit(1);
  }
  assertSingleContentSource(args, command);
}

// cp1252 0x80-0x9F → Unicode (rest of the range is identical to ISO-8859-1).
const CP1252_C1 = {
  0x80: 0x20AC, 0x82: 0x201A, 0x83: 0x0192, 0x84: 0x201E, 0x85: 0x2026,
  0x86: 0x2020, 0x87: 0x2021, 0x88: 0x02C6, 0x89: 0x2030, 0x8A: 0x0160,
  0x8B: 0x2039, 0x8C: 0x0152, 0x8E: 0x017D,
  0x91: 0x2018, 0x92: 0x2019, 0x93: 0x201C, 0x94: 0x201D, 0x95: 0x2022,
  0x96: 0x2013, 0x97: 0x2014, 0x98: 0x02DC, 0x99: 0x2122, 0x9A: 0x0161,
  0x9B: 0x203A, 0x9C: 0x0153, 0x9E: 0x017E, 0x9F: 0x0178,
};

function decodeCp1252(buf) {
  let out = '';
  for (const b of buf) {
    out += String.fromCharCode(CP1252_C1[b] !== undefined ? CP1252_C1[b] : b);
  }
  return out;
}

function readStdin() {
  return new Promise((resolve) => {
    if (process.stdin.isTTY) {
      resolve('');
      return;
    }
    const chunks = [];
    process.stdin.on('data', (chunk) => {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    });
    process.stdin.on('end', () => {
      let buf = chunks.length === 1 ? chunks[0] : Buffer.concat(chunks);
      if (buf.length >= 3 && buf[0] === 0xEF && buf[1] === 0xBB && buf[2] === 0xBF) {
        buf = buf.subarray(3);
      }
      try {
        resolve(new TextDecoder('utf-8', { fatal: true }).decode(buf));
      } catch (_) {
        console.error(`[cli] stdin was not valid UTF-8; decoded as cp1252 (${buf.length} bytes)`);
        resolve(decodeCp1252(buf));
      }
    });
  });
}

// Signature of PowerShell's lossy console down-conversion: when [Console]::
// OutputEncoding is not UTF-8, non-ASCII chars (en-dash 23–25, em-dash, bullets
// ••••) are flattened to literal '?' (0x3F) BEFORE they reach the CLI, so the
// data is already destroyed — no decoder can recover it. We can only detect the
// telltale pattern and refuse to persist it. Matches digit?digit ranges, runs of
// '?', and space-?-space (flattened dashes); deliberately ignores a lone trailing
// '?' and URL query strings (a?b / p?q) to avoid false positives on real prose.
const ENCODING_CORRUPTION_RE = /\?{2,}|\d\s?\?\s?\d|\s\?\s/;

function detectEncodingCorruption(text) {
  return typeof text === 'string' && ENCODING_CORRUPTION_RE.test(text);
}

function stripBom(s) {
  return s.charCodeAt(0) === 0xFEFF ? s.slice(1) : s;
}

// Resolve text content for --stdin / --file inputs. --file is the encoding-safe
// path (fs read never touches the Windows console code page), so it is trusted as
// authored. --stdin is guarded: corrupted content is rejected, steering the
// author to re-write to a UTF-8 file and pass --file instead.
//
// Empty content is an error on every content command. The old guards asked
// whether a flag had been *typed*, not whether there was anything to write, so a
// truncated file or a `--stdin` typed at an interactive prompt blanked a live
// body and printed success. `clearHint` names the deliberate way to blank the
// field, where one exists.
async function readContentInput(args, label, command, clearHint) {
  // Arity validation already rejected a valueless --file, but re-check the type
  // so a boolean `true` can never reach fs.readFileSync.
  let content;
  if (typeof args.file === 'string' && args.file !== '') {
    try {
      content = stripBom(fs.readFileSync(args.file, 'utf8'));
    } catch (err) {
      console.error(
        `${command}: --file ${args.file} could not be read — ${err.message}\n` +
        `Check the path (it is resolved relative to the current directory).`,
      );
      process.exit(1);
    }
  } else {
    // readStdin() resolves '' on a TTY, so asking to read a pipe when none is
    // attached would otherwise look like "the user piped in nothing".
    if (process.stdin.isTTY) {
      console.error(
        `${command}: --stdin was given but nothing is piped in.\n` +
        `Pipe the content (e.g. type it into a file and use --file <path>, which is the ` +
        `encoding-safe path anyway).`,
      );
      process.exit(1);
    }
    content = await readStdin();
    if (detectEncodingCorruption(content)) {
      console.error(
        `[cli] Refusing to write ${label}: the piped content contains '?' runs that look like ` +
        `encoding corruption (e.g. an en-dash/bullet flattened to '?' by PowerShell's console ` +
        `encoder). The original characters are already lost in the pipe and cannot be recovered.\n` +
        `Fix: write the content to a UTF-8 file (e.g. under tmp/) and pass --file <path> instead of --stdin. ` +
        `If the '?' are genuinely intended, --file bypasses this check.`,
      );
      process.exit(1);
    }
  }
  if (content.trim() === '') {
    console.error(
      `${command}: refusing to write empty ${label} — the content source resolved to nothing.\n` +
      (clearHint
        ? `${clearHint}\n`
        : '') +
      `A blank body would replace whatever is stored today and still report success.`,
    );
    process.exit(1);
  }
  return content;
}

// Shared by `todo create` and `todo update` so both go through the identical
// UTF-8 handling and '?'-corruption guard. Returns undefined when the caller did
// not ask to set notes at all (so create/update can leave the field alone), and
// null for an explicit `--clear`.
async function readNotesInput(args, command) {
  if (args.clear) return null;
  if (args.field === 'notes' && (args.stdin !== undefined || args.file !== undefined)) {
    return readContentInput(
      args,
      'notes',
      command,
      'To blank the notes deliberately, use: todo update <name> --field notes --clear',
    );
  }
  return undefined;
}

function output(data, format) {
  if (format === 'json') {
    console.log(JSON.stringify(data, null, 2));
  } else if (Array.isArray(data)) {
    for (const item of data) {
      if (item.name && item.summary) {
        console.log(`- **${item.name}** — ${item.summary} [${item.status}] ${item.priority || ''}`);
      } else if (item.id && item.text !== undefined) {
        const short = item.id.substring(0, 8);
        const text = (item.text || '').length > 80 ? item.text.substring(0, 80) + '...' : (item.text || '(empty)');
        const status = item.processed_at ? 'processed' : 'unprocessed';
        const mediaCount = item.media?.length ? ` [${item.media.length} file${item.media.length !== 1 ? 's' : ''}]` : '';
        console.log(`- [${short}] ${text} [${status}]${mediaCount} ${item.created_at}`);
      } else if (item.path) {
        console.log(`  ${item.path}`);
      } else {
        console.log(JSON.stringify(item));
      }
    }
  } else if (data && typeof data === 'object') {
    if (data.name && data.notes !== undefined) {
      // Full TODO view
      console.log(`# ${data.name}`);
      console.log(`Status: ${data.status} | Priority: ${data.priority} | Category: ${data.category}`);
      if (data.due) console.log(`Due: ${data.due}`);
      if (data.scheduled_date) console.log(`Scheduled: ${data.scheduled_date}`);
      if (data.blocked_by?.length) console.log(`Blocked by: ${data.blocked_by.join(', ')}`);
      if (data.collateral?.length) {
        const names = data.collateral.map((c) => typeof c === 'string' ? c : c.filename);
        console.log(`Collateral: ${names.join(', ')}`);
      }
      if (data.notes) console.log(`\n${data.notes}`);
    } else if (data.id && data.text !== undefined) {
      // Capture detail view
      console.log(`ID: ${data.id}`);
      console.log(`Text: ${data.text || '(empty)'}`);
      console.log(`Status: ${data.processed_at ? 'processed' : 'unprocessed'}`);
      if (data.processed_at) console.log(`Processed at: ${data.processed_at}`);
      console.log(`Created: ${data.created_at}`);
      if (data.media?.length) {
        console.log(`Media: ${data.media.map((m) => m.filename).join(', ')}`);
      }
    } else if (data.content !== undefined) {
      // Knowledge view
      console.log(data.content);
    } else {
      console.log(JSON.stringify(data, null, 2));
    }
  } else {
    console.log(data);
  }
}

async function main() {
  const { args, positional, rawFlags } = parseArgs(process.argv.slice(2));
  const [resource, action, ...rest] = positional;
  const storage = getStorage();
  const format = args.format;

  // Help short-circuit: a `--help`/`-h` flag anywhere, an explicit `help`
  // action, or a missing resource shows the relevant help and exits 0 BEFORE
  // any storage/network call — so e.g. `todo create --help` never mutates data.
  try {
    if (!resource || resource === 'help') {
      showHelp('main');
      return;
    }
    if (args.help) {
      showHelp(KNOWN_RESOURCES.includes(resource) ? resource : 'main');
      return;
    }

    assertNoShortFlags(positional);
    const spec = flagSpecFor(resource, action, rest);
    const command = commandLabel(resource, action, rest);
    // No spec means an unrecognised resource/action: leave it to the
    // dispatcher's own "Unknown <x> action" error, which is the more useful one.
    if (spec) {
      validateFlags(spec, resource, command, args, rawFlags);
      validateFlagArity(resource, command, args, rawFlags);
      validatePositionals(spec, resource, command, positional);
      validateFormat(resource, command, args);
    }

    if (resource === 'todo') {
      if (!action || action === 'help') { showHelp('todo'); return; }
      if (action === 'list') {
        const status = args.status || (args.all ? undefined : 'active');
        const result = await storage.listTodos(status);
        output(result, format);
      } else if (action === 'get') {
        const name = rest[0] || args.name;
        if (!name) { console.error('Usage: todo get <name>'); process.exit(1); }
        const result = await storage.getTodo(name);
        if (!result) { console.error(`TODO '${name}' not found`); process.exit(1); }
        output(result, format);
      } else if (action === 'create') {
        if (!args.name) {
          console.error('Usage: todo create --name <name> --summary <summary> [options]');
          process.exit(1);
        }
        assertNotesFlags(args, 'todo create');
        const result = await storage.createTodo({
          name: args.name,
          summary: args.summary || '',
          status: args.status,
          priority: args.priority,
          category: args.category,
          due: args.due,
          scheduled_date: args.scheduledDate,
          blocked_by: args.blockedBy,
          notes: await readNotesInput(args, 'todo create'),
        });
        if (format === 'json') {
          output(result, format);
        } else {
          console.log(`Created: ${result.name} [${result.status}]`);
        }
      } else if (action === 'update') {
        const name = rest[0] || args.name;
        if (!name) { console.error('Usage: todo update <name> --<field> <value> [...]'); process.exit(1); }
        if (!UPDATE_FIELD_FLAGS.some((f) => args[f] !== undefined)) {
          console.error(
            `Usage: todo update <name> --<field> <value> [...]\n` +
            `Nothing to update: no field flag was given, so this would be a no-op write ` +
            `reported as success. Pass at least one of ` +
            `--summary/--status/--priority/--category/--due/--scheduled-date/--blocked-by, ` +
            `or --field notes with --file/--stdin/--clear.`,
          );
          process.exit(1);
        }
        assertNotesFlags(args, 'todo update', { allowClear: true });
        const changes = {};
        if (args.summary !== undefined) changes.summary = args.summary;
        if (args.status) changes.status = args.status;
        if (args.priority) changes.priority = args.priority;
        if (args.category) changes.category = args.category;
        if (args.due !== undefined) changes.due = args.due || null;
        if (args.scheduledDate !== undefined) changes.scheduled_date = args.scheduledDate || null;
        if (args.blockedBy !== undefined) changes.blocked_by = args.blockedBy || null;
        const notes = await readNotesInput(args, 'todo update');
        if (notes !== undefined) changes.notes = notes;
        const result = await storage.updateTodo(name, changes);
        console.log(`Updated: ${result.name} [${result.status}]`);
      } else if (action === 'delete') {
        const name = rest[0] || args.name;
        if (!name) { console.error('Usage: todo delete <name>'); process.exit(1); }
        await storage.deleteTodo(name);
        console.log(`Deleted: ${name}`);
      } else if (action === 'collateral') {
        const [subAction, ...subRest] = rest;
        if (subAction === 'list') {
          const name = subRest[0];
          if (!name) { console.error('Usage: todo collateral list <name>'); process.exit(1); }
          const result = await storage.listCollateral(name);
          if (format === 'json') {
            output(result, format);
          } else {
            for (const c of result) {
              console.log(`- ${c.filename} (${c.content_type}) [${c.is_text ? 'text' : 'binary'}]`);
            }
          }
        } else if (subAction === 'add') {
          const name = subRest[0];
          const filepath = subRest[1];
          if (!name || !filepath) { console.error('Usage: todo collateral add <name> <filepath> [--replace]'); process.exit(1); }
          const result = await storage.addCollateral(name, filepath, { replace: !!args.replace });
          const verb = result.replaced ? 'Replaced' : 'Added';
          console.log(`${verb}: ${result.filename} (${result.content_type}) [${result.is_text ? 'text' : 'binary'}]`);
        } else if (subAction === 'remove') {
          const name = subRest[0];
          const filename = subRest[1];
          if (!name || !filename) { console.error('Usage: todo collateral remove <name> <filename>'); process.exit(1); }
          const result = await storage.removeCollateral(name, filename);
          console.log(`Removed: ${result.filename}`);
        } else if (subAction === 'get') {
          const name = subRest[0];
          const filename = subRest[1];
          if (!name || !filename) { console.error('Usage: todo collateral get <name> <filename>'); process.exit(1); }
          const result = await storage.getCollateral(name, filename);
          if (format === 'json') {
            output(result, format);
          } else if (result.text_content !== undefined) {
            console.log(result.text_content);
          } else {
            console.log(`${result.filename} (${result.content_type}): ${result.url}`);
          }
        } else {
          console.error(`Unknown collateral action: ${subAction}`);
          process.exit(1);
        }
      } else if (action === 'archive') {
        const name = rest[0] || args.name;
        if (!name) { console.error('Usage: todo archive <name> --summary-text "<text>"'); process.exit(1); }
        // Archiving deletes the todo row and keeps only the summary, so an
        // archive with no summary throws away everything the record was worth.
        if (!args.summaryText) {
          console.error(
            `Usage: todo archive <name> --summary-text "<text>" [--completion-date <YYYY-MM-DD>]\n` +
            `--summary-text is required: archiving removes the TODO and keeps only this summary.`,
          );
          process.exit(1);
        }
        const result = await storage.archiveTodo(name, {
          summaryText: args.summaryText,
          completionDate: args.completionDate,
        });
        console.log(`Archived: ${result.name} -> ${result.year_month}`);
      } else {
        console.error(`Unknown todo action: ${action}\n`);
        showHelp('todo');
        process.exit(1);
      }
    } else if (resource === 'capture') {
      if (!action || action === 'help') { showHelp('capture'); return; }
      if (action === 'list') {
        const all = args.all || undefined;
        const result = await captureService.listCapturesWithMedia(all);
        output(result, format);
      } else if (action === 'get') {
        const id = rest[0];
        if (!id) { console.error('Usage: capture get <id>'); process.exit(1); }
        const result = await captureService.getCapture(id);
        if (!result) { console.error(`Capture '${id}' not found`); process.exit(1); }
        output(result, format);
      } else if (action === 'media') {
        const id = rest[0];
        if (!id) { console.error('Usage: capture media <capture_id>'); process.exit(1); }
        const result = await captureService.getCaptureMediaUrls(id);
        if (result === null) { console.error(`Capture '${id}' not found`); process.exit(1); }
        if (!result.length) { console.log('No media attached to this capture.'); return; }
        if (format === 'json') {
          console.log(JSON.stringify(result, null, 2));
        } else {
          for (const m of result) {
            console.log(`${m.filename} (${m.content_type}): ${m.url}`);
          }
        }
      } else if (action === 'process') {
        const id = rest[0];
        if (!id) { console.error('Usage: capture process <id>'); process.exit(1); }
        const result = await captureService.processCapture(id);
        if (format === 'json') {
          output(result, format);
        } else {
          console.log(`Processed: ${result.id}`);
        }
      } else if (action === 'delete') {
        const id = rest[0];
        if (!id) { console.error('Usage: capture delete <id>'); process.exit(1); }
        const result = await captureService.deleteCapture(id);
        if (result === null) { console.error(`Capture '${id}' not found`); process.exit(1); }
        console.log(`Deleted: ${result.id}`);
      } else {
        console.error(`Unknown capture action: ${action}\n`);
        showHelp('capture');
        process.exit(1);
      }
    } else if (resource === 'knowledge') {
      if (!action || action === 'help') { showHelp('knowledge'); return; }
      if (action === 'list') {
        const result = await storage.listKnowledge(args.prefix || undefined);
        output(result, format);
      } else if (action === 'get') {
        const kPath = rest[0] || args.path;
        if (!kPath) { console.error('Usage: knowledge get <path>'); process.exit(1); }
        const result = await storage.getKnowledge(kPath);
        if (!result) { console.error(`Knowledge '${kPath}' not found`); process.exit(1); }
        output(result, format);
      } else if (action === 'upsert') {
        const upsertPath = rest[0] || args.path;
        if (!upsertPath) { console.error('Usage: knowledge upsert <path> --file <path> | --stdin'); process.exit(1); }
        assertKnowledgeContentFlags(args, 'knowledge upsert');
        const content = await readContentInput(args, 'knowledge content', 'knowledge upsert');
        const result = await storage.upsertKnowledge({
          path: upsertPath,
          content,
          topic: args.topic,
          summary: args.summary,
        });
        console.log(`Upserted: ${result.path}`);
      } else {
        console.error(`Unknown knowledge action: ${action}\n`);
        showHelp('knowledge');
        process.exit(1);
      }
    } else if (resource === 'check-integrity') {
      const result = await storage.checkIntegrity();
      if (format === 'json') {
        // The whole result, so a caller can branch on `ok` and read the errors
        // rather than scrape a sentence.
        output(result, format);
        if (!result.ok) process.exit(2);
      } else if (result.ok) {
        console.log('Integrity check passed.');
      } else {
        console.log('Integrity check failed:');
        for (const err of result.errors) {
          console.log(`  - ${err}`);
        }
        process.exit(2);
      }
    } else if (resource === 'promote-scheduled') {
      const promoted = await storage.promoteScheduled();
      if (format === 'json') {
        // The names, not a sentence: a hook wants to act on what moved.
        output({ promoted, count: promoted.length }, format);
      } else if (promoted.length === 0) {
        console.log('No scheduled items to promote.');
      } else {
        console.log(`Promoted ${promoted.length} item(s): ${promoted.join(', ')}`);
      }
    } else if (resource === 'backup') {
      const { exportBackup, loadConfig, formatBackupResult } = require('./backup');
      const configPath = args.config || path.join(__dirname, '..', 'backup.config.json');
      const config = loadConfig(configPath);
      const targetPath = args.target || config.targetPath;
      if (!targetPath) {
        console.log(
          'Backup not configured — no target set. To enable local backups, copy ' +
          'backup.config.example.json to backup.config.json and set "targetPath" to an ' +
          'empty folder on a backed-up drive. See the "Backups" section in README.md.'
        );
        return;
      }
      const result = await exportBackup({
        storage,
        targetPath,
        minIntervalDays: config.minIntervalDays,
        force: !!args.force,
      });
      console.log(formatBackupResult(result));
    } else {
      console.error(`Unknown resource: ${resource}\n`);
      showHelp('main');
      process.exit(1);
    }
  } catch (err) {
    console.error(`Error: ${err.message}`);
    process.exit(1);
  }
}

module.exports = { main, detectEncodingCorruption, FLAG_SPEC, FLAG_ARITY, GLOBAL_FLAGS };
if (require.main === module) {
  main();
}
