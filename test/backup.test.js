const fs = require('fs');
const os = require('os');
const path = require('path');

const { exportBackup, loadConfig, formatBackupResult } = require('../backend/backup');

function tmpTarget() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'brainy-backup-test-'));
}

function readJSON(p) {
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

const SENTINEL = '.brainy-backup';

// Mark a temp dir as an existing Brainy backup repo (sentinel present).
function seedRepo(dir) {
  fs.writeFileSync(path.join(dir, SENTINEL), 'brainy');
}

// A fake git collaborator so engine tests stay hermetic (no subprocess). Real
// git behavior is covered separately in backup-git.test.js.
function fakeGit(overrides = {}) {
  return {
    available: jest.fn(() => true),
    isRepo: jest.fn(() => true), // pretend the target is already a repo
    init: jest.fn(),
    addAll: jest.fn(),
    diffStat: jest.fn(() => ({ files: 1, insertions: 10, deletions: 0 })),
    commit: jest.fn(),
    ...overrides,
  };
}

// A minimal store the backup engine can dump. Every array defaults to empty so
// individual tests only specify what they care about.
function fakeStore(overrides = {}) {
  const data = {
    todos: [],
    collateral: [],
    knowledge: [],
    knowledgeAttachments: [],
    archiveEntries: [],
    archiveSummaries: [],
    captures: [],
    captureMedia: [],
    ...overrides,
  };
  return {
    exportAll: jest.fn(async () => data),
    downloadMedia: jest.fn(async (storagePath) => Buffer.from(`binary:${storagePath}`)),
  };
}

// Call exportBackup with a fresh fakeGit unless the test supplies one. Seeds the
// sentinel so the (default isRepo:true) target is treated as an existing Brainy
// backup repo rather than being refused.
function callExport(opts) {
  if (opts.targetPath) seedRepo(opts.targetPath);
  return exportBackup({ git: fakeGit(), ...opts });
}

describe('exportBackup — throttle', () => {
  test('skips when the last run is within minIntervalDays', async () => {
    const targetPath = tmpTarget();
    const now = new Date('2026-07-21T12:00:00Z');
    fs.writeFileSync(
      path.join(targetPath, 'manifest.json'),
      JSON.stringify({ lastRunAt: '2026-07-20T12:00:00Z' })
    );

    const storage = fakeStore();
    const git = fakeGit();
    const result = await exportBackup({ storage, targetPath, minIntervalDays: 3, now, git });

    expect(result.skipped).toBe(true);
    expect(storage.exportAll).not.toHaveBeenCalled();
    expect(git.commit).not.toHaveBeenCalled();
  });

  test('runs when the last run is older than minIntervalDays', async () => {
    const targetPath = tmpTarget();
    fs.mkdirSync(path.join(targetPath, '.git')); // make it look like an existing repo
    seedRepo(targetPath);
    const now = new Date('2026-07-21T12:00:00Z');
    fs.writeFileSync(
      path.join(targetPath, 'manifest.json'),
      JSON.stringify({ lastRunAt: '2026-07-10T12:00:00Z' })
    );

    const storage = fakeStore();
    const result = await exportBackup({ storage, targetPath, minIntervalDays: 3, now, git: fakeGit() });

    expect(result.skipped).toBe(false);
    expect(storage.exportAll).toHaveBeenCalledTimes(1);
  });

  test('runs on first backup when no manifest exists', async () => {
    const storage = fakeStore();
    const result = await callExport({ storage, targetPath: tmpTarget(), minIntervalDays: 3 });
    expect(result.skipped).toBe(false);
    expect(storage.exportAll).toHaveBeenCalledTimes(1);
  });

  test('force runs even when the last run is recent', async () => {
    const targetPath = tmpTarget();
    const now = new Date('2026-07-21T12:00:00Z');
    fs.writeFileSync(
      path.join(targetPath, 'manifest.json'),
      JSON.stringify({ lastRunAt: '2026-07-21T11:00:00Z' })
    );

    seedRepo(targetPath);
    const storage = fakeStore();
    const result = await exportBackup({ storage, targetPath, minIntervalDays: 3, force: true, now, git: fakeGit() });
    expect(result.skipped).toBe(false);
    expect(storage.exportAll).toHaveBeenCalledTimes(1);
  });
});

describe('exportBackup — git requirement & repo init', () => {
  test('throws a clear error when git is not on PATH', async () => {
    const git = fakeGit({ available: jest.fn(() => false) });
    await expect(
      exportBackup({ storage: fakeStore(), targetPath: tmpTarget(), force: true, git })
    ).rejects.toThrow(/git/i);
  });

  test('inits the repo and writes the sentinel when the target is empty', async () => {
    const targetPath = tmpTarget(); // freshly created, empty
    const git = fakeGit({ isRepo: jest.fn(() => false) });
    await exportBackup({ storage: fakeStore(), targetPath, force: true, git });
    expect(git.init).toHaveBeenCalledWith(targetPath);
    expect(fs.existsSync(path.join(targetPath, SENTINEL))).toBe(true);
  });

  test('refuses to init when the target is not a repo and not empty', async () => {
    const targetPath = tmpTarget();
    fs.writeFileSync(path.join(targetPath, 'stray.txt'), 'not mine');
    const git = fakeGit({ isRepo: jest.fn(() => false) });
    await expect(
      exportBackup({ storage: fakeStore(), targetPath, force: true, git })
    ).rejects.toThrow(/empty/i);
    expect(git.init).not.toHaveBeenCalled();
  });

  test('refuses an existing repo that lacks the Brainy sentinel', async () => {
    const targetPath = tmpTarget(); // isRepo true but no sentinel -> someone else's repo
    const git = fakeGit({ isRepo: jest.fn(() => true) });
    await expect(
      exportBackup({ storage: fakeStore(), targetPath, force: true, git })
    ).rejects.toThrow(/brainy backup|sentinel|\.brainy-backup/i);
    expect(git.commit).not.toHaveBeenCalled();
  });

  test('does not init when the target is already a Brainy repo', async () => {
    const targetPath = tmpTarget();
    seedRepo(targetPath);
    const git = fakeGit({ isRepo: jest.fn(() => true) });
    await exportBackup({ storage: fakeStore(), targetPath, force: true, git });
    expect(git.init).not.toHaveBeenCalled();
  });
});

describe('exportBackup — commit & diff size', () => {
  test('stages all and commits when there are changes, returning the diff stats', async () => {
    const targetPath = tmpTarget();
    seedRepo(targetPath);
    const git = fakeGit({ diffStat: jest.fn(() => ({ files: 3, insertions: 45, deletions: 2 })) });
    const result = await exportBackup({ storage: fakeStore(), targetPath, force: true, git });

    expect(git.addAll).toHaveBeenCalledWith(targetPath);
    expect(git.commit).toHaveBeenCalledTimes(1);
    expect(result.committed).toBe(true);
    expect(result.git).toEqual({ files: 3, insertions: 45, deletions: 2 });
  });

  test('does not commit when there are no changes', async () => {
    const targetPath = tmpTarget();
    seedRepo(targetPath);
    const git = fakeGit({ diffStat: jest.fn(() => ({ files: 0, insertions: 0, deletions: 0 })) });
    const result = await exportBackup({ storage: fakeStore(), targetPath, force: true, git });

    expect(git.commit).not.toHaveBeenCalled();
    expect(result.committed).toBe(false);
  });
});

describe('exportBackup — file tree', () => {
  test('writes knowledge content verbatim to knowledge/<path>', async () => {
    const targetPath = tmpTarget();
    const storage = fakeStore({
      knowledge: [{ path: 'tools/docker/networking.md', content: '# Docker networking\n\nbridge notes' }],
    });
    await callExport({ storage, targetPath, force: true });
    const written = fs.readFileSync(
      path.join(targetPath, 'knowledge', 'tools', 'docker', 'networking.md'), 'utf8');
    expect(written).toBe('# Docker networking\n\nbridge notes');
  });

  test('writes todo with its notes to todos/<name>.md', async () => {
    const targetPath = tmpTarget();
    const storage = fakeStore({
      todos: [{ name: 'build-auth-system', status: 'active', priority: 'P1', notes: 'Step 1: schema\nStep 2: trigger' }],
    });
    await callExport({ storage, targetPath, force: true });
    const written = fs.readFileSync(path.join(targetPath, 'todos', 'build-auth-system.md'), 'utf8');
    expect(written).toContain('build-auth-system');
    expect(written).toContain('Step 1: schema');
    expect(written).toContain('Step 2: trigger');
  });

  test('downloads binary files to files/<storage_path>', async () => {
    const targetPath = tmpTarget();
    const storage = fakeStore({
      captureMedia: [{ storage_path: 'user123/captures/abc/photo.png', content_type: 'image/png' }],
    });
    await callExport({ storage, targetPath, force: true });
    expect(storage.downloadMedia).toHaveBeenCalledWith('user123/captures/abc/photo.png');
    const written = fs.readFileSync(path.join(targetPath, 'files', 'user123', 'captures', 'abc', 'photo.png'));
    expect(written.toString()).toBe('binary:user123/captures/abc/photo.png');
  });

  test('skips downloading a binary that already exists at the target', async () => {
    const targetPath = tmpTarget();
    const storagePath = 'user123/x/file.bin';
    const dest = path.join(targetPath, 'files', 'user123', 'x', 'file.bin');
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.writeFileSync(dest, 'already here');

    const storage = fakeStore({
      captureMedia: [{ storage_path: storagePath, content_type: 'application/octet-stream' }],
    });
    await callExport({ storage, targetPath, force: true });
    expect(storage.downloadMedia).not.toHaveBeenCalled();
    expect(fs.readFileSync(dest, 'utf8')).toBe('already here');
  });
});

describe('exportBackup — manifest & summary', () => {
  test('writes manifest with lastRunAt and counts, and returns a summary', async () => {
    const targetPath = tmpTarget();
    const now = new Date('2026-07-21T12:00:00Z');
    const storage = fakeStore({
      todos: [{ name: 't1', status: 'active' }, { name: 't2', status: 'inbox' }],
      knowledge: [{ path: 'a.md', content: 'x' }],
      captures: [{ id: 'c1', text: 'hi' }],
    });

    seedRepo(targetPath);
    const result = await exportBackup({ storage, targetPath, force: true, now, git: fakeGit() });

    const manifest = readJSON(path.join(targetPath, 'manifest.json'));
    expect(manifest.lastRunAt).toBe('2026-07-21T12:00:00.000Z');
    expect(manifest.counts.todos).toBe(2);
    expect(manifest.counts.knowledge).toBe(1);
    expect(manifest.counts.captures).toBe(1);

    expect(result.skipped).toBe(false);
    expect(result.counts.todos).toBe(2);
    expect(typeof result.durationMs).toBe('number');
  });
});

describe('loadConfig', () => {
  test('reads targetPath and minIntervalDays from a config file', () => {
    const dir = tmpTarget();
    const cfgPath = path.join(dir, 'backup.config.json');
    fs.writeFileSync(cfgPath, JSON.stringify({ targetPath: 'D:/brainy-backup', minIntervalDays: 7 }));
    const cfg = loadConfig(cfgPath);
    expect(cfg.targetPath).toBe('D:/brainy-backup');
    expect(cfg.minIntervalDays).toBe(7);
  });

  test('returns null targetPath when the config file is missing', () => {
    const cfg = loadConfig(path.join(tmpTarget(), 'does-not-exist.json'));
    expect(cfg.targetPath).toBeNull();
  });

  test('tolerates a UTF-8 BOM (Windows editors) instead of silently failing', () => {
    const cfgPath = path.join(tmpTarget(), 'backup.config.json');
    fs.writeFileSync(cfgPath, '﻿' + JSON.stringify({ targetPath: 'D:/b', minIntervalDays: 5 }));
    const cfg = loadConfig(cfgPath);
    expect(cfg.targetPath).toBe('D:/b');
    expect(cfg.minIntervalDays).toBe(5);
  });
});

describe('formatBackupResult', () => {
  test('summarizes a completed run with the committed diff size', () => {
    const line = formatBackupResult({
      skipped: false,
      committed: true,
      targetPath: 'D:/brainy-backup',
      counts: { todos: 2, knowledge: 1, captures: 3, files: 4, filesDownloaded: 1 },
      git: { files: 3, insertions: 45, deletions: 2 },
      durationMs: 1800,
    });
    expect(line).toContain('2 todos');
    expect(line).toContain('D:/brainy-backup');
    expect(line).toContain('+45');
    expect(line).toContain('-2');
  });

  test('notes when a completed run had no changes to commit', () => {
    const line = formatBackupResult({
      skipped: false,
      committed: false,
      targetPath: 'D:/brainy-backup',
      counts: { todos: 2, knowledge: 1, captures: 3, files: 4, filesDownloaded: 0 },
      git: { files: 0, insertions: 0, deletions: 0 },
      durationMs: 40,
    });
    expect(line.toLowerCase()).toContain('no content changes');
  });

  test('summarizes a skipped run with the reason', () => {
    const line = formatBackupResult({ skipped: true, reason: 'last backup 0.5d ago (< 3d interval)' });
    expect(line.toLowerCase()).toContain('skip');
    expect(line).toContain('0.5d ago');
  });
});
