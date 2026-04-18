/**
 * Supabase storage adapter.
 * Wraps Supabase queries behind the same interface as storage-file.js.
 */
const { supabase, login } = require('./supabase-client');

let _userId = null;

async function getUserId() {
  if (_userId) return _userId;
  const user = await login();
  _userId = user.id;
  return _userId;
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

async function createTodo({ name, summary, status, priority, category, due, scheduled_date, blocked_by }) {
  const userId = await getUserId();
  status = status || 'inbox';

  const row = {
    user_id: userId,
    name,
    summary: summary || '',
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

  // Get collateral
  const { data: collateral } = await supabase
    .from('brainy_todo_collateral')
    .select('filename, content_type, storage_path')
    .eq('todo_id', todo.id);

  // Create archive entry
  const { error: archiveErr } = await supabase.from('brainy_archive_entries').insert({
    user_id: userId,
    todo_name: name,
    completion_date: completionDate,
    year_month: yearMonth,
    summary_text: summaryText || 'Completed.',
    todo_snapshot: { ...todo, id: undefined, user_id: undefined },
    collateral_snapshot: collateral?.length > 0 ? collateral.map((c) => c.filename) : null,
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
    .select('path, topic, format')
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
    format: row.format || 'markdown',
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
    format: data.format || 'markdown',
    content: data.content || '',
  };
}

async function upsertKnowledge({ path: knowledgePath, content, topic, format }) {
  const userId = await getUserId();
  const ext = knowledgePath.split('.').pop().toLowerCase();

  const row = {
    user_id: userId,
    path: knowledgePath,
    content,
    topic: topic || knowledgePath.split('/').pop().replace(/\.[^.]+$/, ''),
    format: format || (ext === 'yml' || ext === 'yaml' ? 'yaml' : 'markdown'),
  };

  const { error } = await supabase
    .from('brainy_knowledge')
    .upsert(row, { onConflict: 'user_id,path' });
  if (error) throw error;

  return { path: knowledgePath, upserted: true };
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
    .update({ status: 'active' })
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
  const storagePath = `${userId}/captures/${captureId}/${filename}`;

  const { error: uploadErr } = await supabase.storage
    .from('brainy_files')
    .upload(storagePath, buffer, { contentType });
  if (uploadErr) throw uploadErr;

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

async function addCollateral(todoName, filepath) {
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

  const filename = path.basename(filepath);
  const contentType = detectContentType(filepath);

  if (isTextType(contentType)) {
    const textContent = await fs.readFile(filepath, 'utf-8');
    const { error } = await supabase.from('brainy_todo_collateral').insert({
      user_id: userId,
      todo_id: todo.id,
      filename,
      content_type: contentType,
      text_content: textContent,
    });
    if (error) throw error;
    return { filename, content_type: contentType, is_text: true };
  } else {
    const fileBuffer = await fs.readFile(filepath);
    const storagePath = `${userId}/${todo.id}/${filename}`;
    const { error: uploadErr } = await supabase.storage
      .from('brainy_files')
      .upload(storagePath, fileBuffer, { contentType });
    if (uploadErr) throw uploadErr;

    const { error } = await supabase.from('brainy_todo_collateral').insert({
      user_id: userId,
      todo_id: todo.id,
      filename,
      content_type: contentType,
      storage_path: storagePath,
    });
    if (error) throw error;
    return { filename, content_type: contentType, is_text: false };
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
  checkIntegrity,
  promoteScheduled,
  listCaptures,
  listCaptureMedia,
  createSignedMediaUrls,
  getCapture,
  processCapture,
  downloadMedia,
  uploadCaptureMedia,
  listCollateral,
  addCollateral,
  removeCollateral,
  getCollateral,
};
