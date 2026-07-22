#!/usr/bin/env node
/**
 * Brainy CLI — unified interface for both file and Supabase backends.
 * Run with "help" or "<resource> help" for usage details.
 */
const fs = require('fs');
const path = require('path');
const { getStorage } = require('./storage');
const captureService = require('./capture-service');

const HELP = {
  main: `Usage: node backend/cli.js <resource> [action] [options]

Resources:
  todo                 Manage TODOs (CRUD, archive, collateral)
  capture              Manage captures (list, get, media, process, delete)
  knowledge            Manage knowledge entries (list, get, upsert)
  check-integrity      Run data integrity checks
  promote-scheduled    Promote scheduled TODOs whose date has arrived
  backup               Export the whole store to a local folder [--target <p>] [--force] [--config <p>]

Run "node backend/cli.js <resource> help" for details on each resource.
All commands support --format json for machine-readable output.`,

  todo: `Usage: node backend/cli.js todo <action> [options]

Actions:
  list [--status <status>] [--all]                 List active TODOs (default); --all for all statuses, --status to filter
  get <name>                                       Get full TODO details (notes, collateral)
  create --name <n> --summary <s> [--status <s>]   Create a new TODO
           [--priority <p>] [--category <c>]
           [--due <date>] [--scheduled-date <date>]
  update <name> [--summary <s>] [--status <s>]     Update TODO fields
           [--priority <p>] [--category <c>]
           [--due <d>] [--scheduled-date <d>]
           [--blocked-by <name>]
           [--field notes --file <path>]            Set notes from a UTF-8 file (preferred; encoding-safe)
           [--field notes --stdin]                  Pipe notes via stdin (guarded against '?' corruption)
  delete <name>                                    Delete a TODO
  archive <name> [--summary-text <t>]              Archive a completed TODO
           [--completion-date <d>]
  collateral list <name>                           List collateral files
  collateral add <name> <filepath> [--replace]    Attach a file (--replace to overwrite existing)
  collateral remove <name> <filename>              Remove an attachment
  collateral get <name> <filename>                 Get collateral content

Statuses: inbox, active, later, scheduled
Priorities: P0 (urgent), P1 (high), P2 (medium), P3 (low)`,

  capture: `Usage: node backend/cli.js capture <action> [options]

Actions:
  list [--all]          List unprocessed captures (--all includes processed)
  get <id>              Get capture details including media
  media <capture_id>    Get signed download URLs for media (1hr expiry)
  process <id>          Mark a capture as processed
  delete <id>           Delete a capture (processed or unprocessed) and its media`,

  knowledge: `Usage: node backend/cli.js knowledge <action> [options]

Actions:
  list [--prefix <path>]       List knowledge entries, optionally filtered by path prefix
  get <path>                   Get knowledge content
  upsert <path> --file <path>  Create or update knowledge from a UTF-8 file (preferred; encoding-safe)
  upsert <path> --stdin        Create or update knowledge via stdin (guarded against '?' corruption)
           [--topic <t>] [--summary <s>]`,
};

function showHelp(resource) {
  console.log(HELP[resource] || HELP.main);
}

function parseArgs(argv) {
  const args = {};
  const positional = [];
  let i = 0;
  while (i < argv.length) {
    if (argv[i] === '-h') {
      args.help = true;
      i += 1;
    } else if (argv[i].startsWith('--')) {
      const key = argv[i].replace(/^--/, '').replace(/-([a-z])/g, (_, c) => c.toUpperCase());
      if (i + 1 < argv.length && !argv[i + 1].startsWith('--')) {
        args[key] = argv[i + 1];
        i += 2;
      } else {
        args[key] = true;
        i += 1;
      }
    } else {
      positional.push(argv[i]);
      i += 1;
    }
  }
  return { args, positional };
}

// cp1252 0x80-0x9F → Unicode (rest of the range is identical to ISO-8859-1).
const CP1252_C1 = {
  0x80: 0x20AC, 0x82: 0x201A, 0x83: 0x0192, 0x84: 0x201E, 0x85: 0x2026,
  0x86: 0x2020, 0x87: 0x2021, 0x88: 0x02C6, 0x89: 0x2030, 0x8A: 0x0160,
  0x8B: 0x2039, 0x8C: 0x0152, 0x8E: 0x017D,
  0x91: 0x2018, 0x92: 0x2019, 0x93: 0x201C, 0x94: 0x201D, 0x95: 0x2022,
  0x96: 0x2013, 0x97: 0x2014, 0x98: 0x02DC, 0x99: 0x2122, 0x9A: 0x0161,
  0x9B: 0x203A, 0x9C: 0x0153, 0x9E: 0x017E, 0x9F: 0x0178,
};

function decodeCp1252(buf) {
  let out = '';
  for (const b of buf) {
    out += String.fromCharCode(CP1252_C1[b] !== undefined ? CP1252_C1[b] : b);
  }
  return out;
}

function readStdin() {
  return new Promise((resolve) => {
    if (process.stdin.isTTY) {
      resolve('');
      return;
    }
    const chunks = [];
    process.stdin.on('data', (chunk) => {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    });
    process.stdin.on('end', () => {
      let buf = chunks.length === 1 ? chunks[0] : Buffer.concat(chunks);
      if (buf.length >= 3 && buf[0] === 0xEF && buf[1] === 0xBB && buf[2] === 0xBF) {
        buf = buf.subarray(3);
      }
      try {
        resolve(new TextDecoder('utf-8', { fatal: true }).decode(buf));
      } catch (_) {
        console.error(`[cli] stdin was not valid UTF-8; decoded as cp1252 (${buf.length} bytes)`);
        resolve(decodeCp1252(buf));
      }
    });
  });
}

// Signature of PowerShell's lossy console down-conversion: when [Console]::
// OutputEncoding is not UTF-8, non-ASCII chars (en-dash 23–25, em-dash, bullets
// ••••) are flattened to literal '?' (0x3F) BEFORE they reach the CLI, so the
// data is already destroyed — no decoder can recover it. We can only detect the
// telltale pattern and refuse to persist it. Matches digit?digit ranges, runs of
// '?', and space-?-space (flattened dashes); deliberately ignores a lone trailing
// '?' and URL query strings (a?b / p?q) to avoid false positives on real prose.
const ENCODING_CORRUPTION_RE = /\?{2,}|\d\s?\?\s?\d|\s\?\s/;

function detectEncodingCorruption(text) {
  return typeof text === 'string' && ENCODING_CORRUPTION_RE.test(text);
}

function stripBom(s) {
  return s.charCodeAt(0) === 0xFEFF ? s.slice(1) : s;
}

// Resolve text content for --stdin / --file inputs. --file is the encoding-safe
// path (fs read never touches the Windows console code page), so it is trusted as
// authored. --stdin is guarded: corrupted content is rejected, steering the
// author to re-write to a UTF-8 file and pass --file instead.
async function readContentInput(args, label) {
  if (args.file) {
    return stripBom(fs.readFileSync(args.file, 'utf8'));
  }
  const content = await readStdin();
  if (detectEncodingCorruption(content)) {
    console.error(
      `[cli] Refusing to write ${label}: the piped content contains '?' runs that look like ` +
      `encoding corruption (e.g. an en-dash/bullet flattened to '?' by PowerShell's console ` +
      `encoder). The original characters are already lost in the pipe and cannot be recovered.\n` +
      `Fix: write the content to a UTF-8 file (e.g. under tmp/) and pass --file <path> instead of --stdin. ` +
      `If the '?' are genuinely intended, --file bypasses this check.`,
    );
    process.exit(1);
  }
  return content;
}

function output(data, format) {
  if (format === 'json') {
    console.log(JSON.stringify(data, null, 2));
  } else if (Array.isArray(data)) {
    for (const item of data) {
      if (item.name && item.summary) {
        console.log(`- **${item.name}** — ${item.summary} [${item.status}] ${item.priority || ''}`);
      } else if (item.id && item.text !== undefined) {
        const short = item.id.substring(0, 8);
        const text = (item.text || '').length > 80 ? item.text.substring(0, 80) + '...' : (item.text || '(empty)');
        const status = item.processed_at ? 'processed' : 'unprocessed';
        const mediaCount = item.media?.length ? ` [${item.media.length} file${item.media.length !== 1 ? 's' : ''}]` : '';
        console.log(`- [${short}] ${text} [${status}]${mediaCount} ${item.created_at}`);
      } else if (item.path) {
        console.log(`  ${item.path}`);
      } else {
        console.log(JSON.stringify(item));
      }
    }
  } else if (data && typeof data === 'object') {
    if (data.name && data.notes !== undefined) {
      // Full TODO view
      console.log(`# ${data.name}`);
      console.log(`Status: ${data.status} | Priority: ${data.priority} | Category: ${data.category}`);
      if (data.due) console.log(`Due: ${data.due}`);
      if (data.scheduled_date) console.log(`Scheduled: ${data.scheduled_date}`);
      if (data.blocked_by?.length) console.log(`Blocked by: ${data.blocked_by.join(', ')}`);
      if (data.collateral?.length) {
        const names = data.collateral.map((c) => typeof c === 'string' ? c : c.filename);
        console.log(`Collateral: ${names.join(', ')}`);
      }
      if (data.notes) console.log(`\n${data.notes}`);
    } else if (data.id && data.text !== undefined) {
      // Capture detail view
      console.log(`ID: ${data.id}`);
      console.log(`Text: ${data.text || '(empty)'}`);
      console.log(`Status: ${data.processed_at ? 'processed' : 'unprocessed'}`);
      if (data.processed_at) console.log(`Processed at: ${data.processed_at}`);
      console.log(`Created: ${data.created_at}`);
      if (data.media?.length) {
        console.log(`Media: ${data.media.map((m) => m.filename).join(', ')}`);
      }
    } else if (data.content !== undefined) {
      // Knowledge view
      console.log(data.content);
    } else {
      console.log(JSON.stringify(data, null, 2));
    }
  } else {
    console.log(data);
  }
}

async function main() {
  const { args, positional } = parseArgs(process.argv.slice(2));
  const [resource, action, ...rest] = positional;
  const storage = getStorage();
  const format = args.format;

  // Help short-circuit: a `--help`/`-h` flag anywhere, an explicit `help`
  // action, or a missing resource shows the relevant help and exits 0 BEFORE
  // any storage/network call — so e.g. `todo create --help` never mutates data.
  const KNOWN_RESOURCES = ['todo', 'capture', 'knowledge'];

  try {
    if (!resource || resource === 'help') {
      showHelp('main');
      return;
    }
    if (args.help) {
      showHelp(KNOWN_RESOURCES.includes(resource) ? resource : 'main');
      return;
    }

    if (resource === 'todo') {
      if (!action || action === 'help') { showHelp('todo'); return; }
      if (action === 'list') {
        const status = args.status || (args.all ? undefined : 'active');
        const result = await storage.listTodos(status);
        output(result, format);
      } else if (action === 'get') {
        const name = rest[0] || args.name;
        if (!name) { console.error('Usage: todo get <name>'); process.exit(1); }
        const result = await storage.getTodo(name);
        if (!result) { console.error(`TODO '${name}' not found`); process.exit(1); }
        output(result, format);
      } else if (action === 'create') {
        const result = await storage.createTodo({
          name: args.name,
          summary: args.summary || '',
          status: args.status,
          priority: args.priority,
          category: args.category,
          due: args.due,
          scheduled_date: args.scheduledDate,
          blocked_by: args.blockedBy,
        });
        console.log(`Created: ${result.name} [${result.status}]`);
      } else if (action === 'update') {
        const name = rest[0] || args.name;
        if (!name) { console.error('Usage: todo update <name> [--field value]'); process.exit(1); }
        const changes = {};
        if (args.summary !== undefined) changes.summary = args.summary;
        if (args.status) changes.status = args.status;
        if (args.priority) changes.priority = args.priority;
        if (args.category) changes.category = args.category;
        if (args.due !== undefined) changes.due = args.due || null;
        if (args.scheduledDate !== undefined) changes.scheduled_date = args.scheduledDate || null;
        if (args.blockedBy !== undefined) changes.blocked_by = args.blockedBy || null;
        if (args.field === 'notes' && (args.stdin || args.file)) {
          changes.notes = await readContentInput(args, 'notes');
        }
        const result = await storage.updateTodo(name, changes);
        console.log(`Updated: ${result.name} [${result.status}]`);
      } else if (action === 'delete') {
        const name = rest[0] || args.name;
        if (!name) { console.error('Usage: todo delete <name>'); process.exit(1); }
        await storage.deleteTodo(name);
        console.log(`Deleted: ${name}`);
      } else if (action === 'collateral') {
        const [subAction, ...subRest] = rest;
        if (subAction === 'list') {
          const name = subRest[0];
          if (!name) { console.error('Usage: todo collateral list <name>'); process.exit(1); }
          const result = await storage.listCollateral(name);
          if (format === 'json') {
            output(result, format);
          } else {
            for (const c of result) {
              console.log(`- ${c.filename} (${c.content_type}) [${c.is_text ? 'text' : 'binary'}]`);
            }
          }
        } else if (subAction === 'add') {
          const name = subRest[0];
          const filepath = subRest[1];
          if (!name || !filepath) { console.error('Usage: todo collateral add <name> <filepath> [--replace]'); process.exit(1); }
          const result = await storage.addCollateral(name, filepath, { replace: !!args.replace });
          const verb = result.replaced ? 'Replaced' : 'Added';
          console.log(`${verb}: ${result.filename} (${result.content_type}) [${result.is_text ? 'text' : 'binary'}]`);
        } else if (subAction === 'remove') {
          const name = subRest[0];
          const filename = subRest[1];
          if (!name || !filename) { console.error('Usage: todo collateral remove <name> <filename>'); process.exit(1); }
          const result = await storage.removeCollateral(name, filename);
          console.log(`Removed: ${result.filename}`);
        } else if (subAction === 'get') {
          const name = subRest[0];
          const filename = subRest[1];
          if (!name || !filename) { console.error('Usage: todo collateral get <name> <filename>'); process.exit(1); }
          const result = await storage.getCollateral(name, filename);
          if (format === 'json') {
            output(result, format);
          } else if (result.text_content !== undefined) {
            console.log(result.text_content);
          } else {
            console.log(`${result.filename} (${result.content_type}): ${result.url}`);
          }
        } else {
          console.error(`Unknown collateral action: ${subAction}`);
          process.exit(1);
        }
      } else if (action === 'archive') {
        const name = rest[0] || args.name;
        if (!name) { console.error('Usage: todo archive <name>'); process.exit(1); }
        const result = await storage.archiveTodo(name, {
          summaryText: args.summaryText,
          completionDate: args.completionDate,
        });
        console.log(`Archived: ${result.name} -> ${result.year_month}`);
      } else {
        console.error(`Unknown todo action: ${action}\n`);
        showHelp('todo');
        process.exit(1);
      }
    } else if (resource === 'capture') {
      if (!action || action === 'help') { showHelp('capture'); return; }
      if (action === 'list') {
        const all = args.all || undefined;
        const result = await captureService.listCapturesWithMedia(all);
        output(result, format);
      } else if (action === 'get') {
        const id = rest[0];
        if (!id) { console.error('Usage: capture get <id>'); process.exit(1); }
        const result = await captureService.getCapture(id);
        if (!result) { console.error(`Capture '${id}' not found`); process.exit(1); }
        output(result, format);
      } else if (action === 'media') {
        const id = rest[0];
        if (!id) { console.error('Usage: capture media <capture_id>'); process.exit(1); }
        const result = await captureService.getCaptureMediaUrls(id);
        if (result === null) { console.error(`Capture '${id}' not found`); process.exit(1); }
        if (!result.length) { console.log('No media attached to this capture.'); return; }
        if (format === 'json') {
          console.log(JSON.stringify(result, null, 2));
        } else {
          for (const m of result) {
            console.log(`${m.filename} (${m.content_type}): ${m.url}`);
          }
        }
      } else if (action === 'process') {
        const id = rest[0];
        if (!id) { console.error('Usage: capture process <id>'); process.exit(1); }
        const result = await captureService.processCapture(id);
        console.log(`Processed: ${result.id}`);
      } else if (action === 'delete') {
        const id = rest[0];
        if (!id) { console.error('Usage: capture delete <id>'); process.exit(1); }
        const result = await captureService.deleteCapture(id);
        if (result === null) { console.error(`Capture '${id}' not found`); process.exit(1); }
        console.log(`Deleted: ${result.id}`);
      } else {
        console.error(`Unknown capture action: ${action}\n`);
        showHelp('capture');
        process.exit(1);
      }
    } else if (resource === 'knowledge') {
      if (!action || action === 'help') { showHelp('knowledge'); return; }
      if (action === 'list') {
        const result = await storage.listKnowledge(args.prefix || undefined);
        output(result, format);
      } else if (action === 'get') {
        const kPath = rest[0] || args.path;
        if (!kPath) { console.error('Usage: knowledge get <path>'); process.exit(1); }
        const result = await storage.getKnowledge(kPath);
        if (!result) { console.error(`Knowledge '${kPath}' not found`); process.exit(1); }
        output(result, format);
      } else if (action === 'upsert') {
        const upsertPath = rest[0] || args.path;
        if (!upsertPath) { console.error('Usage: knowledge upsert <path> --stdin'); process.exit(1); }
        const content = (args.stdin || args.file) ? await readContentInput(args, 'knowledge content') : '';
        const result = await storage.upsertKnowledge({
          path: upsertPath,
          content,
          topic: args.topic,
          summary: args.summary,
        });
        console.log(`Upserted: ${result.path}`);
      } else {
        console.error(`Unknown knowledge action: ${action}\n`);
        showHelp('knowledge');
        process.exit(1);
      }
    } else if (resource === 'check-integrity') {
      const result = await storage.checkIntegrity();
      if (result.ok) {
        console.log('Integrity check passed.');
      } else {
        console.log('Integrity check failed:');
        for (const err of result.errors) {
          console.log(`  - ${err}`);
        }
        process.exit(2);
      }
    } else if (resource === 'promote-scheduled') {
      const promoted = await storage.promoteScheduled();
      if (promoted.length === 0) {
        console.log('No scheduled items to promote.');
      } else {
        console.log(`Promoted ${promoted.length} item(s): ${promoted.join(', ')}`);
      }
    } else if (resource === 'backup') {
      const { exportBackup, loadConfig, formatBackupResult } = require('./backup');
      const configPath = args.config || path.join(__dirname, '..', 'backup.config.json');
      const config = loadConfig(configPath);
      const targetPath = args.target || config.targetPath;
      if (!targetPath) {
        console.log(
          'Backup not configured — no target set. To enable local backups, copy ' +
          'backup.config.example.json to backup.config.json and set "targetPath" to an ' +
          'empty folder on a backed-up drive. See the "Backups" section in README.md.'
        );
        return;
      }
      const result = await exportBackup({
        storage,
        targetPath,
        minIntervalDays: config.minIntervalDays,
        force: !!args.force,
      });
      console.log(formatBackupResult(result));
    } else {
      console.error(`Unknown resource: ${resource}\n`);
      showHelp('main');
      process.exit(1);
    }
  } catch (err) {
    console.error(`Error: ${err.message}`);
    process.exit(1);
  }
}

module.exports = { main, detectEncodingCorruption };
if (require.main === module) {
  main();
}
