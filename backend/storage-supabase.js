/**
 * Supabase storage adapter.
 * Wraps Supabase queries behind the same interface as storage-file.js.
 */
const { supabase, login } = require('./supabase-client');
const { storageSafeFilename, assertSafeStorageKey } = require('./storage-keys');

let _userId = null;

async function getUserId() {
  if (_userId) return _userId;
  const user = await login();
  _userId = user.id;
  return _userId;
}

// Every write to brainy_files goes through here so unsafe keys are caught
// before they reach Supabase (see storage-keys.js).
async function uploadToStorage(storagePath, buffer, options) {
  assertSafeStorageKey(storagePath);
  const { error } = await supabase.storage.from('brainy_files').upload(storagePath, buffer, options);
  if (error) throw error;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

async function listTodos(status) {
  const userId = await getUserId();
  let query = supabase
    .from('brainy_todos')
    .select('name, summary, status, priority, category, created_date, due, scheduled_date, blocked_by')
    .eq('user_id', userId)
    .order('created_at', { ascending: true });

  if (status) {
    query = query.eq('status', status);
  }

  const { data, error } = await query;
  if (error) throw error;

  return data.map((row) => ({
    name: row.name,
    summary: row.summary || '',
    status: row.status,
    priority: row.priority || 'P2',
    category: row.category || 'uncategorized',
    created_date: row.created_date ? String(row.created_date) : null,
    due: row.due ? String(row.due) : null,
    scheduled_date: row.scheduled_date ? String(row.scheduled_date) : null,
    blocked_by: row.blocked_by || [],
  }));
}

async function getTodo(name) {
  const userId = await getUserId();
  const { data, error } = await supabase
    .from('brainy_todos')
    .select('*')
    .eq('user_id', userId)
    .eq('name', name)
    .single();

  if (error) {
    if (error.code === 'PGRST116') return null; // not found
    throw error;
  }

  // Fetch collateral
  const { data: collateral } = await supabase
    .from('brainy_todo_collateral')
    .select('filename, content_type, text_content')
    .eq('todo_id', data.id);

  return {
    name: data.name,
    summary: data.summary || '',
    status: data.status,
    priority: data.priority || 'P2',
    category: data.category || 'uncategorized',
    created_date: data.created_date ? String(data.created_date) : null,
    due: data.due ? String(data.due) : null,
    scheduled_date: data.scheduled_date ? String(data.scheduled_date) : null,
    blocked_by: data.blocked_by || [],
    notes: data.notes || null,
    collateral: (collateral || []).map((c) => ({
      filename: c.filename,
      content_type: c.content_type,
      is_text: c.text_content !== null,
    })),
  };
}

// A todo carries a scheduled_date if and only if its status is 'scheduled'.
// `due` is independent and always optional.
function assertScheduleInvariant(status, scheduled_date) {
  if (status === 'scheduled' && !scheduled_date) {
    throw new Error("status 'scheduled' requires a scheduled_date");
  }
  if (scheduled_date && status !== 'scheduled') {
    throw new Error("scheduled_date can only be set when status is 'scheduled'");
  }
}

async function createTodo({ name, summary, status, priority, category, due, scheduled_date, blocked_by, notes }) {
  const userId = await getUserId();
  status = status || 'inbox';
  assertScheduleInvariant(status, scheduled_date || null);

  const row = {
    user_id: userId,
    name,
    summary: summary || '',
    notes: notes ?? null,
    status,
    priority: priority || 'P2',
    category: category || 'uncategorized',
    created_date: new Date().toISOString().split('T')[0],
    due: due || null,
    scheduled_date: scheduled_date || null,
    blocked_by: blocked_by ? [].concat(blocked_by) : [],
  };

  const { error } = await supabase.from('brainy_todos').insert(row);
  if (error) throw error;

  return { name, status };
}

async function updateTodo(name, changes) {
  const userId = await getUserId();

  const updates = {};
  if (changes.summary !== undefined) updates.summary = changes.summary;
  if (changes.status) updates.status = changes.status;
  if (changes.priority) updates.priority = changes.priority;
  if (changes.category) updates.category = changes.category;
  if (changes.due !== undefined) updates.due = changes.due;
  if (changes.scheduled_date !== undefined) updates.scheduled_date = changes.scheduled_date;
  if (changes.blocked_by !== undefined) updates.blocked_by = changes.blocked_by ? [].concat(changes.blocked_by) : [];
  if (changes.notes !== undefined) updates.notes = changes.notes;

  // Enforce the scheduled_date invariant against the resulting state. Only read
  // the existing row when status or scheduled_date is actually changing.
  if (changes.status !== undefined || changes.scheduled_date !== undefined) {
    const { data: existing, error: readErr } = await supabase
      .from('brainy_todos')
      .select('status, scheduled_date')
      .eq('user_id', userId)
      .eq('name', name)
      .single();
    if (readErr) throw readErr;
    const cur = existing || {};
    const finalStatus = changes.status || cur.status;
    let finalScheduled = changes.scheduled_date !== undefined ? changes.scheduled_date : cur.scheduled_date;
    // Moving off 'scheduled' without mentioning the date clears the stale value.
    if (finalStatus !== 'scheduled' && changes.scheduled_date === undefined && cur.scheduled_date) {
      finalScheduled = null;
      updates.scheduled_date = null;
    }
    assertScheduleInvariant(finalStatus, finalScheduled || null);
  }

  const { data, error } = await supabase
    .from('brainy_todos')
    .update(updates)
    .eq('user_id', userId)
    .eq('name', name)
    .select('name, status')
    .single();

  if (error) throw error;
  return { name: data.name, status: data.status };
}

async function deleteTodo(name) {
  const userId = await getUserId();
  const { error } = await supabase
    .from('brainy_todos')
    .delete()
    .eq('user_id', userId)
    .eq('name', name);

  if (error) throw error;
  return { name, deleted: true };
}

async function archiveTodo(name, { summaryText, completionDate }) {
  const userId = await getUserId();
  completionDate = completionDate || new Date().toISOString().split('T')[0];
  const yearMonth = completionDate.substring(0, 7).replace('-', '_');

  // Get the full TODO
  const { data: todo, error: fetchErr } = await supabase
    .from('brainy_todos')
    .select('*')
    .eq('user_id', userId)
    .eq('name', name)
    .single();
  if (fetchErr) throw fetchErr;

  // Get collateral — preserve enough to render archived items identically
  // to live ones: filename, content_type, storage_path (for binary blobs,
  // which persist in storage past the cascade delete), text_content (for
  // text-only rows, which would otherwise be lost when the metadata row
  // is deleted).
  const { data: collateral } = await supabase
    .from('brainy_todo_collateral')
    .select('filename, content_type, storage_path, text_content')
    .eq('todo_id', todo.id);

  // Create archive entry
  const { error: archiveErr } = await supabase.from('brainy_archive_entries').insert({
    user_id: userId,
    todo_name: name,
    completion_date: completionDate,
    year_month: yearMonth,
    summary_text: summaryText || 'Completed.',
    todo_snapshot: { ...todo, id: undefined, user_id: undefined },
    collateral_snapshot: collateral?.length > 0 ? collateral : null,
  });
  if (archiveErr) throw archiveErr;

  // Update or create archive summary
  const { data: existingSummary } = await supabase
    .from('brainy_archive_summaries')
    .select('id, content')
    .eq('user_id', userId)
    .eq('year_month', yearMonth)
    .single();

  const newSection = `\n\n## ${name} (completed ${completionDate})\n\n${summaryText || 'Completed.'}\n`;

  if (existingSummary) {
    await supabase
      .from('brainy_archive_summaries')
      .update({ content: existingSummary.content.trimEnd() + newSection })
      .eq('id', existingSummary.id);
  } else {
    await supabase.from('brainy_archive_summaries').insert({
      user_id: userId,
      year_month: yearMonth,
      content: `# Archive — ${yearMonth.replace('_', '-')}` + newSection,
    });
  }

  // Delete the TODO (cascade deletes collateral)
  await supabase.from('brainy_todos').delete().eq('id', todo.id);

  return { name, archived: true, year_month: yearMonth };
}

async function listKnowledge(prefix) {
  const userId = await getUserId();
  let query = supabase
    .from('brainy_knowledge')
    .select('path, topic, summary')
    .eq('user_id', userId)
    .order('path');

  if (prefix) {
    query = query.like('path', `${prefix}%`);
  }

  const { data, error } = await query;
  if (error) throw error;

  return data.map((row) => ({
    path: row.path,
    topic: row.topic || '',
    summary: row.summary || '',
  }));
}

async function getKnowledge(knowledgePath) {
  const userId = await getUserId();
  const { data, error } = await supabase
    .from('brainy_knowledge')
    .select('*')
    .eq('user_id', userId)
    .eq('path', knowledgePath)
    .single();

  if (error) {
    if (error.code === 'PGRST116') return null;
    throw error;
  }

  return {
    path: data.path,
    topic: data.topic || '',
    summary: data.summary || '',
    content: data.content || '',
  };
}

async function upsertKnowledge({ path: knowledgePath, content, topic, summary }) {
  const userId = await getUserId();

  const row = {
    user_id: userId,
    path: knowledgePath,
    content,
    topic: topic || knowledgePath.split('/').pop().replace(/\.[^.]+$/, ''),
    summary: summary ?? null,
  };

  const { error } = await supabase
    .from('brainy_knowledge')
    .upsert(row, { onConflict: 'user_id,path' });
  if (error) throw error;

  return { path: knowledgePath, upserted: true };
}

// Full-store dump for backups. Bulk-selects every brainy_* table (including the
// archive tables, which have no other read path) scoped to the current user.
// Binary blobs are referenced by storage_path; the caller downloads them via
// downloadMedia. Keeping this here preserves the rule that only this file talks
// to Supabase.
async function exportAll() {
  const userId = await getUserId();

  async function all(table, columns) {
    const { data, error } = await supabase
      .from(table)
      .select(columns)
      .eq('user_id', userId);
    if (error) throw error;
    return data || [];
  }

  const [
    todos,
    collateral,
    knowledge,
    knowledgeAttachments,
    archiveEntries,
    archiveSummaries,
    captures,
    captureMedia,
    scheduledJobs,
  ] = await Promise.all([
    all('brainy_todos', '*'),
    all('brainy_todo_collateral', 'todo_id, filename, content_type, text_content, storage_path'),
    all('brainy_knowledge', 'path, topic, summary, content'),
    all('brainy_knowledge_attachments', 'path, filename, storage_path'),
    all('brainy_archive_entries', '*'),
    all('brainy_archive_summaries', 'year_month, content'),
    all('brainy_captures', '*'),
    all('brainy_capture_media', 'capture_id, filename, content_type, storage_path'),
    all('brainy_scheduled_jobs', '*'),
  ]);

  return {
    todos,
    collateral,
    knowledge,
    knowledgeAttachments,
    archiveEntries,
    archiveSummaries,
    captures,
    captureMedia,
    scheduledJobs,
  };
}

async function checkIntegrity() {
  const userId = await getUserId();
  const errors = [];

  // Fetch all todos
  const { data: todos, error } = await supabase
    .from('brainy_todos')
    .select('name, status, priority, category, blocked_by, scheduled_date')
    .eq('user_id', userId);
  if (error) throw error;

  const nameSet = new Set(todos.map((t) => t.name));

  // 1. Duplicate names (enforced by DB unique constraint, but check anyway)
  const nameCounts = {};
  for (const t of todos) {
    nameCounts[t.name] = (nameCounts[t.name] || 0) + 1;
  }
  for (const [name, count] of Object.entries(nameCounts)) {
    if (count > 1) {
      errors.push(`TODO '${name}' has ${count} duplicate entries`);
    }
  }

  // 2. Validate enums
  const validPriorities = ['P0', 'P1', 'P2', 'P3'];
  const validStatuses = ['inbox', 'active', 'later', 'scheduled'];
  for (const t of todos) {
    if (t.priority && !validPriorities.includes(t.priority)) {
      errors.push(`TODO '${t.name}': invalid priority '${t.priority}'`);
    }
    if (!validStatuses.includes(t.status)) {
      errors.push(`TODO '${t.name}': invalid status '${t.status}'`);
    }
  }

  // 5. Broken blocked_by references
  for (const t of todos) {
    if (t.blocked_by && t.blocked_by.length > 0) {
      for (const ref of t.blocked_by) {
        if (!nameSet.has(ref)) {
          errors.push(`TODO '${t.name}': blocked_by '${ref}' but that TODO doesn't exist`);
        }
      }
    }
  }

  // 6. Scheduled metadata
  for (const t of todos) {
    if (t.status === 'scheduled' && !t.scheduled_date) {
      errors.push(`TODO '${t.name}': status is 'scheduled' but missing scheduled_date`);
    }
  }

  // 7. Stale scheduled items
  const today = new Date().toISOString().split('T')[0];
  for (const t of todos) {
    if (t.status === 'scheduled' && t.scheduled_date && String(t.scheduled_date) <= today) {
      errors.push(`TODO '${t.name}': scheduled date ${t.scheduled_date} is in the past — promotion may have failed`);
    }
  }

  return { ok: errors.length === 0, errors };
}

async function promoteScheduled() {
  const userId = await getUserId();
  const today = new Date().toISOString().split('T')[0];

  const { data: scheduled, error } = await supabase
    .from('brainy_todos')
    .select('id, name')
    .eq('user_id', userId)
    .eq('status', 'scheduled')
    .lte('scheduled_date', today);

  if (error) throw error;
  if (!scheduled || scheduled.length === 0) return [];

  const ids = scheduled.map((t) => t.id);
  const { error: updateErr } = await supabase
    .from('brainy_todos')
    .update({ status: 'active', scheduled_date: null })
    .in('id', ids);

  if (updateErr) throw updateErr;

  return scheduled.map((t) => t.name);
}

// ---------------------------------------------------------------------------
// Captures
// ---------------------------------------------------------------------------

async function listCaptures(all) {
  const userId = await getUserId();
  let query = supabase
    .from('brainy_captures')
    .select('id, text, processed_at, created_at')
    .eq('user_id', userId)
    .order('created_at', { ascending: false });

  if (!all) {
    query = query.is('processed_at', null);
  }

  const { data, error } = await query;
  if (error) throw error;
  return data;
}

async function resolveCaptureId(id) {
  if (id.length === 36) return id;
  const userId = await getUserId();
  const { data, error } = await supabase
    .from('brainy_captures')
    .select('id')
    .eq('user_id', userId);

  if (error) throw error;
  const matches = data.filter(row => row.id.startsWith(id));
  if (matches.length === 0) return null;
  if (matches.length > 1) throw new Error(`Ambiguous capture ID prefix '${id}' — matches ${matches.length} captures`);
  return matches[0].id;
}

async function getCapture(id) {
  const userId = await getUserId();
  const { data, error } = await supabase
    .from('brainy_captures')
    .select('*')
    .eq('user_id', userId)
    .eq('id', id)
    .single();

  if (error) {
    if (error.code === 'PGRST116') return null;
    throw error;
  }

  const { data: media } = await supabase
    .from('brainy_capture_media')
    .select('id, filename, content_type, storage_path, created_at')
    .eq('user_id', userId)
    .eq('capture_id', data.id);

  return { ...data, media: media || [] };
}

async function listCaptureMedia(captureIds) {
  if (!captureIds.length) return [];
  const userId = await getUserId();
  const { data, error } = await supabase
    .from('brainy_capture_media')
    .select('id, capture_id, filename, content_type, storage_path, created_at')
    .eq('user_id', userId)
    .in('capture_id', captureIds);
  if (error) throw error;
  return data || [];
}

async function createSignedMediaUrls(storagePaths) {
  if (!storagePaths.length) return [];
  const { data, error } = await supabase.storage
    .from('brainy_files')
    .createSignedUrls(storagePaths, 3600);
  if (error) throw error;
  return data || [];
}

async function processCapture(id) {
  const userId = await getUserId();
  const { error } = await supabase
    .from('brainy_captures')
    .update({ processed_at: new Date().toISOString() })
    .eq('user_id', userId)
    .eq('id', id);

  if (error) throw error;
  return { id, processed: true };
}

async function deleteCapture(id) {
  const userId = await getUserId();

  const { data: media, error: mediaErr } = await supabase
    .from('brainy_capture_media')
    .select('storage_path')
    .eq('user_id', userId)
    .eq('capture_id', id);
  if (mediaErr) throw mediaErr;

  const paths = (media || []).map((m) => m.storage_path).filter(Boolean);
  if (paths.length) {
    const { error: removeErr } = await supabase.storage
      .from('brainy_files')
      .remove(paths);
    if (removeErr) throw removeErr;
  }

  // brainy_capture_media rows cascade-delete via the capture_id FK.
  const { error } = await supabase
    .from('brainy_captures')
    .delete()
    .eq('user_id', userId)
    .eq('id', id);
  if (error) throw error;

  return { id, deleted: true };
}

async function downloadMedia(storagePath) {
  const { data, error } = await supabase.storage
    .from('brainy_files')
    .download(storagePath);
  if (error) throw error;
  const arrayBuffer = await data.arrayBuffer();
  return Buffer.from(arrayBuffer);
}

async function uploadCaptureMedia({ captureId, filename, contentType, buffer }) {
  const userId = await getUserId();
  // The row keeps the display filename (convert-capture-pdfs pairs 'x.pdf' with
  // 'x.pdf.md' by name); only the key is made safe, as the web capture page does.
  const storagePath = `${userId}/captures/${captureId}/${storageSafeFilename(filename)}`;
  await uploadToStorage(storagePath, buffer, { contentType });

  const { error: insertErr } = await supabase
    .from('brainy_capture_media')
    .insert({
      user_id: userId,
      capture_id: captureId,
      filename,
      content_type: contentType,
      storage_path: storagePath,
    });
  if (insertErr) throw insertErr;

  return { filename, storage_path: storagePath };
}

// ---------------------------------------------------------------------------
// Collateral
// ---------------------------------------------------------------------------

async function listCollateral(todoName) {
  const userId = await getUserId();
  const { data: todo, error: todoErr } = await supabase
    .from('brainy_todos')
    .select('id')
    .eq('user_id', userId)
    .eq('name', todoName)
    .single();
  if (todoErr) throw todoErr;

  const { data, error } = await supabase
    .from('brainy_todo_collateral')
    .select('filename, content_type, text_content')
    .eq('todo_id', todo.id);
  if (error) throw error;

  return (data || []).map((c) => ({
    filename: c.filename,
    content_type: c.content_type,
    is_text: c.text_content !== null,
  }));
}

const TEXT_TYPES = new Set([
  'text/plain', 'text/markdown', 'text/html', 'text/css', 'text/csv',
  'text/xml', 'text/yaml', 'text/javascript',
  'application/json', 'application/yaml', 'application/xml',
  'application/javascript', 'application/x-yaml',
]);

const EXT_TO_CONTENT_TYPE = {
  '.txt': 'text/plain',
  '.md': 'text/markdown',
  '.html': 'text/html',
  '.htm': 'text/html',
  '.css': 'text/css',
  '.csv': 'text/csv',
  '.xml': 'text/xml',
  '.yml': 'text/yaml',
  '.yaml': 'text/yaml',
  '.js': 'text/javascript',
  '.json': 'application/json',
  '.ts': 'text/javascript',
  '.py': 'text/plain',
  '.sh': 'text/plain',
  '.bat': 'text/plain',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.pdf': 'application/pdf',
  '.webp': 'image/webp',
  '.heic': 'image/heic',
  '.mov': 'video/quicktime',
  '.mp4': 'video/mp4',
  '.zip': 'application/zip',
  '.doc': 'application/msword',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.xls': 'application/vnd.ms-excel',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
};

function isTextType(contentType) {
  if (!contentType) return false;
  return contentType.startsWith('text/') || TEXT_TYPES.has(contentType);
}

function detectContentType(filepath) {
  const ext = require('path').extname(filepath).toLowerCase();
  return EXT_TO_CONTENT_TYPE[ext] || 'application/octet-stream';
}

async function addCollateral(todoName, filepath, { replace = false } = {}) {
  const fs = require('fs/promises');
  const path = require('path');
  const userId = await getUserId();

  const { data: todo, error: todoErr } = await supabase
    .from('brainy_todos')
    .select('id')
    .eq('user_id', userId)
    .eq('name', todoName)
    .single();
  if (todoErr) throw todoErr;

  const filename = storageSafeFilename(path.basename(filepath));
  const contentType = detectContentType(filepath);

  const { data: existing, error: existingErr } = await supabase
    .from('brainy_todo_collateral')
    .select('id, storage_path')
    .eq('todo_id', todo.id)
    .eq('filename', filename)
    .maybeSingle();
  if (existingErr) throw existingErr;
  if (existing && !replace) {
    throw new Error(`Collateral '${filename}' already exists for todo '${todoName}'. Use --replace to overwrite.`);
  }

  if (isTextType(contentType)) {
    const textContent = await fs.readFile(filepath, 'utf-8');
    if (existing) {
      const { error } = await supabase
        .from('brainy_todo_collateral')
        .update({ content_type: contentType, text_content: textContent, storage_path: null })
        .eq('id', existing.id);
      if (error) throw error;
    } else {
      const { error } = await supabase.from('brainy_todo_collateral').insert({
        user_id: userId,
        todo_id: todo.id,
        filename,
        content_type: contentType,
        text_content: textContent,
      });
      if (error) throw error;
    }
    return { filename, content_type: contentType, is_text: true, replaced: !!existing };
  } else {
    const fileBuffer = await fs.readFile(filepath);
    const storagePath = `${userId}/${todo.id}/${filename}`;
    await uploadToStorage(storagePath, fileBuffer, { contentType, upsert: true });

    if (existing) {
      const { error } = await supabase
        .from('brainy_todo_collateral')
        .update({ content_type: contentType, storage_path: storagePath, text_content: null })
        .eq('id', existing.id);
      if (error) throw error;
    } else {
      const { error } = await supabase.from('brainy_todo_collateral').insert({
        user_id: userId,
        todo_id: todo.id,
        filename,
        content_type: contentType,
        storage_path: storagePath,
      });
      if (error) throw error;
    }
    return { filename, content_type: contentType, is_text: false, replaced: !!existing };
  }
}

async function removeCollateral(todoName, filename) {
  const userId = await getUserId();

  const { data: todo, error: todoErr } = await supabase
    .from('brainy_todos')
    .select('id')
    .eq('user_id', userId)
    .eq('name', todoName)
    .single();
  if (todoErr) throw todoErr;

  // Fetch the collateral row to check for storage_path
  const { data: collateral, error: fetchErr } = await supabase
    .from('brainy_todo_collateral')
    .select('id, storage_path')
    .eq('todo_id', todo.id)
    .eq('filename', filename)
    .single();
  if (fetchErr) throw fetchErr;

  // Delete from storage if binary
  if (collateral.storage_path) {
    await supabase.storage
      .from('brainy_files')
      .remove([collateral.storage_path]);
  }

  // Delete the row
  const { error } = await supabase
    .from('brainy_todo_collateral')
    .delete()
    .eq('id', collateral.id);
  if (error) throw error;

  return { filename, removed: true };
}

async function getCollateral(todoName, filename) {
  const userId = await getUserId();

  const { data: todo, error: todoErr } = await supabase
    .from('brainy_todos')
    .select('id')
    .eq('user_id', userId)
    .eq('name', todoName)
    .single();
  if (todoErr) throw todoErr;

  const { data: collateral, error: fetchErr } = await supabase
    .from('brainy_todo_collateral')
    .select('filename, content_type, text_content, storage_path')
    .eq('todo_id', todo.id)
    .eq('filename', filename)
    .single();
  if (fetchErr) throw fetchErr;

  if (collateral.text_content !== null) {
    return {
      filename: collateral.filename,
      content_type: collateral.content_type,
      text_content: collateral.text_content,
    };
  }

  // Binary — generate signed URL
  const urls = await createSignedMediaUrls([collateral.storage_path]);
  return {
    filename: collateral.filename,
    content_type: collateral.content_type,
    url: urls[0]?.signedUrl || urls[0]?.signedURL || null,
  };
}

// ---------------------------------------------------------------------------
// Knowledge attachments
// ---------------------------------------------------------------------------
// Files on a knowledge entry are always stored as binaries in brainy_files at
// <user>/knowledge/<entry folder>/<filename> (the layout of the existing rows).
// Entries in the same folder share that namespace, so uniqueness is checked by
// storage_path, not just per entry.

function knowledgeAttachmentLocation(userId, knowledgePath, filename) {
  const dir = require('path').posix.dirname(knowledgePath);
  const attachmentPath = dir === '.' ? filename : `${dir}/${filename}`;
  return { attachmentPath, storagePath: `${userId}/knowledge/${attachmentPath}` };
}

async function getKnowledgeId(userId, knowledgePath) {
  const { data, error } = await supabase
    .from('brainy_knowledge')
    .select('id')
    .eq('user_id', userId)
    .eq('path', knowledgePath)
    .single();
  if (error) {
    if (error.code === 'PGRST116') throw new Error(`Knowledge '${knowledgePath}' not found`);
    throw error;
  }
  return data.id;
}

async function getKnowledgeAttachmentRow(knowledgePath, filename, columns) {
  const userId = await getUserId();
  const knowledgeId = await getKnowledgeId(userId, knowledgePath);
  const { data, error } = await supabase
    .from('brainy_knowledge_attachments')
    .select(columns)
    .eq('knowledge_id', knowledgeId)
    .eq('filename', filename)
    .single();
  if (error) {
    if (error.code === 'PGRST116') {
      throw new Error(`Attachment '${filename}' not found on '${knowledgePath}'`);
    }
    throw error;
  }
  return data;
}

async function listKnowledgeAttachments(knowledgePath) {
  const userId = await getUserId();
  const knowledgeId = await getKnowledgeId(userId, knowledgePath);
  const { data, error } = await supabase
    .from('brainy_knowledge_attachments')
    .select('filename')
    .eq('knowledge_id', knowledgeId)
    .order('filename');
  if (error) throw error;

  return (data || []).map((a) => ({
    filename: a.filename,
    content_type: detectContentType(a.filename),
  }));
}

async function addKnowledgeAttachment(knowledgePath, filepath, { replace = false } = {}) {
  const fs = require('fs/promises');
  const path = require('path');
  // Read first so a bad local path fails before any network call.
  const fileBuffer = await fs.readFile(filepath);
  const userId = await getUserId();
  const knowledgeId = await getKnowledgeId(userId, knowledgePath);

  const filename = storageSafeFilename(path.basename(filepath));
  const contentType = detectContentType(filepath);
  const { attachmentPath, storagePath } = knowledgeAttachmentLocation(userId, knowledgePath, filename);

  const { data: existingRows, error: existingErr } = await supabase
    .from('brainy_knowledge_attachments')
    .select('id, knowledge_id')
    .eq('user_id', userId)
    .eq('storage_path', storagePath);
  if (existingErr) throw existingErr;
  const existing = (existingRows || [])[0];
  if (existing && existing.knowledge_id !== knowledgeId) {
    throw new Error(
      `'${attachmentPath}' is already attached to another knowledge entry in that folder. Rename the file and retry.`,
    );
  }
  if (existing && !replace) {
    throw new Error(`Attachment '${filename}' already exists on '${knowledgePath}'. Use --replace to overwrite.`);
  }

  await uploadToStorage(storagePath, fileBuffer, { contentType, upsert: true });

  if (!existing) {
    const { error } = await supabase.from('brainy_knowledge_attachments').insert({
      user_id: userId,
      knowledge_id: knowledgeId,
      path: attachmentPath,
      filename,
      storage_path: storagePath,
    });
    if (error) throw error;
  }

  return { filename, content_type: contentType, replaced: !!existing };
}

async function removeKnowledgeAttachment(knowledgePath, filename) {
  const attachment = await getKnowledgeAttachmentRow(knowledgePath, filename, 'id, storage_path');

  const { error: removeErr } = await supabase.storage
    .from('brainy_files')
    .remove([attachment.storage_path]);
  if (removeErr) throw removeErr;

  const { error } = await supabase
    .from('brainy_knowledge_attachments')
    .delete()
    .eq('id', attachment.id);
  if (error) throw error;

  return { filename, removed: true };
}

async function getKnowledgeAttachment(knowledgePath, filename) {
  const attachment = await getKnowledgeAttachmentRow(knowledgePath, filename, 'filename, storage_path');
  const urls = await createSignedMediaUrls([attachment.storage_path]);
  return {
    filename: attachment.filename,
    content_type: detectContentType(attachment.filename),
    url: urls[0]?.signedUrl || urls[0]?.signedURL || null,
  };
}

// ---------------------------------------------------------------------------
// Scheduled jobs (see backend/scheduler.js and docs/scheduler-architecture.md)
// ---------------------------------------------------------------------------

const JOBS = 'brainy_scheduled_jobs';
const RUNS = 'brainy_job_runs';
const SCHED_STATE = 'brainy_scheduler_state';

async function listJobs() {
  const userId = await getUserId();
  const { data, error } = await supabase.from(JOBS).select('*').eq('user_id', userId).order('name');
  if (error) throw error;
  return data || [];
}

async function getJob(name) {
  const userId = await getUserId();
  const { data, error } = await supabase.from(JOBS).select('*').eq('user_id', userId).eq('name', name).single();
  if (error) {
    if (error.code === 'PGRST116') return null;
    throw error;
  }
  return data;
}

async function createJob(fields) {
  const { JOB_DEFAULTS, validateJob } = require('./scheduler');
  const job = { ...JOB_DEFAULTS, ...fields };
  validateJob(job);
  const userId = await getUserId();
  const { data, error } = await supabase.from(JOBS).insert({ ...job, user_id: userId }).select('*').single();
  if (error) throw error;
  return data;
}

async function updateJob(name, changes) {
  const { validateJob } = require('./scheduler');
  const existing = await getJob(name);
  if (!existing) throw new Error(`job '${name}' not found`);
  validateJob({ ...existing, ...changes });
  const userId = await getUserId();
  const { data, error } = await supabase
    .from(JOBS).update(changes).eq('user_id', userId).eq('name', name).select('*').single();
  if (error) throw error;
  return data;
}

async function deleteJob(name) {
  const userId = await getUserId();
  const { data, error } = await supabase.from(JOBS).delete().eq('user_id', userId).eq('name', name).select('name');
  if (error) throw error;
  if (!data || !data.length) throw new Error(`job '${name}' not found`);
  return { name, deleted: true };
}

// Mark jobs to run on the next tick regardless of trigger or capacity. Select
// by explicit names, by trigger, or all enabled jobs. Naming a missing or
// disabled job is an error rather than a silent skip.
async function requestJobRuns({ names, trigger, all } = {}) {
  const jobs = await listJobs();
  let selected;
  if (names && names.length) {
    selected = names.map((n) => {
      const job = jobs.find((j) => j.name === n);
      if (!job) throw new Error(`job '${n}' not found`);
      if (!job.enabled) throw new Error(`job '${n}' is disabled — enable it first (job update ${n} --enable)`);
      return job;
    });
  } else {
    selected = jobs.filter((j) => j.enabled && (all || j.trigger === trigger));
  }
  if (!selected.length) return [];
  const userId = await getUserId();
  const { error } = await supabase
    .from(JOBS)
    .update({ run_requested_at: new Date().toISOString() })
    .eq('user_id', userId)
    .in('id', selected.map((j) => j.id));
  if (error) throw error;
  return selected.map((j) => j.name);
}

async function updateJobNextRun(name, nextRunAt) {
  const userId = await getUserId();
  const { error } = await supabase.from(JOBS).update({ next_run_at: nextRunAt }).eq('user_id', userId).eq('name', name);
  if (error) throw error;
}

async function listJobRuns({ jobName, limit = 20 } = {}) {
  const userId = await getUserId();
  let query = supabase.from(RUNS).select('*').eq('user_id', userId);
  if (jobName) query = query.eq('job_name', jobName);
  const { data, error } = await query.order('started_at', { ascending: false }).limit(limit);
  if (error) throw error;
  return data || [];
}

async function listRunningJobRuns() {
  const userId = await getUserId();
  const { data, error } = await supabase.from(RUNS).select('*').eq('user_id', userId).eq('status', 'running');
  if (error) throw error;
  return data || [];
}

async function startJobRun({ job, reason, host, pid, usage }) {
  const userId = await getUserId();
  const { data, error } = await supabase.from(RUNS).insert({
    user_id: userId,
    job_id: job.id,
    job_name: job.name,
    reason,
    status: 'running',
    started_at: new Date().toISOString(),
    host,
    pid,
    usage_before: usage || null,
  }).select('*').single();
  if (error) throw error;
  return data;
}

// Close a run and stamp the job's last_* columns. last_run_at is the START of
// the last completed run (the scheduler measures cron fires from it);
// last_success_at only moves on success, which is what starvation checks.
async function finishJobRun(run, {
  status, exit_code, output_tail, usage_after, report, transcript_path, permission_denials,
}) {
  const userId = await getUserId();
  const finishedAt = new Date().toISOString();
  const { error } = await supabase.from(RUNS).update({
    status,
    finished_at: finishedAt,
    exit_code: exit_code ?? null,
    output_tail: output_tail || null,
    usage_after: usage_after || null,
    report: report || null,
    transcript_path: transcript_path || null,
    permission_denials: permission_denials || null,
  }).eq('user_id', userId).eq('id', run.id);
  if (error) throw error;

  const jobUpdate = { last_run_at: run.started_at, last_finished_at: finishedAt, last_status: status };
  if (status === 'succeeded') jobUpdate.last_success_at = finishedAt;
  const { error: jobErr } = await supabase.from(JOBS).update(jobUpdate).eq('user_id', userId).eq('id', run.job_id);
  if (jobErr) throw jobErr;
}

// The job's precheck found nothing to do: a healthy no-op. No run row (an
// hourly "nothing new" would bury the real runs), just the job's bookkeeping.
async function markJobSkipped(job) {
  const userId = await getUserId();
  const nowIso = new Date().toISOString();
  const { error } = await supabase.from(JOBS).update({
    last_run_at: nowIso,
    last_finished_at: nowIso,
    last_status: 'skipped',
    last_success_at: nowIso,
  }).eq('user_id', userId).eq('id', job.id);
  if (error) throw error;
}

async function uploadRunTranscript(run, filePath) {
  const userId = await getUserId();
  const key = `${userId}/job-runs/${run.id}.jsonl`;
  const buffer = await require('fs').promises.readFile(filePath);
  await uploadToStorage(key, buffer, { contentType: 'application/x-ndjson', upsert: true });
  return key;
}

// Audit trail: written by the CLI (not the agent) for every write made while
// BRAINY_RUN_ID is set, so a run's report can be checked against what it did.
async function recordRunEvent({ runId, jobName, action, targetType, target, detail }) {
  const userId = await getUserId();
  const { error } = await supabase.from('brainy_run_events').insert({
    user_id: userId,
    run_id: runId,
    job_name: jobName || null,
    action,
    target_type: targetType,
    target: target || null,
    detail: detail || null,
  });
  if (error) throw error;
}

// Finished runs that produced a report (agent runs), newest first, each with
// its audit events.
async function listReports({ since, jobName, limit = 20 } = {}) {
  const userId = await getUserId();
  let query = supabase.from(RUNS).select('*').eq('user_id', userId).not('report', 'is', null);
  if (since) query = query.gte('finished_at', since);
  if (jobName) query = query.eq('job_name', jobName);
  const { data: runs, error } = await query.order('finished_at', { ascending: false }).limit(limit);
  if (error) throw error;
  if (!runs || !runs.length) return [];
  const { data: events, error: evErr } = await supabase
    .from('brainy_run_events').select('*').eq('user_id', userId).in('run_id', runs.map((r) => r.id));
  if (evErr) throw evErr;
  return runs.map((r) => ({ ...r, events: (events || []).filter((e) => e.run_id === r.id) }));
}

// A run whose process is gone (crash, shutdown). last_run_at is deliberately
// left alone so the job counts as not-yet-run and retries on the next tick.
async function abandonJobRun(run, reason) {
  const userId = await getUserId();
  const { error } = await supabase.from(RUNS).update({
    status: 'abandoned',
    finished_at: new Date().toISOString(),
    output_tail: reason,
  }).eq('user_id', userId).eq('id', run.id);
  if (error) throw error;
  const { error: jobErr } = await supabase.from(JOBS).update({ last_status: 'abandoned' }).eq('user_id', userId).eq('id', run.job_id);
  if (jobErr) throw jobErr;
}

// Runs that count against a capacity job's runs_per_cycle: capacity and
// requested runs since the cycle started, excluding abandoned ones.
async function countCycleRuns(sinceIso) {
  const userId = await getUserId();
  const { data, error } = await supabase
    .from(RUNS)
    .select('job_id')
    .eq('user_id', userId)
    .gte('started_at', sinceIso)
    .in('reason', ['capacity', 'requested'])
    .neq('status', 'abandoned');
  if (error) throw error;
  const counts = {};
  for (const r of data || []) counts[r.job_id] = (counts[r.job_id] || 0) + 1;
  return counts;
}

async function getSchedulerState() {
  const userId = await getUserId();
  const { data, error } = await supabase.from(SCHED_STATE).select('*').eq('user_id', userId).maybeSingle();
  if (error) throw error;
  return data || null;
}

async function saveSchedulerState(state) {
  const userId = await getUserId();
  const { error } = await supabase.from(SCHED_STATE).upsert({ ...state, user_id: userId }, { onConflict: 'user_id' });
  if (error) throw error;
}

module.exports = {
  listTodos,
  getTodo,
  createTodo,
  updateTodo,
  deleteTodo,
  archiveTodo,
  listKnowledge,
  getKnowledge,
  upsertKnowledge,
  exportAll,
  checkIntegrity,
  promoteScheduled,
  listCaptures,
  listCaptureMedia,
  createSignedMediaUrls,
  resolveCaptureId,
  getCapture,
  processCapture,
  deleteCapture,
  downloadMedia,
  uploadCaptureMedia,
  listCollateral,
  addCollateral,
  removeCollateral,
  getCollateral,
  listKnowledgeAttachments,
  addKnowledgeAttachment,
  removeKnowledgeAttachment,
  getKnowledgeAttachment,
  listJobs,
  getJob,
  createJob,
  updateJob,
  deleteJob,
  requestJobRuns,
  updateJobNextRun,
  listJobRuns,
  listRunningJobRuns,
  startJobRun,
  finishJobRun,
  abandonJobRun,
  markJobSkipped,
  uploadRunTranscript,
  recordRunEvent,
  listReports,
  countCycleRuns,
  getSchedulerState,
  saveSchedulerState,
};
