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
  listCollateral: jest.fn(),
  addCollateral: jest.fn(),
  removeCollateral: jest.fn(),
  getCollateral: jest.fn(),
};

jest.mock('../backend/storage', () => ({
  getStorage: () => mockStorage,
}));

jest.mock('../backend/capture-service', () => ({
  listCapturesWithMedia: jest.fn(),
  getCapture: jest.fn(),
  processCapture: jest.fn(),
  getCaptureMediaUrls: jest.fn(),
}));

const { main } = require('../backend/cli.js');

function runCLI(args, stdinBytes) {
  const origArgv = process.argv;
  const origExit = process.exit;
  const origLog = console.log;
  const origError = console.error;
  const origIsTTY = process.stdin.isTTY;
  const origOn = process.stdin.on;
  const origSetEncoding = process.stdin.setEncoding;

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

  if (stdinBytes !== undefined) {
    process.stdin.isTTY = false;
    process.stdin.on = (event, cb) => {
      if (event === 'data') cb(stdinBytes);
      if (event === 'end') cb();
      return process.stdin;
    };
    process.stdin.setEncoding = () => {};
  } else {
    process.stdin.isTTY = true;
  }

  return main()
    .catch(() => {})
    .then(() => {
      process.argv = origArgv;
      process.exit = origExit;
      console.log = origLog;
      console.error = origError;
      process.stdin.isTTY = origIsTTY;
      process.stdin.on = origOn;
      process.stdin.setEncoding = origSetEncoding;
      return { output, errors, exitCode };
    });
}

beforeEach(() => {
  jest.clearAllMocks();
  mockStorage.upsertKnowledge.mockResolvedValue({ path: 'x.md', upserted: true });
});

function lastContent() {
  return mockStorage.upsertKnowledge.mock.calls[0][0].content;
}

describe('readStdin encoding handling', () => {
  test('UTF-8 happy path preserves em-dash and arrow', async () => {
    const bytes = Buffer.from('hello — world →\n', 'utf8');
    const { errors } = await runCLI(['knowledge', 'upsert', 'x.md', '--stdin'], bytes);
    expect(lastContent()).toBe('hello — world →\n');
    expect(errors.join('\n')).not.toMatch(/cp1252/);
  });

  test('UTF-8 BOM is stripped', async () => {
    const bom = Buffer.from([0xEF, 0xBB, 0xBF]);
    const body = Buffer.from('hello — world', 'utf8');
    const bytes = Buffer.concat([bom, body]);
    const { errors } = await runCLI(['knowledge', 'upsert', 'x.md', '--stdin'], bytes);
    expect(lastContent()).toBe('hello — world');
    expect(errors.join('\n')).not.toMatch(/cp1252/);
  });

  test('cp1252 fallback decodes em-dash byte 0x97 to —', async () => {
    // "hello " + 0x97 (cp1252 em-dash) + " world"
    const bytes = Buffer.concat([
      Buffer.from('hello ', 'ascii'),
      Buffer.from([0x97]),
      Buffer.from(' world', 'ascii'),
    ]);
    const { errors } = await runCLI(['knowledge', 'upsert', 'x.md', '--stdin'], bytes);
    expect(lastContent()).toBe('hello — world');
    expect(errors.join('\n')).toMatch(/cp1252/);
  });

  test('ASCII-only content emits no fallback notice', async () => {
    const bytes = Buffer.from('plain ascii\n', 'ascii');
    const { errors } = await runCLI(['knowledge', 'upsert', 'x.md', '--stdin'], bytes);
    expect(lastContent()).toBe('plain ascii\n');
    expect(errors.join('\n')).not.toMatch(/cp1252/);
  });

  test('bare 0xFF byte falls back to cp1252', async () => {
    const bytes = Buffer.concat([
      Buffer.from('a', 'ascii'),
      Buffer.from([0xFF]),
      Buffer.from('b', 'ascii'),
    ]);
    const { errors } = await runCLI(['knowledge', 'upsert', 'x.md', '--stdin'], bytes);
    // 0xFF in cp1252 is U+00FF (ÿ)
    expect(lastContent()).toBe('aÿb');
    expect(errors.join('\n')).toMatch(/cp1252/);
  });

  test('ambiguous bytes 0xC3 0xA9 decode as UTF-8 é (not cp1252 Ã©)', async () => {
    const bytes = Buffer.from([0xC3, 0xA9]);
    const { errors } = await runCLI(['knowledge', 'upsert', 'x.md', '--stdin'], bytes);
    expect(lastContent()).toBe('é');
    expect(errors.join('\n')).not.toMatch(/cp1252/);
  });
});
