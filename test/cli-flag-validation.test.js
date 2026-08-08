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

const { main, FLAG_SPEC, FLAG_ARITY, GLOBAL_FLAGS } = require('../backend/cli.js');

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

function tmpFile(content) {
  const p = path.join(os.tmpdir(), `brainy-flags-${Date.now()}-${Math.random().toString(36).slice(2)}.md`);
  fs.writeFileSync(p, content);
  return p;
}

// readStdin() resolves '' immediately when stdin is a TTY. Acceptance tests that
// legitimately pass --stdin would otherwise block forever waiting on a pipe that
// Jest never closes.
async function withTtyStdin(fn) {
  const orig = process.stdin.isTTY;
  process.stdin.isTTY = true;
  try {
    return await fn();
  } finally {
    process.stdin.isTTY = orig;
  }
}

// A real (non-TTY) pipe carrying `text`, closed immediately — the honest way to
// exercise an accepted `--stdin`, since a TTY stdin yields '' and would only
// prove that an *empty* body is accepted.
function withStdin(text, fn) {
  const orig = Object.getOwnPropertyDescriptor(process, 'stdin');
  const mock = Readable.from([Buffer.from(text, 'utf8')]);
  mock.isTTY = false;
  Object.defineProperty(process, 'stdin', { value: mock, configurable: true });
  return Promise.resolve(fn()).finally(() => {
    Object.defineProperty(process, 'stdin', orig);
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  mockStorage.listTodos.mockResolvedValue([]);
  mockStorage.getTodo.mockResolvedValue({ name: 'a', summary: 's', status: 'active', notes: null, collateral: [] });
  mockStorage.createTodo.mockResolvedValue({ name: 'a', status: 'inbox' });
  mockStorage.updateTodo.mockResolvedValue({ name: 'a', status: 'active' });
  mockStorage.deleteTodo.mockResolvedValue({ name: 'a' });
  mockStorage.archiveTodo.mockResolvedValue({ name: 'a', year_month: '2026_01' });
  mockStorage.listCollateral.mockResolvedValue([]);
  mockStorage.addCollateral.mockResolvedValue({ filename: 'f.md', content_type: 'text/markdown', is_text: true, replaced: false });
  mockStorage.removeCollateral.mockResolvedValue({ filename: 'f.md' });
  mockStorage.getCollateral.mockResolvedValue({ filename: 'f.md', content_type: 'text/markdown', text_content: 'x' });
  mockStorage.listKnowledge.mockResolvedValue([]);
  mockStorage.getKnowledge.mockResolvedValue({ path: 'a.md', content: '# a' });
  mockStorage.upsertKnowledge.mockResolvedValue({ path: 'a.md', upserted: true });
  mockStorage.checkIntegrity.mockResolvedValue({ ok: true });
  mockStorage.promoteScheduled.mockResolvedValue([]);

  mockCaptureService.listCapturesWithMedia.mockResolvedValue([]);
  mockCaptureService.getCapture.mockResolvedValue({ id: 'i', text: 't', processed_at: null, created_at: 'now', media: [] });
  mockCaptureService.getCaptureMediaUrls.mockResolvedValue([]);
  mockCaptureService.processCapture.mockResolvedValue({ id: 'i' });
  mockCaptureService.deleteCapture.mockResolvedValue({ id: 'i' });
});

// ---------------------------------------------------------------------------
// Unknown / unsupported flags are rejected instead of silently discarded
// ---------------------------------------------------------------------------
describe('unknown flags are rejected', () => {
  test('todo create with a typo flag exits non-zero and names the flag', async () => {
    const { errors, exitCode } = await runCLI(['todo', 'create', '--name', 'a', '--summary', 's', '--priorty', 'P1']);

    expect(exitCode).toBe(1);
    expect(errors).toContain('--priorty');
    expect(mockStorage.createTodo).not.toHaveBeenCalled();
  });

  test('todo update with an unsupported flag exits non-zero and names it', async () => {
    const { errors, exitCode } = await runCLI(['todo', 'update', 'a', '--sched-date', '2026-09-01']);

    expect(exitCode).toBe(1);
    expect(errors).toContain('--sched-date');
    expect(mockStorage.updateTodo).not.toHaveBeenCalled();
  });

  test('todo list with an unknown flag exits non-zero', async () => {
    const { errors, exitCode } = await runCLI(['todo', 'list', '--statuss', 'inbox']);

    expect(exitCode).toBe(1);
    expect(errors).toContain('--statuss');
    expect(mockStorage.listTodos).not.toHaveBeenCalled();
  });

  test('capture list with an unknown flag exits non-zero', async () => {
    const { errors, exitCode } = await runCLI(['capture', 'list', '--prefix', 'x']);

    expect(exitCode).toBe(1);
    expect(errors).toContain('--prefix');
    expect(mockCaptureService.listCapturesWithMedia).not.toHaveBeenCalled();
  });

  test('knowledge upsert with an unknown flag exits non-zero', async () => {
    const { errors, exitCode } = await runCLI(['knowledge', 'upsert', 'a.md', '--catgory', 'x', '--stdin']);

    expect(exitCode).toBe(1);
    expect(errors).toContain('--catgory');
    expect(mockStorage.upsertKnowledge).not.toHaveBeenCalled();
  });

  test('a flag valid on another command is still rejected here', async () => {
    const { errors, exitCode } = await runCLI(['todo', 'delete', 'a', '--priority', 'P1']);

    expect(exitCode).toBe(1);
    expect(errors).toContain('--priority');
    expect(mockStorage.deleteTodo).not.toHaveBeenCalled();
  });

  test('collateral add accepts --replace but collateral list does not', async () => {
    const ok = await runCLI(['todo', 'collateral', 'add', 'a', '/p/f.md', '--replace']);
    expect(ok.exitCode).toBe(0);

    const bad = await runCLI(['todo', 'collateral', 'list', 'a', '--replace']);
    expect(bad.exitCode).toBe(1);
    expect(bad.errors).toContain('--replace');
  });

  test('backup rejects an unknown flag without running a backup', async () => {
    const { errors, exitCode } = await runCLI(['backup', '--targt', 'C:/nope']);

    expect(exitCode).toBe(1);
    expect(errors).toContain('--targt');
    expect(mockStorage.exportAll).not.toHaveBeenCalled();
  });

  test('reports every offending flag, not just the first', async () => {
    const { errors, exitCode } = await runCLI(['todo', 'list', '--foo', '--bar']);

    expect(exitCode).toBe(1);
    expect(errors).toContain('--foo');
    expect(errors).toContain('--bar');
  });

  test('an unknown action still reports the action, not a flag error', async () => {
    const { errors, exitCode } = await runCLI(['todo', 'frobnicate', '--whatever']);

    expect(exitCode).toBe(1);
    expect(errors).toContain('Unknown todo action');
  });
});

// ---------------------------------------------------------------------------
// --help / -h keep short-circuiting, even alongside a bad flag
// ---------------------------------------------------------------------------
describe('help short-circuit is unaffected', () => {
  test('--help wins over an unknown flag and exits 0', async () => {
    const { output, exitCode } = await runCLI(['todo', 'create', '--priorty', 'P1', '--help']);

    expect(exitCode).toBe(0);
    expect(output).toContain('node backend/cli.js todo <action>');
    expect(mockStorage.createTodo).not.toHaveBeenCalled();
  });

  test('-h wins over an unknown flag and exits 0', async () => {
    const { output, exitCode } = await runCLI(['knowledge', 'upsert', 'a.md', '-h', '--nope']);

    expect(exitCode).toBe(0);
    expect(output).toContain('node backend/cli.js knowledge <action>');
  });

  test('--help wins over a single-dash flag and exits 0', async () => {
    const { output, exitCode } = await runCLI(['todo', 'create', '-status', 'inbox', '--help']);

    expect(exitCode).toBe(0);
    expect(output).toContain('node backend/cli.js todo <action>');
    expect(mockStorage.createTodo).not.toHaveBeenCalled();
  });

  test('bare `todo` still prints todo help', async () => {
    const { output, exitCode } = await runCLI(['todo']);
    expect(exitCode).toBe(0);
    expect(output).toContain('node backend/cli.js todo <action>');
  });
});

// ---------------------------------------------------------------------------
// Every documented flag combination must still be accepted (no false rejects)
// ---------------------------------------------------------------------------
describe('documented invocations are still accepted', () => {
  const filePath = tmpFile('# content');

  afterAll(() => {
    try { fs.unlinkSync(filePath); } catch (_) { /* ignore */ }
  });

  const cases = [
    ['todo', 'list'],
    ['todo', 'list', '--all'],
    ['todo', 'list', '--status', 'inbox', '--format', 'json'],
    ['todo', 'get', 'a', '--format', 'json'],
    ['todo', 'get', '--name', 'a'],
    ['todo', 'create', '--name', 'a', '--summary', 's', '--status', 'inbox', '--priority', 'P1', '--category', 'c', '--due', '2026-01-01', '--blocked-by', 'b'],
    ['todo', 'create', '--name', 'a', '--status', 'scheduled', '--scheduled-date', '2026-09-01'],
    ['todo', 'update', 'a', '--summary', 's', '--status', 'active', '--priority', 'P0', '--category', 'c', '--due', '2026-01-01', '--blocked-by', 'b'],
    ['todo', 'update', 'a', '--status', 'scheduled', '--scheduled-date', '2026-09-01'],
    ['todo', 'delete', 'a'],
    ['todo', 'archive', 'a', '--summary-text', 'done', '--completion-date', '2026-01-01'],
    ['todo', 'collateral', 'list', 'a', '--format', 'json'],
    ['todo', 'collateral', 'add', 'a', '/p/f.md'],
    ['todo', 'collateral', 'add', 'a', '/p/f.md', '--replace'],
    ['todo', 'collateral', 'remove', 'a', 'f.md'],
    ['todo', 'collateral', 'get', 'a', 'f.md', '--format', 'json'],
    ['capture', 'list'],
    ['capture', 'list', '--all', '--format', 'json'],
    ['capture', 'get', 'i', '--format', 'json'],
    ['capture', 'media', 'i', '--format', 'json'],
    ['capture', 'process', 'i'],
    ['capture', 'delete', 'i'],
    ['knowledge', 'list', '--prefix', 'tools/', '--format', 'json'],
    ['knowledge', 'get', 'a.md', '--format', 'json'],
    ['knowledge', 'get', '--path', 'a.md'],
    ['check-integrity'],
    ['check-integrity', '--format', 'json'],
    ['promote-scheduled'],
    // --format is validated as a value now, so both accepted spellings — and
    // the commands that used to ignore it — must still pass.
    ['todo', 'list', '--format', 'text'],
    ['check-integrity', '--format', 'text'],
    ['promote-scheduled', '--format', 'json'],
    ['todo', 'create', '--name', 'a', '--summary', 's', '--format', 'json'],
    ['capture', 'process', 'i', '--format', 'json'],
    ['knowledge', 'get', 'a.md', '--format=text'],
    // --summary-text is required on archive; the --completion-date-less form
    // stays valid.
    ['todo', 'archive', 'a', '--summary-text', 'done'],
    // --clear is the deliberate way to blank todo notes now that empty content
    // is an error.
    ['todo', 'update', 'a', '--field', 'notes', '--clear'],
    // Flags whose empty value means "clear this field" keep working: only flags
    // where an empty value would be a silent no-op require a non-empty one.
    ['todo', 'update', 'a', '--due', ''],
    ['todo', 'update', 'a', '--blocked-by', ''],
    // Positionals that contain (but do not start with) dashes must survive the
    // single-dash flag check: kebab-case todo names, dashed knowledge paths,
    // dashed collateral filenames, and UUID-style capture ids.
    ['todo', 'get', 'build-auth-system'],
    ['todo', 'update', 'build-auth-system', '--status', 'active'],
    ['todo', 'delete', 'build-auth-system'],
    ['knowledge', 'get', 'tools/claude-code/hooks.yml'],
    ['todo', 'collateral', 'get', 'build-auth-system', 'design-notes-v2.md'],
    ['todo', 'collateral', 'remove', 'build-auth-system', 'design-notes-v2.md'],
    ['capture', 'get', '3f2a1b4c-9d8e-4f7a-b6c5-0123456789ab'],
  ];

  test.each(cases.map((c) => [c.join(' '), c]))('`%s` exits 0', async (_label, argv) => {
    const { errors, exitCode } = await runCLI(argv);
    expect(errors).not.toMatch(/Unknown or unsupported flag/);
    expect(exitCode).toBe(0);
  });

  test('knowledge upsert with --topic/--summary/--file exits 0', async () => {
    const { errors, exitCode } = await runCLI(['knowledge', 'upsert', 'a.md', '--topic', 't', '--summary', 's', '--file', filePath]);
    expect(errors).not.toMatch(/Unknown or unsupported flag/);
    expect(exitCode).toBe(0);
  });

  test('todo create with --field notes --file exits 0', async () => {
    const { errors, exitCode } = await runCLI(['todo', 'create', '--name', 'a', '--summary', 's', '--field', 'notes', '--file', filePath]);
    expect(errors).not.toMatch(/Unknown or unsupported flag/);
    expect(exitCode).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// --field / --file / --stdin misuse is reported rather than dropped
// ---------------------------------------------------------------------------
describe('notes flag pairing', () => {
  test('--file without --field notes is rejected', async () => {
    const p = tmpFile('x');
    const { errors, exitCode } = await runCLI(['todo', 'update', 'a', '--file', p]);

    expect(exitCode).toBe(1);
    expect(errors).toMatch(/--field notes/);
    expect(mockStorage.updateTodo).not.toHaveBeenCalled();
    fs.unlinkSync(p);
  });

  test('--field with a non-notes value is rejected', async () => {
    const p = tmpFile('x');
    const { errors, exitCode } = await runCLI(['todo', 'update', 'a', '--field', 'summary', '--file', p]);

    expect(exitCode).toBe(1);
    expect(errors).toMatch(/--field notes/);
    expect(mockStorage.updateTodo).not.toHaveBeenCalled();
    fs.unlinkSync(p);
  });

  test('--field notes with neither --file nor --stdin is rejected', async () => {
    const { errors, exitCode } = await runCLI(['todo', 'create', '--name', 'a', '--field', 'notes']);

    expect(exitCode).toBe(1);
    expect(errors).toMatch(/--file|--stdin/);
    expect(mockStorage.createTodo).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// knowledge upsert writes `content` unconditionally, so an invocation with no
// content source would silently blank a live entry's whole body. It must be a
// hard error, raised before any storage call.
// ---------------------------------------------------------------------------
describe('knowledge upsert requires a content source', () => {
  test('bare `knowledge upsert <path>` is rejected and calls no storage method', async () => {
    const { errors, exitCode } = await runCLI(['knowledge', 'upsert', 'a/b.md']);

    expect(exitCode).toBe(1);
    expect(errors).toMatch(/--file/);
    expect(errors).toMatch(/--stdin/);
    expect(mockStorage.upsertKnowledge).not.toHaveBeenCalled();
  });

  test('--topic without a content source is rejected and calls no storage method', async () => {
    const { errors, exitCode } = await runCLI(['knowledge', 'upsert', 'a/b.md', '--topic', 't']);

    expect(exitCode).toBe(1);
    expect(errors).toMatch(/--file/);
    expect(mockStorage.upsertKnowledge).not.toHaveBeenCalled();
  });

  test('--summary without a content source is rejected and calls no storage method', async () => {
    const { errors, exitCode } = await runCLI(['knowledge', 'upsert', 'a/b.md', '--summary', 's']);

    expect(exitCode).toBe(1);
    expect(errors).toMatch(/--file/);
    expect(mockStorage.upsertKnowledge).not.toHaveBeenCalled();
  });

  test('--path form without a content source is rejected too', async () => {
    const { exitCode } = await runCLI(['knowledge', 'upsert', '--path', 'a/b.md']);

    expect(exitCode).toBe(1);
    expect(mockStorage.upsertKnowledge).not.toHaveBeenCalled();
  });

  test('--file is accepted and the content reaches storage', async () => {
    const p = tmpFile('# body');
    const { exitCode } = await runCLI(['knowledge', 'upsert', 'a/b.md', '--file', p]);

    expect(exitCode).toBe(0);
    expect(mockStorage.upsertKnowledge).toHaveBeenCalledWith(
      expect.objectContaining({ path: 'a/b.md', content: '# body' }),
    );
    fs.unlinkSync(p);
  });

  // This used to run under withTtyStdin(), where readStdin() resolves ''
  // immediately — so it asserted that upsert accepts an EMPTY body, i.e. the
  // exact silent wipe this describe block exists to prevent. Exercise a real
  // pipe and assert the piped body reaches storage.
  test('--stdin is accepted and the piped body reaches storage', async () => {
    const { exitCode } = await withStdin('# piped body', () =>
      runCLI(['knowledge', 'upsert', 'a/b.md', '--stdin']));

    expect(exitCode).toBe(0);
    expect(mockStorage.upsertKnowledge).toHaveBeenCalledWith(
      expect.objectContaining({ path: 'a/b.md', content: '# piped body' }),
    );
  });

  // Typing `--stdin` at an interactive prompt attaches no pipe. Treating that
  // as "empty content" blanks a live entry and reports success; it is a usage
  // error.
  test('--stdin with no pipe attached is rejected instead of writing an empty body', async () => {
    const { exitCode } = await withTtyStdin(() => runCLI(['knowledge', 'upsert', 'a/b.md', '--stdin']));

    expect(exitCode).toBe(1);
    expect(mockStorage.upsertKnowledge).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Single-dash flags used to slip past validation entirely: they landed in
// `positional`, so `todo update x -status active` printed "Updated" and changed
// nothing. They must be rejected, with no storage call.
// ---------------------------------------------------------------------------
describe('single-dash flags are rejected', () => {
  test('todo update <name> -status active does not report false success', async () => {
    const { output, errors, exitCode } = await runCLI(['todo', 'update', 'my-task', '-status', 'active']);

    expect(exitCode).toBe(1);
    expect(errors).toContain('-status');
    expect(output).not.toMatch(/Updated:/);
    expect(mockStorage.updateTodo).not.toHaveBeenCalled();
  });

  test('todo create -status scheduled does not silently create an inbox todo', async () => {
    const { output, errors, exitCode } = await runCLI(['todo', 'create', '--name', 'a', '-status', 'scheduled']);

    expect(exitCode).toBe(1);
    expect(errors).toContain('-status');
    expect(output).not.toMatch(/Created:/);
    expect(mockStorage.createTodo).not.toHaveBeenCalled();
  });

  test('todo list -all does not silently fall back to active-only', async () => {
    const { errors, exitCode } = await runCLI(['todo', 'list', '-all']);

    expect(exitCode).toBe(1);
    expect(errors).toContain('-all');
    expect(mockStorage.listTodos).not.toHaveBeenCalled();
  });

  test('a single-dash flag is rejected on an action-less resource too', async () => {
    const { errors, exitCode } = await runCLI(['backup', '-force']);

    expect(exitCode).toBe(1);
    expect(errors).toContain('-force');
    expect(mockStorage.exportAll).not.toHaveBeenCalled();
  });

  test('check-integrity -foo is rejected rather than running the check', async () => {
    const { errors, exitCode } = await runCLI(['check-integrity', '-foo']);

    expect(exitCode).toBe(1);
    expect(errors).toContain('-foo');
    expect(mockStorage.checkIntegrity).not.toHaveBeenCalled();
  });

  test('a single-dash flag on knowledge upsert is rejected before any write', async () => {
    const p = tmpFile('x');
    const { errors, exitCode } = await runCLI(['knowledge', 'upsert', 'a/b.md', '-topic', 't', '--file', p]);

    expect(exitCode).toBe(1);
    expect(errors).toContain('-topic');
    expect(mockStorage.upsertKnowledge).not.toHaveBeenCalled();
    fs.unlinkSync(p);
  });

  test('-h still short-circuits to help instead of being rejected', async () => {
    const { output, exitCode } = await runCLI(['todo', '-h']);

    expect(exitCode).toBe(0);
    expect(output).toContain('node backend/cli.js todo <action>');
  });
});

// ---------------------------------------------------------------------------
// --flag=value must keep working: it exited 0 before flag validation existed.
// ---------------------------------------------------------------------------
describe('--flag=value form is accepted', () => {
  test('--format=json produces the same output as --format json', async () => {
    mockStorage.listTodos.mockResolvedValue([{ name: 'a', summary: 's', status: 'active', priority: 'P1' }]);

    const eq = await runCLI(['todo', 'list', '--format=json']);
    const space = await runCLI(['todo', 'list', '--format', 'json']);

    expect(eq.exitCode).toBe(0);
    expect(eq.errors).not.toMatch(/Unknown or unsupported flag/);
    expect(eq.output).toBe(space.output);
    expect(JSON.parse(eq.output)).toHaveLength(1);
  });

  test('--status=inbox filters exactly like --status inbox', async () => {
    const { exitCode, errors } = await runCLI(['todo', 'list', '--status=inbox']);

    expect(exitCode).toBe(0);
    expect(errors).not.toMatch(/Unknown or unsupported flag/);
    expect(mockStorage.listTodos).toHaveBeenCalledWith('inbox');
  });

  test('--field=notes --file <path> sets notes', async () => {
    const p = tmpFile('note body');
    const { exitCode, errors } = await runCLI(['todo', 'create', '--name', 'a', '--field=notes', '--file', p]);

    expect(exitCode).toBe(0);
    expect(errors).not.toMatch(/Unknown or unsupported flag/);
    expect(mockStorage.createTodo).toHaveBeenCalledWith(expect.objectContaining({ notes: 'note body' }));
    fs.unlinkSync(p);
  });

  test('--file=<path> is accepted as a value-carrying flag', async () => {
    const p = tmpFile('inline path body');
    const { exitCode } = await runCLI(['knowledge', 'upsert', 'a/b.md', `--file=${p}`]);

    expect(exitCode).toBe(0);
    expect(mockStorage.upsertKnowledge).toHaveBeenCalledWith(
      expect.objectContaining({ content: 'inline path body' }),
    );
    fs.unlinkSync(p);
  });

  test('only the first = splits, so --summary=a=b yields a=b', async () => {
    const { exitCode } = await runCLI(['todo', 'create', '--name', 'a', '--summary=a=b']);

    expect(exitCode).toBe(0);
    expect(mockStorage.createTodo).toHaveBeenCalledWith(expect.objectContaining({ summary: 'a=b' }));
  });

  test('a kebab-case flag still camelCases in the = form', async () => {
    const { exitCode } = await runCLI(['todo', 'update', 'a', '--scheduled-date=2026-09-01', '--status=scheduled']);

    expect(exitCode).toBe(0);
    expect(mockStorage.updateTodo).toHaveBeenCalledWith('a', expect.objectContaining({
      scheduled_date: '2026-09-01',
      status: 'scheduled',
    }));
  });

  test('an unknown flag in the = form is still rejected, and named without its value', async () => {
    const { errors, exitCode } = await runCLI(['todo', 'list', '--statuss=inbox']);

    expect(exitCode).toBe(1);
    expect(errors).toContain('--statuss');
    expect(errors).not.toContain('--statuss=inbox');
    expect(mockStorage.listTodos).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// A valueless --file parses to boolean true, which used to reach
// fs.readFileSync and surface a raw Node TypeError.
// ---------------------------------------------------------------------------
describe('flags that need a value are guarded', () => {
  const TYPE_ERROR = /"path" argument|TypeError|Received type/;

  test('todo create --field notes --file (no path) gives a guard error', async () => {
    const { errors, exitCode } = await runCLI(['todo', 'create', '--name', 'a', '--field', 'notes', '--file']);

    expect(exitCode).toBe(1);
    expect(errors).not.toMatch(TYPE_ERROR);
    expect(errors).toMatch(/--file/);
    expect(mockStorage.createTodo).not.toHaveBeenCalled();
  });

  test('todo update --field notes --file (no path) gives a guard error', async () => {
    const { errors, exitCode } = await runCLI(['todo', 'update', 'a', '--field', 'notes', '--file']);

    expect(exitCode).toBe(1);
    expect(errors).not.toMatch(TYPE_ERROR);
    expect(errors).toMatch(/--file/);
    expect(mockStorage.updateTodo).not.toHaveBeenCalled();
  });

  test('knowledge upsert --file (no path) gives a guard error', async () => {
    const { errors, exitCode } = await runCLI(['knowledge', 'upsert', 'a/b.md', '--file']);

    expect(exitCode).toBe(1);
    expect(errors).not.toMatch(TYPE_ERROR);
    expect(errors).toMatch(/--file/);
    expect(mockStorage.upsertKnowledge).not.toHaveBeenCalled();
  });

  test('--file= with an empty value gives a guard error', async () => {
    const { errors, exitCode } = await runCLI(['knowledge', 'upsert', 'a/b.md', '--file=']);

    expect(exitCode).toBe(1);
    expect(errors).not.toMatch(TYPE_ERROR);
    expect(mockStorage.upsertKnowledge).not.toHaveBeenCalled();
  });

  test('--stdin given a value is rejected rather than swallowing a positional', async () => {
    const { errors, exitCode } = await runCLI(['knowledge', 'upsert', '--stdin', 'a/b.md']);

    expect(exitCode).toBe(1);
    expect(errors).toMatch(/--stdin/);
    expect(mockStorage.upsertKnowledge).not.toHaveBeenCalled();
  });

  test('todo update --field notes --stdin <value> is rejected', async () => {
    const { errors, exitCode } = await runCLI(['todo', 'update', 'a', '--field', 'notes', '--stdin', 'oops']);

    expect(exitCode).toBe(1);
    expect(errors).toMatch(/--stdin/);
    expect(mockStorage.updateTodo).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Arity is declared, not special-cased per flag. FLAG_SPEC says which flags a
// command accepts; FLAG_ARITY says whether each takes a value. If the two drift
// apart, a flag silently loses its arity check and `--newflag` at the end of the
// line goes back to writing boolean true.
// ---------------------------------------------------------------------------
describe('FLAG_SPEC and FLAG_ARITY stay in sync', () => {
  test('every flag any command accepts has a declared arity', () => {
    const declared = new Set([...GLOBAL_FLAGS]);
    for (const byAction of Object.values(FLAG_SPEC)) {
      for (const spec of Object.values(byAction)) {
        for (const flag of spec.flags) declared.add(flag);
      }
    }
    // -h maps onto the same `help` key parseArgs produces for --help.
    const missing = [...declared].filter((f) => !FLAG_ARITY[f]).sort();
    expect(missing).toEqual([]);
  });

  test('no arity is declared for a flag no command accepts', () => {
    const declared = new Set([...GLOBAL_FLAGS]);
    for (const byAction of Object.values(FLAG_SPEC)) {
      for (const spec of Object.values(byAction)) {
        for (const flag of spec.flags) declared.add(flag);
      }
    }
    const orphans = Object.keys(FLAG_ARITY).filter((f) => !declared.has(f)).sort();
    expect(orphans).toEqual([]);
  });

  test('every command spec declares a positional budget and a usage line', () => {
    const bad = [];
    for (const [resource, byAction] of Object.entries(FLAG_SPEC)) {
      for (const [action, spec] of Object.entries(byAction)) {
        if (typeof spec.maxPositional !== 'number' || !spec.usage) {
          bad.push(`${resource} ${action}`.trim());
        }
      }
    }
    expect(bad).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// `--clear` — the deliberate, explicit way to blank todo notes, added because
// empty content from --file/--stdin is now an error everywhere.
// ---------------------------------------------------------------------------
describe('todo update --field notes --clear', () => {
  test('sets notes to null', async () => {
    const { exitCode } = await runCLI(['todo', 'update', 'a', '--field', 'notes', '--clear']);

    expect(exitCode).toBe(0);
    expect(mockStorage.updateTodo).toHaveBeenCalledWith('a', { notes: null });
  });

  test('counts as a field flag, so it is not a no-op update', async () => {
    const { output, exitCode } = await runCLI(['todo', 'update', 'a', '--field', 'notes', '--clear']);

    expect(exitCode).toBe(0);
    expect(output).toMatch(/Updated:/);
  });

  test('--clear without --field notes is rejected', async () => {
    const { errors, exitCode } = await runCLI(['todo', 'update', 'a', '--clear']);

    expect(exitCode).toBe(1);
    expect(errors).toMatch(/--field notes/);
    expect(mockStorage.updateTodo).not.toHaveBeenCalled();
  });

  test('--clear together with --file is rejected as two content sources', async () => {
    const p = tmpFile('body');
    const { errors, exitCode } = await runCLI(['todo', 'update', 'a', '--field', 'notes', '--clear', '--file', p]);

    expect(exitCode).toBe(1);
    expect(errors).toMatch(/--clear/);
    expect(errors).toMatch(/--file/);
    expect(mockStorage.updateTodo).not.toHaveBeenCalled();
    fs.unlinkSync(p);
  });

  test('--clear together with --stdin is rejected as two content sources', async () => {
    const { errors, exitCode } = await withTtyStdin(() =>
      runCLI(['todo', 'update', 'a', '--field', 'notes', '--clear', '--stdin']));

    expect(exitCode).toBe(1);
    expect(errors).toMatch(/--clear/);
    expect(mockStorage.updateTodo).not.toHaveBeenCalled();
  });

  test('--clear given a value is rejected: it is a boolean flag', async () => {
    const { errors, exitCode } = await runCLI(['todo', 'update', 'a', '--field', 'notes', '--clear', 'yes']);

    expect(exitCode).toBe(1);
    expect(errors).toMatch(/--clear/);
    expect(mockStorage.updateTodo).not.toHaveBeenCalled();
  });

  test('--clear does not exist on todo create (nothing to clear)', async () => {
    const { errors, exitCode } = await runCLI(['todo', 'create', '--name', 'a', '--field', 'notes', '--clear']);

    expect(exitCode).toBe(1);
    expect(errors).toContain('--clear');
    expect(mockStorage.createTodo).not.toHaveBeenCalled();
  });

  test('--clear does not exist on knowledge upsert (blanking a body is a delete)', async () => {
    const { errors, exitCode } = await runCLI(['knowledge', 'upsert', 'a/b.md', '--clear']);

    expect(exitCode).toBe(1);
    expect(errors).toContain('--clear');
    expect(mockStorage.upsertKnowledge).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Locally-caught usage errors that used to reach the network (or succeed
// vacuously).
// ---------------------------------------------------------------------------
describe('commands reject invocations that would write nothing useful', () => {
  test('todo create with no --name is rejected before the storage call', async () => {
    const { errors, exitCode } = await runCLI(['todo', 'create', '--summary', 's']);

    expect(exitCode).toBe(1);
    expect(errors).toMatch(/Usage/i);
    expect(mockStorage.createTodo).not.toHaveBeenCalled();
  });

  test('todo archive with no --summary-text is rejected', async () => {
    const { errors, exitCode } = await runCLI(['todo', 'archive', 'a', '--completion-date', '2026-01-01']);

    expect(exitCode).toBe(1);
    expect(errors).toMatch(/--summary-text/);
    expect(mockStorage.archiveTodo).not.toHaveBeenCalled();
  });

  test('todo update with no field flags is rejected instead of a no-op write', async () => {
    const { output, exitCode } = await runCLI(['todo', 'update', 'a']);

    expect(exitCode).toBe(1);
    expect(output).not.toMatch(/Updated:/);
    expect(mockStorage.updateTodo).not.toHaveBeenCalled();
  });

  test('--format alone is not a field flag on todo update', async () => {
    const { exitCode } = await runCLI(['todo', 'update', 'a', '--format', 'json']);

    expect(exitCode).toBe(1);
    expect(mockStorage.updateTodo).not.toHaveBeenCalled();
  });

  test('a missing --file path is attributed to --file, not a bare ENOENT', async () => {
    const missing = path.join(os.tmpdir(), `brainy-absent-${Date.now()}.md`);
    const { errors, exitCode } = await runCLI(['knowledge', 'upsert', 'a/b.md', '--file', missing]);

    expect(exitCode).toBe(1);
    expect(errors).toContain('--file');
    expect(errors).toContain(missing);
    expect(mockStorage.upsertKnowledge).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Positional arguments the command cannot consume are reported, not dropped.
// ---------------------------------------------------------------------------
describe('extra positional arguments are rejected', () => {
  test('todo update <name> <word> does not report a false success', async () => {
    const { output, errors, exitCode } = await runCLI(['todo', 'update', 'my-task', 'active']);

    expect(exitCode).toBe(1);
    expect(errors).toContain('active');
    expect(output).not.toMatch(/Updated:/);
    expect(mockStorage.updateTodo).not.toHaveBeenCalled();
  });

  test('todo list <status> is an error, not shorthand for --status', async () => {
    const { errors, exitCode } = await runCLI(['todo', 'list', 'inbox']);

    expect(exitCode).toBe(1);
    expect(errors).toContain('inbox');
    expect(mockStorage.listTodos).not.toHaveBeenCalled();
  });

  test('an action-less resource rejects a stray word in the action slot', async () => {
    const { errors, exitCode } = await runCLI(['check-integrity', 'now']);

    expect(exitCode).toBe(1);
    expect(errors).toContain('now');
    expect(mockStorage.checkIntegrity).not.toHaveBeenCalled();
  });

  test('collateral sub-actions still accept their full positional set', async () => {
    const ok = await runCLI(['todo', 'collateral', 'get', 'a', 'f.md']);
    expect(ok.exitCode).toBe(0);

    const bad = await runCLI(['todo', 'collateral', 'get', 'a', 'f.md', 'extra']);
    expect(bad.exitCode).toBe(1);
    expect(bad.errors).toContain('extra');
  });
});

// ---------------------------------------------------------------------------
// --format is validated as a value, not just as a name.
// ---------------------------------------------------------------------------
describe('--format value validation', () => {
  test.each([['yaml'], ['jsonn'], ['JSON'], ['Text'], ['']])('--format %p is rejected', async (value) => {
    const { errors, exitCode } = await runCLI(['todo', 'list', `--format=${value}`]);

    expect(exitCode).toBe(1);
    expect(errors).toMatch(/--format/);
    expect(mockStorage.listTodos).not.toHaveBeenCalled();
  });

  test('json and text are both accepted', async () => {
    for (const value of ['json', 'text']) {
      jest.clearAllMocks();
      mockStorage.listTodos.mockResolvedValue([]);
      const { exitCode } = await runCLI(['todo', 'list', '--format', value]);
      expect({ value, exitCode }).toEqual({ value, exitCode: 0 });
    }
  });
});
