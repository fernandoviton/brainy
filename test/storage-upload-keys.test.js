// Every upload path must produce a storage key Supabase can sign and remove.
// A '#' in a key is silently treated as a URL fragment: the object lands under
// a truncated name and can never be opened or deleted.
const fs = require('fs');
const os = require('os');
const path = require('path');
const mockSupabase = require('./helpers/mock-supabase');

jest.mock('../backend/supabase-client', () => mockSupabase);

const storage = require('../backend/storage-supabase');

const USER = 'test-user-id';

function queueResults(...results) {
  return results.map((result) => {
    const chain = {};
    for (const m of ['select', 'insert', 'update', 'delete', 'eq', 'order']) {
      chain[m] = jest.fn(() => chain);
    }
    chain.single = jest.fn(() => Promise.resolve(result));
    chain.maybeSingle = jest.fn(() => Promise.resolve(result));
    chain.then = (resolve) => resolve(result);
    mockSupabase.supabase.from.mockImplementationOnce(() => chain);
    return chain;
  });
}

let bucket;
beforeEach(() => {
  jest.clearAllMocks();
  mockSupabase.resetMock();
  bucket = { upload: jest.fn(() => Promise.resolve({ data: {}, error: null })) };
  mockSupabase.supabase.storage.from.mockImplementation(() => bucket);
});

function tmpFile(name, content = 'BIN') {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ukeys-'));
  const p = path.join(dir, name);
  fs.writeFileSync(p, content);
  return p;
}

describe('addCollateral (binary)', () => {
  test('stores a URL-safe key and filename', async () => {
    const file = tmpFile('Invoice #42.pdf');
    const [, , insert] = queueResults(
      { data: { id: 'todo-1' }, error: null },
      { data: null, error: null },
      { data: null, error: null },
    );

    const result = await storage.addCollateral('my-task', file);

    expect(result.filename).toBe('Invoice 42.pdf');
    expect(bucket.upload.mock.calls[0][0]).toBe(`${USER}/todo-1/Invoice 42.pdf`);
    expect(insert.insert.mock.calls[0][0].filename).toBe('Invoice 42.pdf');
  });
});

describe('addCollateral (text)', () => {
  test('uses the same safe filename so get/remove names match binary files', async () => {
    const file = tmpFile('notes #1.md', '# notes');
    const [, , insert] = queueResults(
      { data: { id: 'todo-1' }, error: null },
      { data: null, error: null },
      { data: null, error: null },
    );

    const result = await storage.addCollateral('my-task', file);

    expect(result.filename).toBe('notes 1.md');
    expect(insert.insert.mock.calls[0][0].filename).toBe('notes 1.md');
    expect(bucket.upload).not.toHaveBeenCalled();
  });
});

describe('uploadCaptureMedia', () => {
  test('sanitizes the storage key but keeps the display filename', async () => {
    // convert-capture-pdfs finds converted PDFs by filename ('x.pdf' -> 'x.pdf.md'),
    // so the row keeps the original name; only the key is made safe.
    const [insert] = queueResults({ data: null, error: null });

    const result = await storage.uploadCaptureMedia({
      captureId: 'cap-1', filename: 'Scan #3.pdf.md', contentType: 'text/markdown', buffer: Buffer.from('x'),
    });

    expect(bucket.upload.mock.calls[0][0]).toBe(`${USER}/captures/cap-1/Scan 3.pdf.md`);
    expect(insert.insert.mock.calls[0][0].filename).toBe('Scan #3.pdf.md');
    expect(insert.insert.mock.calls[0][0].storage_path).toBe(`${USER}/captures/cap-1/Scan 3.pdf.md`);
    expect(result.storage_path).toBe(`${USER}/captures/cap-1/Scan 3.pdf.md`);
  });
});

describe('upload guard coverage', () => {
  test('backend code uploads only through uploadToStorage (which checks the key)', () => {
    const backendDir = path.join(__dirname, '..', 'backend');
    const direct = [];
    for (const file of fs.readdirSync(backendDir).filter((f) => f.endsWith('.js'))) {
      const src = fs.readFileSync(path.join(backendDir, file), 'utf8');
      const count = (src.match(/\.upload\(/g) || []).length;
      if (count) direct.push(`${file}: ${count}`);
    }
    // The single allowed call is inside uploadToStorage in storage-supabase.js.
    expect(direct).toEqual(['storage-supabase.js: 1']);
  });

  test('uploadToStorage rejects an unsafe key before calling Supabase', async () => {
    const file = tmpFile('ok.pdf');
    queueResults({ data: { id: 'todo/#1' }, error: null }, { data: null, error: null });

    await expect(storage.addCollateral('my-task', file)).rejects.toThrow(/Unsafe storage key/);
    expect(bucket.upload).not.toHaveBeenCalled();
  });
});
