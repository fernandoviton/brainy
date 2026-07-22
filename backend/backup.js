/**
 * Backup engine — exports the entire Brainy store to a local folder tree.
 *
 * Intended to run on session start (throttled by minIntervalDays) so a fresh,
 * off-platform copy of the store exists on a Carbonite-backed drive. It is a
 * plain file dump: text as text (knowledge/todos are markdown), binaries pulled
 * down from Storage, and a manifest.json recording the last run + counts.
 *
 * The engine talks to storage only through two methods so it stays unit-testable
 * with a mock:
 *   - storage.exportAll()          -> full rows of every brainy_* table
 *   - storage.downloadMedia(path)  -> Buffer for a Storage object
 */
const fs = require('fs');
const path = require('path');
const { realGit } = require('./git-utils');

const MANIFEST_VERSION = 1;
const MANIFEST_FILE = 'manifest.json';
const DAY_MS = 24 * 60 * 60 * 1000;

// Marker file identifying a folder as a Brainy backup repo, so we never write
// into an unrelated git repo that happens to sit at the target path.
const SENTINEL = '.brainy-backup';
const SENTINEL_CONTENT =
  'This folder is a Brainy backup repository, managed by backend/backup.js.\n' +
  'Do not remove this file — Brainy refuses to write into a repo without it.\n';

function readManifest(targetPath) {
  try {
    return JSON.parse(fs.readFileSync(path.join(targetPath, 'manifest.json'), 'utf8'));
  } catch {
    return null;
  }
}

function writeFile(targetPath, relParts, content) {
  const dest = path.join(targetPath, ...relParts);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.writeFileSync(dest, content);
}

// Split a stored path ("a/b/c.md") into segments so it maps onto the local
// filesystem regardless of OS separator.
function segments(p) {
  return String(p).split('/').filter(Boolean);
}

function todoToMarkdown(todo) {
  const fields = [
    'name', 'status', 'priority', 'category',
    'created_date', 'due', 'scheduled_date', 'blocked_by',
  ];
  const lines = ['---'];
  for (const f of fields) {
    if (todo[f] === undefined || todo[f] === null) continue;
    const value = Array.isArray(todo[f]) ? JSON.stringify(todo[f]) : todo[f];
    lines.push(`${f}: ${value}`);
  }
  if (todo.summary) lines.push(`summary: ${todo.summary}`);
  lines.push('---', '');
  lines.push(todo.notes || '');
  return lines.join('\n');
}

// The target must be a git repo so each backup is a commit (local history).
// If it isn't one yet, initialize it — but only when it's empty, so we never
// take over a folder that already holds unrelated files. A sentinel file marks
// the folder as ours; an existing repo without it is treated as someone else's
// and refused.
function ensureRepo(targetPath, git) {
  fs.mkdirSync(targetPath, { recursive: true });
  const sentinelPath = path.join(targetPath, SENTINEL);
  const hasSentinel = fs.existsSync(sentinelPath);

  if (git.isRepo(targetPath)) {
    if (!hasSentinel) {
      throw new Error(
        `Backup target ${targetPath} is a git repo but not a Brainy backup ` +
        `(missing ${SENTINEL}). Refusing to write into it. Point backup at an empty ` +
        `folder or an existing Brainy backup repo.`
      );
    }
    return;
  }

  const entries = fs.readdirSync(targetPath).filter((e) => e !== SENTINEL);
  if (entries.length > 0) {
    throw new Error(
      `Backup target ${targetPath} is not a git repo and is not empty. ` +
      `Point backup at an empty folder (it will be git-initialized) or an existing backup repo.`
    );
  }
  git.init(targetPath);
  if (!hasSentinel) fs.writeFileSync(sentinelPath, SENTINEL_CONTENT);
}

async function exportBackup({
  storage,
  targetPath,
  minIntervalDays = 3,
  force = false,
  now = new Date(),
  git = realGit(),
}) {
  const started = Date.now();
  const manifest = readManifest(targetPath);

  if (!force && manifest && manifest.lastRunAt) {
    const ageDays = (now.getTime() - new Date(manifest.lastRunAt).getTime()) / DAY_MS;
    if (ageDays < minIntervalDays) {
      return {
        skipped: true,
        reason: `last backup ${ageDays.toFixed(1)}d ago (< ${minIntervalDays}d interval)`,
        lastRunAt: manifest.lastRunAt,
      };
    }
  }

  if (!git.available()) {
    throw new Error(
      'git was not found on PATH. Backup writes a local git repo, so git is required — ' +
      'install it (https://git-scm.com/downloads) and ensure `git` runs from a terminal.'
    );
  }
  ensureRepo(targetPath, git);

  const data = await storage.exportAll();
  fs.mkdirSync(targetPath, { recursive: true });

  // --- Knowledge (verbatim markdown) ---
  for (const k of data.knowledge || []) {
    writeFile(targetPath, ['knowledge', ...segments(k.path)], k.content || '');
  }

  // --- Todos (frontmatter + notes) + text collateral ---
  const todosById = new Map();
  for (const t of data.todos || []) {
    if (t.id) todosById.set(t.id, t.name);
    writeFile(targetPath, ['todos', `${t.name}.md`], todoToMarkdown(t));
  }
  for (const c of data.collateral || []) {
    if (c.text_content == null) continue; // binary handled below
    const todoName = todosById.get(c.todo_id) || c.todo_id || 'unknown';
    writeFile(targetPath, ['todos', todoName, 'collateral', c.filename], c.text_content);
  }

  // --- Captures + archives (structured JSON) ---
  for (const cap of data.captures || []) {
    writeFile(targetPath, ['captures', `${cap.id}.json`], JSON.stringify(cap, null, 2));
  }
  for (const a of data.archiveEntries || []) {
    const name = a.year_month ? `${a.year_month}-${a.todo_name}` : a.todo_name || a.id;
    writeFile(targetPath, ['archive', 'entries', `${name}.json`], JSON.stringify(a, null, 2));
  }
  for (const s of data.archiveSummaries || []) {
    writeFile(targetPath, ['archive', 'summaries', `${s.year_month}.md`], s.content || '');
  }

  // --- Binary files: download only what's missing (immutable by storage_path) ---
  const binaryRows = [
    ...(data.collateral || []).filter((c) => c.storage_path),
    ...(data.captureMedia || []),
    ...(data.knowledgeAttachments || []),
  ];
  const seen = new Set();
  let filesDownloaded = 0;
  for (const row of binaryRows) {
    const sp = row.storage_path;
    if (!sp || seen.has(sp)) continue;
    seen.add(sp);
    const dest = path.join(targetPath, 'files', ...segments(sp));
    if (fs.existsSync(dest)) continue;
    const buffer = await storage.downloadMedia(sp);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.writeFileSync(dest, buffer);
    filesDownloaded += 1;
  }

  const counts = {
    todos: (data.todos || []).length,
    knowledge: (data.knowledge || []).length,
    captures: (data.captures || []).length,
    collateral: (data.collateral || []).length,
    knowledgeAttachments: (data.knowledgeAttachments || []).length,
    archiveEntries: (data.archiveEntries || []).length,
    files: seen.size,
    filesDownloaded,
  };

  const newManifest = {
    version: MANIFEST_VERSION,
    lastRunAt: now.toISOString(),
    counts,
  };
  writeFile(targetPath, [MANIFEST_FILE], JSON.stringify(newManifest, null, 2));

  // Commit the snapshot so the target repo carries local history. The reported
  // delta — and the decision to commit at all — ignores manifest.json, whose
  // timestamp changes every run; a run that only bumps the manifest is not a
  // real change and shouldn't create a noise commit.
  git.addAll(targetPath);
  const gitStats = git.diffStat(targetPath, [MANIFEST_FILE]);
  const hasChanges = gitStats.files > 0 || gitStats.insertions > 0 || gitStats.deletions > 0;
  if (hasChanges) {
    const stamp = now.toISOString().slice(0, 16).replace('T', ' ');
    git.commit(
      targetPath,
      `Backup ${stamp}Z — ${counts.todos} todos, ${counts.knowledge} knowledge, ${counts.captures} captures`
    );
  }

  return {
    skipped: false,
    targetPath,
    counts,
    filesDownloaded,
    committed: hasChanges,
    git: gitStats,
    durationMs: Date.now() - started,
  };
}

function loadConfig(configPath) {
  let raw = {};
  try {
    // Strip a leading UTF-8 BOM — Windows editors add one and JSON.parse chokes.
    raw = JSON.parse(fs.readFileSync(configPath, 'utf8').replace(/^﻿/, ''));
  } catch {
    raw = {};
  }
  return {
    targetPath: raw.targetPath || null,
    minIntervalDays: raw.minIntervalDays != null ? raw.minIntervalDays : 3,
  };
}

function formatBackupResult(result) {
  if (result.skipped) {
    return `🧠 Backup skipped — ${result.reason}`;
  }
  const c = result.counts || {};
  const g = result.git || {};
  const commitPart = result.committed
    ? `committed +${g.insertions || 0}/-${g.deletions || 0} across ${g.files || 0} files`
    : 'no content changes to commit';
  return (
    `🧠 Backup complete — ${c.todos || 0} todos, ${c.knowledge || 0} knowledge, ` +
    `${c.captures || 0} captures, ${c.files || 0} files (${c.filesDownloaded || 0} new) · ` +
    `${commitPart} → ${result.targetPath} (${result.durationMs}ms)`
  );
}

module.exports = { exportBackup, todoToMarkdown, loadConfig, formatBackupResult };
