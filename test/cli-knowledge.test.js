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

function runCLI(args, stdinText) {
  const origArgv = process.argv;
  const origExit = process.exit;
  const origLog = console.log;
  const origError = console.error;
  const origIsTTY = process.stdin.isTTY;

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

  if (stdinText !== undefined) {
    process.stdin.isTTY = false;
    const origOn = process.stdin.on.bind(process.stdin);
    process.stdin.on = (event, cb) => {
      if (event === 'data') cb(stdinText);
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
      return { output, errors, exitCode };
    });
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe('knowledge upsert --summary', () => {
  test('passes --summary value to upsertKnowledge', async () => {
    mockStorage.upsertKnowledge.mockResolvedValue({ path: 'a.md', upserted: true });

    await runCLI(
      ['knowledge', 'upsert', 'a.md', '--topic', 'X', '--summary', 'Y', '--stdin'],
      'hello content',
    );

    expect(mockStorage.upsertKnowledge).toHaveBeenCalledWith(
      expect.objectContaining({ path: 'a.md', topic: 'X', summary: 'Y', content: 'hello content' }),
    );
  });

  test('summary is undefined when --summary not given', async () => {
    mockStorage.upsertKnowledge.mockResolvedValue({ path: 'a.md', upserted: true });

    await runCLI(['knowledge', 'upsert', 'a.md', '--stdin'], 'body');

    const call = mockStorage.upsertKnowledge.mock.calls[0][0];
    expect(call.summary).toBeUndefined();
  });
});

describe('knowledge list text format', () => {
  test('does not emit (yaml) / (markdown) suffix per row', async () => {
    mockStorage.listKnowledge.mockResolvedValue([
      { path: 'a.md', topic: 'A', summary: 's' },
      { path: 'b.md', topic: 'B', summary: '' },
    ]);

    const { output } = await runCLI(['knowledge', 'list']);
    const joined = output.join('\n');
    expect(joined).toContain('a.md');
    expect(joined).toContain('b.md');
    expect(joined).not.toContain('(yaml)');
    expect(joined).not.toContain('(markdown)');
  });
});
