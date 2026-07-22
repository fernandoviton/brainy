const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const { exportBackup } = require('../backend/backup');
const { realGit, parseShortstat } = require('../backend/git-utils');

function tmpTarget() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'brainy-backup-git-'));
}

function git(dir, args) {
  return spawnSync('git', args, { cwd: dir, encoding: 'utf8' }).stdout.trim();
}

function fakeStore(overrides = {}) {
  const data = {
    todos: [], collateral: [], knowledge: [], knowledgeAttachments: [],
    archiveEntries: [], archiveSummaries: [], captures: [], captureMedia: [],
    ...overrides,
  };
  return {
    exportAll: jest.fn(async () => data),
    downloadMedia: jest.fn(async (p) => Buffer.from(`binary:${p}`)),
  };
}

describe('parseShortstat', () => {
  test('parses files/insertions/deletions', () => {
    expect(parseShortstat(' 3 files changed, 45 insertions(+), 2 deletions(-)')).toEqual({
      files: 3, insertions: 45, deletions: 2,
    });
  });
  test('handles singular and partial forms', () => {
    expect(parseShortstat(' 1 file changed, 1 insertion(+)')).toEqual({
      files: 1, insertions: 1, deletions: 0,
    });
    expect(parseShortstat('')).toEqual({ files: 0, insertions: 0, deletions: 0 });
  });
});

describe('exportBackup with real git', () => {
  test('inits an empty target and commits the exported tree', async () => {
    const targetPath = tmpTarget();
    const storage = fakeStore({
      todos: [{ name: 't1', status: 'active', notes: 'hello' }],
      knowledge: [{ path: 'a.md', content: 'body' }],
    });

    const result = await exportBackup({ storage, targetPath, force: true, git: realGit() });

    expect(fs.existsSync(path.join(targetPath, '.git'))).toBe(true);
    expect(fs.existsSync(path.join(targetPath, '.brainy-backup'))).toBe(true);
    expect(result.committed).toBe(true);
    expect(result.git.insertions).toBeGreaterThan(0);
    // Exactly one commit exists.
    expect(git(targetPath, ['rev-list', '--count', 'HEAD'])).toBe('1');
    // The exported files and the sentinel are tracked.
    const tracked = git(targetPath, ['ls-files']);
    expect(tracked).toContain('knowledge/a.md');
    expect(tracked).toContain('todos/t1.md');
    expect(tracked).toContain('.brainy-backup');
  });

  test('refuses an existing git repo that is not a Brainy backup', async () => {
    const targetPath = tmpTarget();
    spawnSync('git', ['init'], { cwd: targetPath }); // a real repo, no sentinel
    await expect(
      exportBackup({ storage: fakeStore(), targetPath, force: true, git: realGit() })
    ).rejects.toThrow(/brainy/i);
  });

  test('a second run commits again only when content changed', async () => {
    const targetPath = tmpTarget();
    const storage = fakeStore({ knowledge: [{ path: 'a.md', content: 'v1' }] });

    await exportBackup({ storage, targetPath, force: true, git: realGit() });
    // No content change except the manifest timestamp -> still a commit, but a
    // real content change should be reflected in a new commit too.
    storage.exportAll.mockResolvedValue({
      todos: [], collateral: [], knowledge: [{ path: 'a.md', content: 'v2 changed' }],
      knowledgeAttachments: [], archiveEntries: [], archiveSummaries: [],
      captures: [], captureMedia: [],
    });
    const second = await exportBackup({ storage, targetPath, force: true, git: realGit() });

    expect(second.committed).toBe(true);
    expect(Number(git(targetPath, ['rev-list', '--count', 'HEAD']))).toBeGreaterThanOrEqual(2);
    expect(fs.readFileSync(path.join(targetPath, 'knowledge', 'a.md'), 'utf8')).toBe('v2 changed');
  });

  test('does not commit (and reports no content changes) when only the manifest changed', async () => {
    const targetPath = tmpTarget();
    const storage = fakeStore({ knowledge: [{ path: 'a.md', content: 'stable' }] });

    await exportBackup({ storage, targetPath, force: true, git: realGit() });
    // Same store on the second run → only manifest.json's timestamp differs.
    const second = await exportBackup({ storage, targetPath, force: true, git: realGit() });

    expect(second.committed).toBe(false);
    expect(second.git).toEqual({ files: 0, insertions: 0, deletions: 0 });
    // Still exactly one commit — no manifest-only noise commit.
    expect(git(targetPath, ['rev-list', '--count', 'HEAD'])).toBe('1');
  });

  test('refuses a non-empty, non-repo target', async () => {
    const targetPath = tmpTarget();
    fs.writeFileSync(path.join(targetPath, 'stray.txt'), 'existing junk');
    await expect(
      exportBackup({ storage: fakeStore(), targetPath, force: true, git: realGit() })
    ).rejects.toThrow(/empty/i);
  });
});
