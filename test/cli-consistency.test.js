// Cross-command consistency of the CLI's argument handling.
//
// The guards in cli.js were added piecemeal (unknown flags, single-dash flags,
// --file/--stdin, the knowledge-upsert content guard), each pass touching only
// the commands that prompted it. This file asserts the *rules* rather than the
// individual commands: whatever the rule is, it must hold for every resource,
// every action, and every utility. A command that behaves differently without a
// principled reason is the finding.
//
// Harness follows test/cli-flag-validation.test.js (runCLI + full mock roster)
// and test/cli-content-input.test.js (withStdin) per DEVELOPMENT.md.

const fs = require('fs');
const os = require('os');
const path = require('path');
const { Readable } = require('stream');

const mockStorage = {
  listCaptures: jest.fn(),
  resolveCaptureId: jest.fn(),
  getCapture: jest.fn(),
  processCapture: jest.fn(),
  downloadMedia: jest.fn(),
  uploadCaptureMedia: jest.fn(),
  listTodos: jest.fn(),
  getTodo: jest.fn(),
  createTodo: jest.fn(),
  updateTodo: jest.fn(),
  deleteTodo: jest.fn(),
  archiveTodo: jest.fn(),
  listKnowledge: jest.fn(),
  getKnowledge: jest.fn(),
  upsertKnowledge: jest.fn(),
  exportAll: jest.fn(),
  checkIntegrity: jest.fn(),
  promoteScheduled: jest.fn(),
  listCollateral: jest.fn(),
  addCollateral: jest.fn(),
  removeCollateral: jest.fn(),
  getCollateral: jest.fn(),
};

jest.mock('../backend/storage', () => ({
  getStorage: () => mockStorage,
}));

const mockCaptureService = {
  listCapturesWithMedia: jest.fn(),
  getCapture: jest.fn(),
  processCapture: jest.fn(),
  deleteCapture: jest.fn(),
  getCaptureMediaUrls: jest.fn(),
};

jest.mock('../backend/capture-service', () => mockCaptureService);

const { main } = require('../backend/cli.js');

function runCLI(args) {
  const origArgv = process.argv;
  const origExit = process.exit;
  const origLog = console.log;
  const origError = console.error;

  const output = [];
  const errors = [];
  let exitCode = 0;

  process.argv = ['node', 'backend/cli.js', ...args];
  console.log = (...a) => output.push(a.join(' '));
  console.error = (...a) => errors.push(a.join(' '));
  process.exit = (code) => {
    exitCode = code;
    throw new Error(`EXIT_${code}`);
  };

  return main()
    .catch(() => {})
    .then(() => {
      process.argv = origArgv;
      process.exit = origExit;
      console.log = origLog;
      console.error = origError;
      return { output: output.join('\n'), errors: errors.join('\n'), exitCode };
    });
}

// readStdin() resolves '' immediately when stdin is a TTY, so wrapping a run in
// this can never hang on a pipe Jest will not close.
async function withTtyStdin(fn) {
  const orig = process.stdin.isTTY;
  process.stdin.isTTY = true;
  try {
    return await fn();
  } finally {
    process.stdin.isTTY = orig;
  }
}

// A real (non-TTY) pipe carrying `text`, closed immediately.
function withStdin(text, fn) {
  const orig = Object.getOwnPropertyDescriptor(process, 'stdin');
  const mock = Readable.from([Buffer.from(text, 'utf8')]);
  mock.isTTY = false;
  Object.defineProperty(process, 'stdin', { value: mock, configurable: true });
  return Promise.resolve(fn()).finally(() => {
    Object.defineProperty(process, 'stdin', orig);
  });
}

const tmpFiles = [];
function tmpFile(content) {
  const p = path.join(os.tmpdir(), `brainy-consistency-${Date.now()}-${Math.random().toString(36).slice(2)}.md`);
  fs.writeFileSync(p, content);
  tmpFiles.push(p);
  return p;
}

afterAll(() => {
  for (const p of tmpFiles) {
    try { fs.unlinkSync(p); } catch (_) { /* ignore */ }
  }
});

// "A validation failure that still hits the network is a real defect." Rather
// than naming one mock per test, assert that NOTHING downstream was touched.
function expectNoBackendCalls() {
  const touched = [];
  for (const [name, fn] of Object.entries(mockStorage)) {
    if (fn.mock.calls.length > 0) touched.push(`storage.${name}`);
  }
  for (const [name, fn] of Object.entries(mockCaptureService)) {
    if (fn.mock.calls.length > 0) touched.push(`captureService.${name}`);
  }
  expect(touched).toEqual([]);
}

beforeEach(() => {
  jest.clearAllMocks();
  mockStorage.listTodos.mockResolvedValue([
    { name: 'a', summary: 's', status: 'active', priority: 'P1', category: 'c', created_date: '2026-01-01', due: null, scheduled_date: null, blocked_by: [] },
  ]);
  mockStorage.getTodo.mockResolvedValue({ name: 'a', summary: 's', status: 'active', notes: null, collateral: [] });
  mockStorage.createTodo.mockResolvedValue({ name: 'a', status: 'inbox' });
  mockStorage.updateTodo.mockResolvedValue({ name: 'a', status: 'active' });
  mockStorage.deleteTodo.mockResolvedValue({ name: 'a' });
  mockStorage.archiveTodo.mockResolvedValue({ name: 'a', year_month: '2026_01' });
  mockStorage.listCollateral.mockResolvedValue([{ filename: 'f.md', content_type: 'text/markdown', is_text: true }]);
  mockStorage.addCollateral.mockResolvedValue({ filename: 'f.md', content_type: 'text/markdown', is_text: true, replaced: false });
  mockStorage.removeCollateral.mockResolvedValue({ filename: 'f.md', removed: true });
  mockStorage.getCollateral.mockResolvedValue({ filename: 'f.md', content_type: 'text/markdown', text_content: 'x' });
  mockStorage.listKnowledge.mockResolvedValue([{ path: 'a.md', topic: 'A', summary: 's' }]);
  mockStorage.getKnowledge.mockResolvedValue({ path: 'a.md', topic: 'A', content: '# a', summary: 's' });
  mockStorage.upsertKnowledge.mockResolvedValue({ path: 'a.md', upserted: true });
  mockStorage.checkIntegrity.mockResolvedValue({ ok: true, issues: [] });
  mockStorage.promoteScheduled.mockResolvedValue([]);
  mockStorage.exportAll.mockResolvedValue({
    todos: [], collateral: [], knowledge: [], knowledgeAttachments: [],
    archiveEntries: [], archiveSummaries: [], captures: [], captureMedia: [],
  });

  mockCaptureService.listCapturesWithMedia.mockResolvedValue([
    { id: 'i', text: 't', processed_at: null, created_at: 'now', media: [] },
  ]);
  mockCaptureService.getCapture.mockResolvedValue({ id: 'i', text: 't', processed_at: null, created_at: 'now', media: [] });
  mockCaptureService.getCaptureMediaUrls.mockResolvedValue([
    { filename: 'photo.jpg', content_type: 'image/jpeg', url: 'https://example.com/p.jpg' },
  ]);
  mockCaptureService.processCapture.mockResolvedValue({ id: 'i' });
  mockCaptureService.deleteCapture.mockResolvedValue({ id: 'i' });
});

// Every (resource, action) pair the docs describe, with a minimal valid
// invocation. Table-driven so a new command cannot quietly skip a rule.
const ALL_COMMANDS = [
  ['todo list', ['todo', 'list']],
  ['todo get', ['todo', 'get', 'a']],
  ['todo create', ['todo', 'create', '--name', 'a', '--summary', 's']],
  ['todo update', ['todo', 'update', 'a', '--status', 'active']],
  ['todo delete', ['todo', 'delete', 'a']],
  ['todo archive', ['todo', 'archive', 'a', '--summary-text', 'done', '--completion-date', '2026-01-01']],
  ['todo collateral list', ['todo', 'collateral', 'list', 'a']],
  ['todo collateral add', ['todo', 'collateral', 'add', 'a', '/p/f.md']],
  ['todo collateral get', ['todo', 'collateral', 'get', 'a', 'f.md']],
  ['todo collateral remove', ['todo', 'collateral', 'remove', 'a', 'f.md']],
  ['capture list', ['capture', 'list']],
  ['capture get', ['capture', 'get', 'i']],
  ['capture media', ['capture', 'media', 'i']],
  ['capture process', ['capture', 'process', 'i']],
  ['capture delete', ['capture', 'delete', 'i']],
  ['knowledge list', ['knowledge', 'list']],
  ['knowledge get', ['knowledge', 'get', 'a.md']],
  ['check-integrity', ['check-integrity']],
  ['promote-scheduled', ['promote-scheduled']],
];

// knowledge upsert needs a content source, so it carries a --file everywhere.
function knowledgeUpsertArgs() {
  return ['knowledge', 'upsert', 'a.md', '--file', tmpFile('# body')];
}

// ---------------------------------------------------------------------------
// AXIS 1 — an unknown --flag is rejected identically on every command.
//
// README: "An unknown or misspelled flag ... exits 1 with an error naming the
// offending flag — it is never silently ignored." That promise is unqualified,
// so it must hold for utilities and sub-actions too, not just the resources
// someone happened to test.
// ---------------------------------------------------------------------------
describe('AXIS 1: unknown --flag rejected uniformly', () => {
  const cases = [...ALL_COMMANDS, ['knowledge upsert', null]];

  test.each(cases.map(([label]) => [label]))('`%s --zzz x` exits 1, names --zzz, and calls no backend', async (label) => {
    const base = label === 'knowledge upsert'
      ? knowledgeUpsertArgs()
      : ALL_COMMANDS.find(([l]) => l === label)[1];

    const { errors, exitCode } = await runCLI([...base, '--zzz', 'x']);

    expect(exitCode).toBe(1);
    expect(errors).toContain('--zzz');
    expectNoBackendCalls();
  });

  test('backup rejects an unknown flag without exporting', async () => {
    const { errors, exitCode } = await runCLI(['backup', '--zzz', 'x']);
    expect(exitCode).toBe(1);
    expect(errors).toContain('--zzz');
    expectNoBackendCalls();
  });
});

// ---------------------------------------------------------------------------
// AXIS 2 — single-dash flags rejected uniformly.
//
// `-status active` used to land in `positional` and print a false "Updated:".
// The fix must cover every command, including the ones with no action slot.
// ---------------------------------------------------------------------------
describe('AXIS 2: single-dash flags rejected uniformly', () => {
  test.each(ALL_COMMANDS.map(([label]) => [label]))('`%s -zzz` exits 1, names -zzz, and calls no backend', async (label) => {
    const base = ALL_COMMANDS.find(([l]) => l === label)[1];

    const { output, errors, exitCode } = await runCLI([...base, '-zzz']);

    expect(exitCode).toBe(1);
    expect(errors).toContain('-zzz');
    // No false success line.
    expect(output).not.toMatch(/^(Created|Updated|Deleted|Archived|Processed|Added|Removed|Replaced):/m);
    expectNoBackendCalls();
  });

  test('knowledge upsert -zzz is rejected before any write', async () => {
    const { errors, exitCode } = await runCLI([...knowledgeUpsertArgs(), '-zzz']);
    expect(exitCode).toBe(1);
    expect(errors).toContain('-zzz');
    expectNoBackendCalls();
  });
});

// ---------------------------------------------------------------------------
// AXIS 8 — one parseable error shape.
//
// A caller (a hook, a script, Claude itself) needs to tell "you typed a bad
// flag" apart from "the network is down". That only works if the message shape
// is the same wherever the flag was typed.
// ---------------------------------------------------------------------------
describe('AXIS 8: unknown-flag error shape is identical across commands', () => {
  test('every command produces the same message modulo the flag name', async () => {
    // [argv, the command name the message should attribute the flag to]
    const probes = [
      [['todo', 'list'], 'todo list'],
      [['todo', 'get', 'a'], 'todo get'],
      [['capture', 'list'], 'capture list'],
      [['knowledge', 'list'], 'knowledge list'],
      [['check-integrity'], 'check-integrity'],
      [['promote-scheduled'], 'promote-scheduled'],
      [['todo', 'collateral', 'list', 'a'], 'todo collateral list'],
    ];

    // The shape a caller can parse: same stem everywhere, the command that
    // rejected it, then the offending flag(s). Commands legitimately name
    // themselves, so identity of the whole line is not the requirement —
    // identity of the *template* is.
    const expected = [];
    const actual = [];
    for (const [base, name] of probes) {
      jest.clearAllMocks();
      const { errors, exitCode } = await runCLI([...base, '--zzz', 'x']);
      expect(exitCode).toBe(1);
      actual.push(errors.split('\n')[0].trim());
      expected.push(`Unknown or unsupported flag for '${name}': --zzz`);
    }

    expect(actual).toEqual(expected);
  });

  test('every error path exits exactly 1, never 0 and never a stray code', async () => {
    const badInvocations = [
      ['todo', 'list', '--zzz'],
      ['todo', 'list', '-zzz'],
      ['todo', 'frobnicate'],
      ['frobnicate'],
      ['knowledge', 'upsert', 'a.md'],
      ['todo', 'update', 'a', '--file'],
    ];

    for (const argv of badInvocations) {
      jest.clearAllMocks();
      const { exitCode, errors } = await withTtyStdin(() => runCLI(argv));
      expect({ argv: argv.join(' '), exitCode }).toEqual({ argv: argv.join(' '), exitCode: 1 });
      expect(errors.trim()).not.toBe('');
    }
  });
});

// ---------------------------------------------------------------------------
// AXIS 3 — `--flag=value` accepted wherever the space form is, with identical
// results. README: "All commands accept `--flag value` and `--flag=value`
// interchangeably."
// ---------------------------------------------------------------------------
describe('AXIS 3: --flag=value is interchangeable with --flag value', () => {
  const pairs = [
    ['todo list --format', ['todo', 'list', '--format', 'json'], ['todo', 'list', '--format=json']],
    ['todo get --format', ['todo', 'get', 'a', '--format', 'json'], ['todo', 'get', 'a', '--format=json']],
    ['capture list --format', ['capture', 'list', '--format', 'json'], ['capture', 'list', '--format=json']],
    ['capture get --format', ['capture', 'get', 'i', '--format', 'json'], ['capture', 'get', 'i', '--format=json']],
    ['capture media --format', ['capture', 'media', 'i', '--format', 'json'], ['capture', 'media', 'i', '--format=json']],
    ['knowledge list --prefix', ['knowledge', 'list', '--prefix', 'tools/'], ['knowledge', 'list', '--prefix=tools/']],
    ['knowledge get --format', ['knowledge', 'get', 'a.md', '--format', 'json'], ['knowledge', 'get', 'a.md', '--format=json']],
    ['check-integrity --format', ['check-integrity', '--format', 'json'], ['check-integrity', '--format=json']],
    ['todo collateral list --format', ['todo', 'collateral', 'list', 'a', '--format', 'json'], ['todo', 'collateral', 'list', 'a', '--format=json']],
    ['todo archive --summary-text', ['todo', 'archive', 'a', '--summary-text', 'done'], ['todo', 'archive', 'a', '--summary-text=done']],
    ['todo create --priority', ['todo', 'create', '--name', 'a', '--priority', 'P1'], ['todo', 'create', '--name=a', '--priority=P1']],
  ];

  test.each(pairs.map(([label]) => [label]))('%s: both forms exit 0 with identical output', async (label) => {
    const [, spaceArgs, eqArgs] = pairs.find(([l]) => l === label);

    jest.clearAllMocks();
    const space = await runCLI(spaceArgs);
    jest.clearAllMocks();
    const eq = await runCLI(eqArgs);

    expect({ form: 'space', exitCode: space.exitCode, errors: space.errors })
      .toEqual({ form: 'space', exitCode: 0, errors: '' });
    expect({ form: 'equals', exitCode: eq.exitCode, errors: eq.errors })
      .toEqual({ form: 'equals', exitCode: 0, errors: '' });
    expect(eq.output).toBe(space.output);
  });

  test('backup --config=<missing> behaves like the space form', async () => {
    const missing = path.join(os.tmpdir(), `brainy-no-config-${Date.now()}.json`);

    const space = await runCLI(['backup', '--config', missing]);
    const eq = await runCLI(['backup', '--config=' + missing]);

    expect(space.exitCode).toBe(0);
    expect(eq.exitCode).toBe(0);
    expect(eq.output).toBe(space.output);
  });
});

// ---------------------------------------------------------------------------
// AXIS 3b — a value-taking flag given no value.
//
// `--file` with no path was guarded because it produced a raw Node TypeError.
// The underlying bug is generic: `--status` at the end of argv parses to
// boolean `true`, and `true` is then handed to storage as if the user had typed
// it. Every flag that takes a value must reject a missing one, locally, for the
// same reason `--file` does — otherwise `todo update x --status --format json`
// writes `status: true` to the database.
// ---------------------------------------------------------------------------
describe('AXIS 3b: value-taking flags reject a missing value', () => {
  const cases = [
    ['todo list --status', ['todo', 'list', '--status', '--format', 'json'], '--status'],
    ['todo list --format', ['todo', 'list', '--format'], '--format'],
    ['todo create --name', ['todo', 'create', '--name', '--summary', 's'], '--name'],
    ['todo create --priority', ['todo', 'create', '--name', 'a', '--priority'], '--priority'],
    ['todo update --status', ['todo', 'update', 'a', '--status'], '--status'],
    ['todo update --due', ['todo', 'update', 'a', '--due', '--priority', 'P1'], '--due'],
    ['todo archive --summary-text', ['todo', 'archive', 'a', '--summary-text'], '--summary-text'],
    ['knowledge list --prefix', ['knowledge', 'list', '--prefix'], '--prefix'],
    ['capture list --format', ['capture', 'list', '--format'], '--format'],
  ];

  test.each(cases.map(([label]) => [label]))('%s errors instead of parsing as boolean true', async (label) => {
    const [, argv, flag] = cases.find(([l]) => l === label);

    const { errors, exitCode } = await runCLI(argv);

    expect(exitCode).toBe(1);
    expect(errors).toContain(flag);
    expectNoBackendCalls();
  });

  test('boolean flags are unaffected: --all and --replace still work bare', async () => {
    const all = await runCLI(['todo', 'list', '--all']);
    expect(all.exitCode).toBe(0);
    expect(mockStorage.listTodos).toHaveBeenCalledWith(undefined);

    jest.clearAllMocks();
    const rep = await runCLI(['todo', 'collateral', 'add', 'a', '/p/f.md', '--replace']);
    expect(rep.exitCode).toBe(0);
    expect(mockStorage.addCollateral).toHaveBeenCalledWith('a', '/p/f.md', { replace: true });
  });
});

// ---------------------------------------------------------------------------
// AXIS 9 — --format json means the same thing everywhere.
//
// Strict for the commands the README documents as JSON-capable: the output must
// actually parse. `exit 0 + human text` means the flag was silently ignored,
// which is the exact failure mode flag validation exists to prevent.
// ---------------------------------------------------------------------------
describe('AXIS 9: --format json emits parseable JSON on documented commands', () => {
  const jsonCommands = [
    ['todo list', ['todo', 'list', '--format', 'json']],
    ['todo get', ['todo', 'get', 'a', '--format', 'json']],
    ['todo collateral list', ['todo', 'collateral', 'list', 'a', '--format', 'json']],
    ['todo collateral get', ['todo', 'collateral', 'get', 'a', 'f.md', '--format', 'json']],
    ['capture list', ['capture', 'list', '--format', 'json']],
    ['capture get', ['capture', 'get', 'i', '--format', 'json']],
    ['capture media', ['capture', 'media', 'i', '--format', 'json']],
    ['knowledge list', ['knowledge', 'list', '--format', 'json']],
    ['knowledge get', ['knowledge', 'get', 'a.md', '--format', 'json']],
    ['check-integrity', ['check-integrity', '--format', 'json']],
  ];

  test.each(jsonCommands.map(([label]) => [label]))('`%s --format json` output parses as JSON', async (label) => {
    const [, argv] = jsonCommands.find(([l]) => l === label);

    const { output, exitCode } = await runCLI(argv);

    expect(exitCode).toBe(0);
    expect(() => JSON.parse(output)).not.toThrow();
  });

  // These four were the commands that silently ignored --format. The rule is
  // now the same as above rather than a disjunction: honour it, and emit
  // something structurally useful — not a stringified success message.
  const alsoJson = [
    ['promote-scheduled', ['promote-scheduled', '--format', 'json']],
    ['todo create', ['todo', 'create', '--name', 'a', '--summary', 's', '--format', 'json']],
    ['capture process', ['capture', 'process', 'i', '--format', 'json']],
  ];

  test.each(alsoJson.map(([label]) => [label]))('`%s --format json` emits JSON, never the human line', async (label) => {
    const [, argv] = alsoJson.find(([l]) => l === label);

    const { output, exitCode } = await runCLI(argv);

    expect(exitCode).toBe(0);
    expect(() => JSON.parse(output)).not.toThrow();
    expect(output).not.toMatch(/^(Created|Processed|Promoted|No scheduled):/m);
  });

  test('promote-scheduled --format json carries the promoted names, not a sentence', async () => {
    mockStorage.promoteScheduled.mockResolvedValue(['ship-it', 'call-vet']);

    const { output, exitCode } = await runCLI(['promote-scheduled', '--format', 'json']);

    expect(exitCode).toBe(0);
    const parsed = JSON.parse(output);
    expect(parsed.promoted).toEqual(['ship-it', 'call-vet']);
    expect(parsed.count).toBe(2);
  });

  test('todo create --format json returns the created record', async () => {
    const { output, exitCode } = await runCLI(['todo', 'create', '--name', 'a', '--summary', 's', '--format', 'json']);

    expect(exitCode).toBe(0);
    expect(JSON.parse(output)).toEqual({ name: 'a', status: 'inbox' });
  });

  test('check-integrity --format json returns the result object', async () => {
    const { output, exitCode } = await runCLI(['check-integrity', '--format', 'json']);

    expect(exitCode).toBe(0);
    expect(JSON.parse(output)).toEqual({ ok: true, issues: [] });
  });

  test('--format text is the explicit spelling of the default human output', async () => {
    jest.clearAllMocks();
    mockStorage.listTodos.mockResolvedValue([
      { name: 'a', summary: 's', status: 'active', priority: 'P1' },
    ]);
    const explicit = await runCLI(['todo', 'list', '--format', 'text']);
    jest.clearAllMocks();
    mockStorage.listTodos.mockResolvedValue([
      { name: 'a', summary: 's', status: 'active', priority: 'P1' },
    ]);
    const implicit = await runCLI(['todo', 'list']);

    expect(explicit.exitCode).toBe(0);
    expect(explicit.output).toBe(implicit.output);
  });

  test('an unsupported --format value is rejected, not silently treated as text', async () => {
    // `--format jsonn` silently printing the human table is the same class of
    // bug as `--priorty`: a typo that looks like it worked. The value deserves
    // the same validation the flag name gets.
    const probes = [
      ['todo', 'list', '--format', 'yaml'],
      ['capture', 'list', '--format', 'jsonn'],
      ['knowledge', 'list', '--format=xml'],
      ['todo', 'get', 'a', '--format', 'JSON '],
    ];

    const results = [];
    for (const argv of probes) {
      jest.clearAllMocks();
      const { exitCode } = await runCLI(argv);
      results.push({ argv: argv.join(' '), exitCode });
    }

    expect(results).toEqual(probes.map((argv) => ({ argv: argv.join(' '), exitCode: 1 })));
  });
});

// ---------------------------------------------------------------------------
// AXIS 7 — a missing required argument is caught locally.
//
// `capture get` and every `collateral` sub-action already print Usage and exit
// 1. The core todo/knowledge actions must do the same: `todo delete` with no
// name should not reach the network to find out, and `getTodo(undefined)` is a
// pointless round trip that surfaces a Supabase error instead of a usage hint.
// ---------------------------------------------------------------------------
describe('AXIS 7: missing required arguments are rejected locally', () => {
  const cases = [
    ['todo get (no name)', ['todo', 'get']],
    ['todo create (no --name)', ['todo', 'create', '--summary', 's']],
    ['todo update (no name)', ['todo', 'update', '--status', 'active']],
    ['todo delete (no name)', ['todo', 'delete']],
    ['todo archive (no name)', ['todo', 'archive', '--summary-text', 'done']],
    ['todo collateral list (no name)', ['todo', 'collateral', 'list']],
    ['todo collateral add (no path)', ['todo', 'collateral', 'add', 'a']],
    ['todo collateral get (no filename)', ['todo', 'collateral', 'get', 'a']],
    ['todo collateral remove (no filename)', ['todo', 'collateral', 'remove', 'a']],
    ['capture get (no id)', ['capture', 'get']],
    ['capture media (no id)', ['capture', 'media']],
    ['capture process (no id)', ['capture', 'process']],
    ['capture delete (no id)', ['capture', 'delete']],
    ['knowledge get (no path)', ['knowledge', 'get']],
    ['knowledge upsert (no path)', ['knowledge', 'upsert', '--file', 'IGNORED']],
  ];

  test.each(cases.map(([label]) => [label]))('%s exits 1 with a usage message and no backend call', async (label) => {
    let [, argv] = cases.find(([l]) => l === label);
    if (argv[argv.length - 1] === 'IGNORED') argv = [...argv.slice(0, -1), tmpFile('# body')];

    const { errors, exitCode } = await withTtyStdin(() => runCLI(argv));

    expect(exitCode).toBe(1);
    expect(errors).toMatch(/Usage/i);
    expectNoBackendCalls();
  });
});

// ---------------------------------------------------------------------------
// AXIS 11 — an omitted argument must never blank or destroy stored data.
// ---------------------------------------------------------------------------
describe('AXIS 11: destructive-if-empty paths are guarded', () => {
  // README: "an upsert with no content would blank an existing entry; that
  // invocation is now an error (exit 1) instead of a silent wipe." An empty
  // file is the same silent wipe with an extra step: `--file tmp/notes.md`
  // where the write failed, or a truncated file, blanks the entry's whole body
  // and reports success. The guard has to be about the *content*, not about
  // whether a flag was typed.
  test('knowledge upsert with an empty --file does not wipe the entry', async () => {
    const p = tmpFile('');

    const { errors, exitCode } = await runCLI(['knowledge', 'upsert', 'a.md', '--file', p]);

    expect(exitCode).toBe(1);
    expect(errors.trim()).not.toBe('');
    expect(mockStorage.upsertKnowledge).not.toHaveBeenCalled();
  });

  test('knowledge upsert with whitespace-only --file does not wipe the entry', async () => {
    const p = tmpFile('   \n\n  ');

    const { exitCode } = await runCLI(['knowledge', 'upsert', 'a.md', '--file', p]);

    expect(exitCode).toBe(1);
    expect(mockStorage.upsertKnowledge).not.toHaveBeenCalled();
  });

  // `--stdin` with no pipe attached is the interactive case: the user typed
  // `knowledge upsert a.md --stdin` at a prompt. readStdin() sees a TTY and
  // resolves '' immediately, so the CLI happily writes an empty body over a
  // live entry and prints success. Asking to read a pipe when there is no pipe
  // is a usage error on every command that accepts --stdin.
  test('knowledge upsert --stdin with no piped input is an error, not an empty write', async () => {
    const { errors, exitCode } = await withTtyStdin(() => runCLI(['knowledge', 'upsert', 'a.md', '--stdin']));

    expect(exitCode).toBe(1);
    expect(errors.trim()).not.toBe('');
    expect(mockStorage.upsertKnowledge).not.toHaveBeenCalled();
  });

  test('todo update --field notes --stdin with no piped input is an error, not an empty write', async () => {
    const { exitCode } = await withTtyStdin(() => runCLI(['todo', 'update', 'a', '--field', 'notes', '--stdin']));

    expect(exitCode).toBe(1);
    expect(mockStorage.updateTodo).not.toHaveBeenCalled();
  });

  test('todo create --field notes --stdin with no piped input is an error', async () => {
    const { exitCode } = await withTtyStdin(() =>
      runCLI(['todo', 'create', '--name', 'a', '--summary', 's', '--field', 'notes', '--stdin']));

    expect(exitCode).toBe(1);
    expect(mockStorage.createTodo).not.toHaveBeenCalled();
  });

  // `archive` deletes the todo row and keeps only the summary text. Archiving
  // with no summary throws away the record's remaining value, so the summary is
  // required in the same way a content source is required for upsert.
  test('todo archive without --summary-text is rejected rather than archiving an empty summary', async () => {
    const { exitCode } = await runCLI(['todo', 'archive', 'a', '--completion-date', '2026-01-01']);

    expect(exitCode).toBe(1);
    expect(mockStorage.archiveTodo).not.toHaveBeenCalled();
  });

  // A bare `todo update <name>` has nothing to write. Reporting "Updated:" for
  // a no-op is the same false-success class as the old `-status` bug.
  test('todo update with no field flags is rejected instead of reporting a no-op success', async () => {
    const { output, exitCode } = await runCLI(['todo', 'update', 'a']);

    expect(exitCode).toBe(1);
    expect(output).not.toMatch(/Updated:/);
    expect(mockStorage.updateTodo).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// AXIS 4 + 5 — the three content-taking commands must behave identically.
//
// `todo create`, `todo update` and `knowledge upsert` all read a body from
// --file or --stdin. The corruption guard, BOM stripping and the two-source
// case were each tested on only some of them.
// ---------------------------------------------------------------------------
describe('AXIS 4/5: --file and --stdin behave identically on all three content commands', () => {
  const CONTENT_COMMANDS = [
    ['todo create', (extra) => ['todo', 'create', '--name', 'a', '--summary', 's', '--field', 'notes', ...extra]],
    ['todo update', (extra) => ['todo', 'update', 'a', '--field', 'notes', ...extra]],
    ['knowledge upsert', (extra) => ['knowledge', 'upsert', 'a.md', ...extra]],
  ];

  test.each(CONTENT_COMMANDS.map(([label]) => [label]))('%s: the stdin corruption guard rejects mangled input', async (label) => {
    const build = CONTENT_COMMANDS.find(([l]) => l === label)[1];

    const { errors, exitCode } = await withStdin('Oct 23?25 ????1009', () => runCLI(build(['--stdin'])));

    expect(exitCode).toBe(1);
    expect(errors).toMatch(/--file/);
    expectNoBackendCalls();
  });

  test.each(CONTENT_COMMANDS.map(([label]) => [label]))('%s: --file bypasses the corruption guard', async (label) => {
    const build = CONTENT_COMMANDS.find(([l]) => l === label)[1];
    const body = 'literal 23?25 and ????1009 via file';
    const p = tmpFile(body);

    const { exitCode } = await runCLI(build(['--file', p]));

    expect(exitCode).toBe(0);
  });

  test.each(CONTENT_COMMANDS.map(([label]) => [label]))('%s: a UTF-8 BOM is stripped from --file content', async (label) => {
    const build = CONTENT_COMMANDS.find(([l]) => l === label)[1];
    const p = tmpFile('﻿body without bom');

    const { exitCode } = await runCLI(build(['--file', p]));
    expect(exitCode).toBe(0);

    const bodies = [
      ...mockStorage.createTodo.mock.calls.map((c) => c[0].notes),
      ...mockStorage.updateTodo.mock.calls.map((c) => c[1].notes),
      ...mockStorage.upsertKnowledge.mock.calls.map((c) => c[0].content),
    ].filter((v) => v !== undefined);

    expect(bodies).toEqual(['body without bom']);
  });

  test.each(CONTENT_COMMANDS.map(([label]) => [label]))('%s: --file and --stdin together is an error, not a silent winner', async (label) => {
    const build = CONTENT_COMMANDS.find(([l]) => l === label)[1];
    const p = tmpFile('from the file');

    const { errors, exitCode } = await withStdin('from the pipe', () => runCLI(build(['--file', p, '--stdin'])));

    expect(exitCode).toBe(1);
    expect(errors).toMatch(/--file|--stdin/);
    expectNoBackendCalls();
  });

  // Every other flag error names the flag it came from ("Unknown or unsupported
  // flag for 'todo list': --zzz", "--file requires a path"). A missing --file
  // path — the commonest --file mistake, a typo'd tmp/ path — currently reports
  // a bare Node ENOENT, which reads like an internal failure rather than a
  // usage error and cannot be attributed to a flag by a caller.
  test.each(CONTENT_COMMANDS.map(([label]) => [label]))('%s: a missing --file path is reported as a --file error', async (label) => {
    const build = CONTENT_COMMANDS.find(([l]) => l === label)[1];
    const missing = path.join(os.tmpdir(), `brainy-definitely-missing-${Date.now()}.md`);

    const { errors, exitCode } = await runCLI(build(['--file', missing]));

    expect(exitCode).toBe(1);
    expect(errors).toContain(missing);
    expect(errors).toContain('--file');
    expectNoBackendCalls();
  });

  // `--field` is a todo-only concept. On knowledge upsert it must be rejected
  // as an unsupported flag rather than accepted and ignored.
  test('knowledge upsert rejects --field, which belongs to todo', async () => {
    const p = tmpFile('# body');
    const { errors, exitCode } = await runCLI(['knowledge', 'upsert', 'a.md', '--field', 'notes', '--file', p]);

    expect(exitCode).toBe(1);
    expect(errors).toContain('--field');
    expectNoBackendCalls();
  });

  // ...and --stdin/--file are content concepts: they must be rejected on
  // commands that have no body to write.
  test('--stdin and --file are rejected on commands that take no content', async () => {
    for (const argv of [
      ['todo', 'list', '--stdin'],
      ['todo', 'delete', 'a', '--file', 'x.md'],
      ['knowledge', 'get', 'a.md', '--stdin'],
      ['capture', 'list', '--file', 'x.md'],
    ]) {
      jest.clearAllMocks();
      const { exitCode, errors } = await withTtyStdin(() => runCLI(argv));
      expect({ argv: argv.join(' '), exitCode }).toEqual({ argv: argv.join(' '), exitCode: 1 });
      expect(errors).toMatch(/--stdin|--file/);
      expectNoBackendCalls();
    }
  });
});

// ---------------------------------------------------------------------------
// AXIS 10 — --help / -h everywhere.
// ---------------------------------------------------------------------------
describe('AXIS 10: --help works on every resource, action and utility', () => {
  const helpTargets = [
    ['(no args)', []],
    ['--help', ['--help']],
    ['-h', ['-h']],
    ['todo --help', ['todo', '--help']],
    ['todo list --help', ['todo', 'list', '--help']],
    ['todo collateral --help', ['todo', 'collateral', '--help']],
    ['todo collateral add --help', ['todo', 'collateral', 'add', '--help']],
    ['capture --help', ['capture', '--help']],
    ['capture get --help', ['capture', 'get', '--help']],
    ['knowledge --help', ['knowledge', '--help']],
    ['knowledge upsert --help', ['knowledge', 'upsert', '--help']],
    ['check-integrity --help', ['check-integrity', '--help']],
    ['promote-scheduled --help', ['promote-scheduled', '--help']],
    ['backup --help', ['backup', '--help']],
  ];

  test.each(helpTargets.map(([label]) => [label]))('`%s` prints help, exits 0, and touches no backend', async (label) => {
    const [, argv] = helpTargets.find(([l]) => l === label);

    const { output, exitCode } = await runCLI(argv);

    expect(exitCode).toBe(0);
    expect(output).toContain('node backend/cli.js');
    expectNoBackendCalls();
  });

  test('help short-circuits an invalid flag on every resource, not just todo/knowledge', async () => {
    for (const argv of [
      ['capture', 'list', '--zzz', '--help'],
      ['capture', 'get', 'i', '-zzz', '--help'],
      ['check-integrity', '--zzz', '--help'],
      ['promote-scheduled', '-zzz', '--help'],
      ['backup', '--zzz', '--help'],
      ['todo', 'collateral', 'add', 'a', 'f.md', '--zzz', '--help'],
    ]) {
      jest.clearAllMocks();
      const { output, exitCode } = await runCLI(argv);
      expect({ argv: argv.join(' '), exitCode }).toEqual({ argv: argv.join(' '), exitCode: 0 });
      expect(output).toContain('node backend/cli.js');
      expectNoBackendCalls();
    }
  });
});

// ---------------------------------------------------------------------------
// Extra positionals — the same false-success class as `-status`.
//
// `todo update my-task active` (a forgotten `--status`) currently has nowhere
// to put "active", so it updates nothing and prints a success line. An
// argument the command cannot use must be reported, exactly like an unknown
// flag.
// ---------------------------------------------------------------------------
describe('unexpected positional arguments are reported, not dropped', () => {
  const cases = [
    ['todo update a active', ['todo', 'update', 'a', 'active']],
    ['todo get a b', ['todo', 'get', 'a', 'b']],
    ['todo list inbox', ['todo', 'list', 'inbox']],
    ['capture list all', ['capture', 'list', 'all']],
    ['knowledge list tools/', ['knowledge', 'list', 'tools/']],
    ['check-integrity now', ['check-integrity', 'now']],
  ];

  test.each(cases.map(([label]) => [label]))('`%s` exits 1 instead of silently ignoring the extra word', async (label) => {
    const [, argv] = cases.find(([l]) => l === label);

    const { output, exitCode } = await runCLI(argv);

    expect(exitCode).toBe(1);
    expect(output).not.toMatch(/^(Created|Updated|Deleted|Archived):/m);
    expectNoBackendCalls();
  });
});
