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

beforeEach(() => {
  jest.clearAllMocks();
});

// ---------------------------------------------------------------------------
// Chunk 1: has_folder removed
// ---------------------------------------------------------------------------
describe('todo list — no has_folder', () => {
  test('plain text output does not contain has_folder', async () => {
    mockStorage.listTodos.mockResolvedValue([
      { name: 'fix-bug', summary: 'Fix the bug', status: 'active', priority: 'P1', category: 'dev', created_date: '2026-01-01', due: null, scheduled_date: null, blocked_by: [] },
    ]);

    const { output } = await runCLI(['todo', 'list']);
    const full = output.join('\n');
    expect(full).not.toContain('has_folder');
    expect(full).toContain('fix-bug');
  });

  test('json output does not include has_folder key', async () => {
    mockStorage.listTodos.mockResolvedValue([
      { name: 'fix-bug', summary: 'Fix the bug', status: 'active', priority: 'P1', category: 'dev', created_date: '2026-01-01', due: null, scheduled_date: null, blocked_by: [] },
    ]);

    const { output } = await runCLI(['todo', 'list', '--format', 'json']);
    const parsed = JSON.parse(output.join('\n'));
    expect(parsed[0]).not.toHaveProperty('has_folder');
  });
});

describe('todo get — no has_folder', () => {
  test('plain text output does not contain has_folder', async () => {
    mockStorage.getTodo.mockResolvedValue({
      name: 'fix-bug', summary: 'Fix the bug', status: 'active', priority: 'P1',
      category: 'dev', created_date: '2026-01-01', due: null, scheduled_date: null,
      blocked_by: [], notes: 'some notes', collateral: [],
    });

    const { output } = await runCLI(['todo', 'get', 'fix-bug']);
    const full = output.join('\n');
    expect(full).not.toContain('has_folder');
  });

  test('json output does not include has_folder key', async () => {
    mockStorage.getTodo.mockResolvedValue({
      name: 'fix-bug', summary: 'Fix the bug', status: 'active', priority: 'P1',
      category: 'dev', created_date: '2026-01-01', due: null, scheduled_date: null,
      blocked_by: [], notes: null, collateral: [],
    });

    const { output } = await runCLI(['todo', 'get', 'fix-bug', '--format', 'json']);
    const parsed = JSON.parse(output.join('\n'));
    expect(parsed).not.toHaveProperty('has_folder');
  });
});

// ---------------------------------------------------------------------------
// Chunk 2: notes_snapshot removed from archive
// ---------------------------------------------------------------------------
describe('todo archive — no notes_snapshot', () => {
  test('archiveTodo is called without notes_snapshot expectation', async () => {
    mockStorage.archiveTodo.mockResolvedValue({ name: 'old-task', archived: true, year_month: '2026_04' });

    const { output } = await runCLI(['todo', 'archive', 'old-task', '--summary-text', 'Done.', '--completion-date', '2026-04-11']);
    expect(mockStorage.archiveTodo).toHaveBeenCalledWith('old-task', {
      summaryText: 'Done.',
      completionDate: '2026-04-11',
    });
    expect(output[0]).toContain('Archived');
  });
});

// ---------------------------------------------------------------------------
// Chunk 3: todo collateral list
// ---------------------------------------------------------------------------
describe('todo collateral list', () => {
  test('outputs collateral items with content_type and text/binary indicator', async () => {
    mockStorage.listCollateral.mockResolvedValue([
      { filename: 'notes.md', content_type: 'text/markdown', is_text: true },
      { filename: 'diagram.png', content_type: 'image/png', is_text: false },
    ]);

    const { output } = await runCLI(['todo', 'collateral', 'list', 'fix-bug']);
    expect(mockStorage.listCollateral).toHaveBeenCalledWith('fix-bug');
    expect(output[0]).toContain('notes.md');
    expect(output[0]).toContain('text/markdown');
    expect(output[0]).toContain('text');
    expect(output[1]).toContain('diagram.png');
    expect(output[1]).toContain('image/png');
    expect(output[1]).toContain('binary');
  });

  test('json output returns array with is_text', async () => {
    mockStorage.listCollateral.mockResolvedValue([
      { filename: 'notes.md', content_type: 'text/markdown', is_text: true },
    ]);

    const { output } = await runCLI(['todo', 'collateral', 'list', 'fix-bug', '--format', 'json']);
    const parsed = JSON.parse(output.join('\n'));
    expect(parsed[0].is_text).toBe(true);
    expect(parsed[0].filename).toBe('notes.md');
  });

  test('missing name exits with error', async () => {
    const { errors, exitCode } = await runCLI(['todo', 'collateral', 'list']);
    expect(exitCode).toBe(1);
    expect(errors[0]).toContain('Usage');
  });
});

// ---------------------------------------------------------------------------
// Chunk 4: todo collateral add
// ---------------------------------------------------------------------------
describe('todo collateral add', () => {
  test('calls addCollateral and prints result', async () => {
    mockStorage.addCollateral.mockResolvedValue({ filename: 'notes.md', content_type: 'text/markdown', is_text: true });

    const { output } = await runCLI(['todo', 'collateral', 'add', 'fix-bug', '/tmp/notes.md']);
    expect(mockStorage.addCollateral).toHaveBeenCalledWith('fix-bug', '/tmp/notes.md');
    expect(output[0]).toContain('Added');
    expect(output[0]).toContain('notes.md');
  });

  test('missing args exits with error', async () => {
    const { errors, exitCode } = await runCLI(['todo', 'collateral', 'add', 'fix-bug']);
    expect(exitCode).toBe(1);
    expect(errors[0]).toContain('Usage');
  });
});

// ---------------------------------------------------------------------------
// Chunk 5: todo collateral remove
// ---------------------------------------------------------------------------
describe('todo collateral remove', () => {
  test('calls removeCollateral and prints confirmation', async () => {
    mockStorage.removeCollateral.mockResolvedValue({ filename: 'notes.md', removed: true });

    const { output } = await runCLI(['todo', 'collateral', 'remove', 'fix-bug', 'notes.md']);
    expect(mockStorage.removeCollateral).toHaveBeenCalledWith('fix-bug', 'notes.md');
    expect(output[0]).toContain('Removed');
    expect(output[0]).toContain('notes.md');
  });

  test('missing args exits with error', async () => {
    const { errors, exitCode } = await runCLI(['todo', 'collateral', 'remove', 'fix-bug']);
    expect(exitCode).toBe(1);
    expect(errors[0]).toContain('Usage');
  });
});

// ---------------------------------------------------------------------------
// Chunk 6: todo collateral get
// ---------------------------------------------------------------------------
describe('todo collateral get', () => {
  test('prints text content for text collateral', async () => {
    mockStorage.getCollateral.mockResolvedValue({
      filename: 'notes.md', content_type: 'text/markdown', text_content: '# My Notes\nHello',
    });

    const { output } = await runCLI(['todo', 'collateral', 'get', 'fix-bug', 'notes.md']);
    expect(mockStorage.getCollateral).toHaveBeenCalledWith('fix-bug', 'notes.md');
    expect(output.join('\n')).toContain('# My Notes');
  });

  test('prints signed URL for binary collateral', async () => {
    mockStorage.getCollateral.mockResolvedValue({
      filename: 'diagram.png', content_type: 'image/png', url: 'https://example.com/signed/diagram.png',
    });

    const { output } = await runCLI(['todo', 'collateral', 'get', 'fix-bug', 'diagram.png']);
    expect(output[0]).toContain('diagram.png');
    expect(output[0]).toContain('https://example.com/signed/diagram.png');
  });

  test('json output returns full object', async () => {
    mockStorage.getCollateral.mockResolvedValue({
      filename: 'notes.md', content_type: 'text/markdown', text_content: '# Notes',
    });

    const { output } = await runCLI(['todo', 'collateral', 'get', 'fix-bug', 'notes.md', '--format', 'json']);
    const parsed = JSON.parse(output.join('\n'));
    expect(parsed.text_content).toBe('# Notes');
  });

  test('missing args exits with error', async () => {
    const { errors, exitCode } = await runCLI(['todo', 'collateral', 'get', 'fix-bug']);
    expect(exitCode).toBe(1);
    expect(errors[0]).toContain('Usage');
  });
});
