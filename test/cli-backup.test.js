const fs = require('fs');
const os = require('os');
const path = require('path');

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
};

jest.mock('../backend/storage', () => ({ getStorage: () => mockStorage }));
jest.mock('../backend/capture-service', () => ({}));

const { main } = require('../backend/cli.js');

function tmpTarget() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'brainy-cli-backup-'));
}

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

const emptyStore = {
  todos: [], collateral: [], knowledge: [], knowledgeAttachments: [],
  archiveEntries: [], archiveSummaries: [], captures: [], captureMedia: [],
};

beforeEach(() => {
  jest.clearAllMocks();
  mockStorage.exportAll.mockResolvedValue(emptyStore);
});

describe('cli backup', () => {
  test('runs an export to the target and prints a completion summary', async () => {
    const target = tmpTarget();
    const { output } = await runCLI(['backup', '--target', target, '--force']);

    expect(mockStorage.exportAll).toHaveBeenCalledTimes(1);
    expect(output.toLowerCase()).toContain('backup complete');
    expect(fs.existsSync(path.join(target, 'manifest.json'))).toBe(true);
  });

  test('notes (does not fail) when no target is configured, pointing to setup', async () => {
    const missingCfg = path.join(tmpTarget(), 'no-config.json');
    const { output, exitCode } = await runCLI(['backup', '--config', missingCfg]);

    expect(mockStorage.exportAll).not.toHaveBeenCalled();
    expect(exitCode).toBe(0);
    expect(output.toLowerCase()).toContain('not configured');
    expect(output).toContain('backup.config.json');
  });

  test('respects the throttle from config (skips a recent run)', async () => {
    const target = tmpTarget();
    fs.writeFileSync(
      path.join(target, 'manifest.json'),
      JSON.stringify({ lastRunAt: new Date().toISOString() })
    );
    const cfg = path.join(tmpTarget(), 'backup.config.json');
    fs.writeFileSync(cfg, JSON.stringify({ targetPath: target, minIntervalDays: 3 }));

    const { output } = await runCLI(['backup', '--config', cfg]);

    expect(mockStorage.exportAll).not.toHaveBeenCalled();
    expect(output.toLowerCase()).toContain('skip');
  });
});
