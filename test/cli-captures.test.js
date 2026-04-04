const mockStorage = {
  listCaptures: jest.fn(),
  getCapture: jest.fn(),
  processCapture: jest.fn(),
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

jest.mock('../lib/storage', () => ({
  getStorage: () => mockStorage,
}));

const { main } = require('../lib/cli.js');

function runCLI(args) {
  const origArgv = process.argv;
  const origExit = process.exit;
  const origLog = console.log;
  const origError = console.error;

  const output = [];
  const errors = [];
  let exitCode = 0;

  process.argv = ['node', 'lib/cli.js', ...args];
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

beforeEach(() => {
  jest.clearAllMocks();
});

describe('capture list', () => {
  test('calls listCaptures() with unprocessed default', async () => {
    mockStorage.listCaptures.mockResolvedValue([
      { id: 'abcd1234-0000-0000-0000-000000000000', text: 'buy milk', processed_at: null, created_at: '2026-04-04T10:00:00Z' },
    ]);

    const { output } = await runCLI(['capture', 'list']);

    expect(mockStorage.listCaptures).toHaveBeenCalledWith(undefined);
    expect(output[0]).toContain('abcd1234');
    expect(output[0]).toContain('buy milk');
    expect(output[0]).toContain('unprocessed');
  });

  test('capture list --all calls listCaptures(true)', async () => {
    mockStorage.listCaptures.mockResolvedValue([]);

    await runCLI(['capture', 'list', '--all']);

    expect(mockStorage.listCaptures).toHaveBeenCalledWith(true);
  });
});

describe('capture get', () => {
  test('outputs capture details + media', async () => {
    mockStorage.getCapture.mockResolvedValue({
      id: 'abcd1234-0000-0000-0000-000000000000',
      text: 'buy milk and eggs',
      processed_at: null,
      created_at: '2026-04-04T10:00:00Z',
      media: [{ filename: 'photo.jpg' }],
    });

    const { output } = await runCLI(['capture', 'get', 'abcd1234-0000-0000-0000-000000000000']);

    expect(mockStorage.getCapture).toHaveBeenCalledWith('abcd1234-0000-0000-0000-000000000000');
    expect(output.join('\n')).toContain('buy milk and eggs');
    expect(output.join('\n')).toContain('photo.jpg');
  });

  test('capture get with no id exits with error', async () => {
    const { errors, exitCode } = await runCLI(['capture', 'get']);
    expect(exitCode).toBe(1);
    expect(errors[0]).toContain('Usage');
  });
});

describe('capture process', () => {
  test('marks capture as processed', async () => {
    mockStorage.processCapture.mockResolvedValue({ id: 'aaa', processed: true });

    const { output } = await runCLI(['capture', 'process', 'aaa']);

    expect(mockStorage.processCapture).toHaveBeenCalledWith('aaa');
    expect(output[0]).toContain('Processed');
  });
});
