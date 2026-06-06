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
  checkIntegrity: jest.fn(),
  promoteScheduled: jest.fn(),
};

jest.mock('../backend/storage', () => ({
  getStorage: () => mockStorage,
}));

jest.mock('../backend/capture-service', () => ({}));

const { main, detectEncodingCorruption } = require('../backend/cli.js');

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
      return { output, errors, exitCode };
    });
}

function withStdin(text, fn) {
  const orig = Object.getOwnPropertyDescriptor(process, 'stdin');
  const mock = Readable.from([Buffer.from(text, 'utf8')]);
  mock.isTTY = false;
  Object.defineProperty(process, 'stdin', { value: mock, configurable: true });
  return Promise.resolve(fn()).finally(() => {
    Object.defineProperty(process, 'stdin', orig);
  });
}

function tmpFile(content) {
  const p = path.join(os.tmpdir(), `brainy-test-${Date.now()}-${Math.random().toString(36).slice(2)}.txt`);
  fs.writeFileSync(p, content);
  return p;
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe('detectEncodingCorruption', () => {
  test('flags digit?digit (flattened en-dash range)', () => {
    expect(detectEncodingCorruption('Oct 23?25, 2026')).toBe(true);
    expect(detectEncodingCorruption('8:30?9:30 AM')).toBe(true);
  });

  test('flags runs of consecutive question marks (flattened bullets)', () => {
    expect(detectEncodingCorruption('AmEx ????1009')).toBe(true);
  });

  test('flags space-question-space (flattened em-dash)', () => {
    expect(detectEncodingCorruption('relax on property ? book by the fire')).toBe(true);
  });

  test('does NOT flag a legitimate trailing question mark', () => {
    expect(detectEncodingCorruption('Is this done?')).toBe(false);
    expect(detectEncodingCorruption('What now? Let me check.')).toBe(false);
  });

  test('does NOT flag a URL query string', () => {
    expect(detectEncodingCorruption('see http://example.com/p?q=1 for details')).toBe(false);
  });

  test('does NOT flag clean unicode content', () => {
    expect(detectEncodingCorruption('Oct 23–25 — book by the fire •••• grounds')).toBe(false);
  });
});

describe('todo update --field notes --file', () => {
  test('reads UTF-8 file content and passes it to updateTodo', async () => {
    mockStorage.updateTodo.mockResolvedValue({ name: 'foo', status: 'active' });
    const content = 'Oct 23–25 — book by the fire\nSecond line';
    const p = tmpFile(content);

    const { exitCode } = await runCLI(['todo', 'update', 'foo', '--field', 'notes', '--file', p]);

    expect(exitCode).toBe(0);
    expect(mockStorage.updateTodo).toHaveBeenCalledWith('foo', { notes: content });
    fs.unlinkSync(p);
  });

  test('--file bypasses the corruption guard (trusted path)', async () => {
    mockStorage.updateTodo.mockResolvedValue({ name: 'foo', status: 'active' });
    const content = 'literal question marks 23?25 and ????1009 are allowed via file';
    const p = tmpFile(content);

    const { exitCode } = await runCLI(['todo', 'update', 'foo', '--field', 'notes', '--file', p]);

    expect(exitCode).toBe(0);
    expect(mockStorage.updateTodo).toHaveBeenCalledWith('foo', { notes: content });
    fs.unlinkSync(p);
  });

  test('strips a UTF-8 BOM from the file', async () => {
    mockStorage.updateTodo.mockResolvedValue({ name: 'foo', status: 'active' });
    const p = tmpFile('﻿no bom please');

    await runCLI(['todo', 'update', 'foo', '--field', 'notes', '--file', p]);

    expect(mockStorage.updateTodo).toHaveBeenCalledWith('foo', { notes: 'no bom please' });
    fs.unlinkSync(p);
  });
});

describe('todo update --field notes --stdin guard', () => {
  test('rejects corrupted stdin and does not write', async () => {
    mockStorage.updateTodo.mockResolvedValue({ name: 'foo', status: 'active' });

    const { exitCode, errors } = await withStdin('Oct 23?25 ????1009', () =>
      runCLI(['todo', 'update', 'foo', '--field', 'notes', '--stdin']),
    );

    expect(exitCode).toBe(1);
    expect(mockStorage.updateTodo).not.toHaveBeenCalled();
    expect(errors.join('\n')).toMatch(/--file/);
  });

  test('accepts clean stdin', async () => {
    mockStorage.updateTodo.mockResolvedValue({ name: 'foo', status: 'active' });

    const { exitCode } = await withStdin('Oct 23–25 — clean content', () =>
      runCLI(['todo', 'update', 'foo', '--field', 'notes', '--stdin']),
    );

    expect(exitCode).toBe(0);
    expect(mockStorage.updateTodo).toHaveBeenCalledWith('foo', { notes: 'Oct 23–25 — clean content' });
  });
});

describe('knowledge upsert --file', () => {
  test('reads file content and passes it to upsertKnowledge', async () => {
    mockStorage.upsertKnowledge.mockResolvedValue({ path: 'a/b.md' });
    const content = '# Title\nOct 23–25 — notes';
    const p = tmpFile(content);

    const { exitCode } = await runCLI(['knowledge', 'upsert', 'a/b.md', '--file', p]);

    expect(exitCode).toBe(0);
    expect(mockStorage.upsertKnowledge).toHaveBeenCalledWith(expect.objectContaining({
      path: 'a/b.md',
      content,
    }));
    fs.unlinkSync(p);
  });
});
