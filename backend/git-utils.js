/**
 * Thin git collaborator used by the backup engine. Kept behind an interface
 * (available/isRepo/init/addAll/diffStat/commit) so the engine can be unit-
 * tested with a fake; realGit() shells out to the git on PATH.
 */
const { spawnSync } = require('child_process');

function run(cwd, args) {
  const res = spawnSync('git', args, { cwd, encoding: 'utf8' });
  return {
    status: res.status,
    stdout: (res.stdout || '').trim(),
    stderr: (res.stderr || '').trim(),
    error: res.error,
  };
}

function parseShortstat(text) {
  const files = /(\d+) files? changed/.exec(text);
  const ins = /(\d+) insertions?\(\+\)/.exec(text);
  const del = /(\d+) deletions?\(-\)/.exec(text);
  return {
    files: files ? Number(files[1]) : 0,
    insertions: ins ? Number(ins[1]) : 0,
    deletions: del ? Number(del[1]) : 0,
  };
}

function realGit() {
  return {
    available() {
      const res = spawnSync('git', ['--version'], { encoding: 'utf8' });
      return !res.error && res.status === 0;
    },
    isRepo(dir) {
      const res = run(dir, ['rev-parse', '--is-inside-work-tree']);
      return res.status === 0 && res.stdout === 'true';
    },
    init(dir) {
      const res = run(dir, ['init']);
      if (res.status !== 0) throw new Error(`git init failed: ${res.stderr || res.stdout}`);
    },
    addAll(dir) {
      const res = run(dir, ['add', '-A']);
      if (res.status !== 0) throw new Error(`git add failed: ${res.stderr || res.stdout}`);
    },
    diffStat(dir, exclude = []) {
      const args = ['diff', '--cached', '--shortstat'];
      if (exclude.length) {
        // `. :(exclude)<path>` = everything except the excluded pathspecs.
        args.push('--', '.', ...exclude.map((e) => `:(exclude)${e}`));
      }
      const res = run(dir, args);
      return parseShortstat(res.stdout);
    },
    commit(dir, message) {
      // Use an explicit identity so a fresh backup repo commits without
      // requiring machine-level git user config.
      const res = run(dir, [
        '-c', 'user.name=Brainy Backup',
        '-c', 'user.email=brainy@localhost',
        'commit', '-m', message,
      ]);
      if (res.status !== 0) throw new Error(`git commit failed: ${res.stderr || res.stdout}`);
    },
  };
}

module.exports = { realGit, parseShortstat };
