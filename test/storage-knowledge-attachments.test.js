const fs = require('fs');
const os = require('os');
const path = require('path');
const mockSupabase = require('./helpers/mock-supabase');

jest.mock('../backend/supabase-client', () => mockSupabase);

const storage = require('../backend/storage-supabase');

const USER = 'test-user-id';
const KID = 'knowledge-uuid';

// Each supabase.from() call gets the next queued result, so a test can script
// the knowledge lookup, the attachment lookup, and the write separately.
function queueResults(...results) {
  return results.map((result) => {
    const chain = {};
    for (const m of ['select', 'insert', 'update', 'delete', 'eq', 'order']) {
      chain[m] = jest.fn(() => chain);
    }
    chain.single = jest.fn(() => Promise.resolve(result));
    chain.then = (resolve) => resolve(result);
    mockSupabase.supabase.from.mockImplementationOnce(() => chain);
    return chain;
  });
}

let bucket;
function mockBucket() {
  bucket = {
    upload: jest.fn(() => Promise.resolve({ data: {}, error: null })),
    remove: jest.fn(() => Promise.resolve({ data: null, error: null })),
    createSignedUrls: jest.fn(() => Promise.resolve({ data: [{ signedUrl: 'https://signed/x' }], error: null })),
  };
  mockSupabase.supabase.storage.from.mockImplementation(() => bucket);
}

function tmpFile(name, content = 'PDFDATA') {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'katt-'));
  const p = path.join(dir, name);
  fs.writeFileSync(p, content);
  return p;
}

const NOT_FOUND = { data: null, error: { code: 'PGRST116', message: 'no rows' } };

beforeEach(() => {
  jest.clearAllMocks();
  mockSupabase.resetMock();
  mockBucket();
});

describe('addKnowledgeAttachment', () => {
  test('uploads under <user>/knowledge/<entry folder>/<file> and inserts a row', async () => {
    const file = tmpFile('Invoice 1.pdf');
    const [, lookup, insert] = queueResults(
      { data: { id: KID }, error: null },
      { data: [], error: null },
      { data: null, error: null },
    );

    const result = await storage.addKnowledgeAttachment('home/hvac/leak.md', file);

    expect(result).toEqual({ filename: 'Invoice 1.pdf', content_type: 'application/pdf', replaced: false });
    expect(bucket.upload).toHaveBeenCalledWith(
      `${USER}/knowledge/home/hvac/Invoice 1.pdf`,
      expect.any(Buffer),
      { contentType: 'application/pdf', upsert: true },
    );
    expect(lookup.eq).toHaveBeenCalledWith('storage_path', `${USER}/knowledge/home/hvac/Invoice 1.pdf`);
    expect(insert.insert).toHaveBeenCalledWith({
      user_id: USER,
      knowledge_id: KID,
      path: 'home/hvac/Invoice 1.pdf',
      filename: 'Invoice 1.pdf',
      storage_path: `${USER}/knowledge/home/hvac/Invoice 1.pdf`,
    });
  });

  test('a top-level entry stores its files directly under knowledge/', async () => {
    const file = tmpFile('a.png');
    const [, , insert] = queueResults(
      { data: { id: KID }, error: null },
      { data: [], error: null },
      { data: null, error: null },
    );

    await storage.addKnowledgeAttachment('taxes.md', file);

    expect(insert.insert.mock.calls[0][0].path).toBe('a.png');
    expect(insert.insert.mock.calls[0][0].storage_path).toBe(`${USER}/knowledge/a.png`);
  });

  test('stores a URL-safe filename: drops # and replaces other unsafe characters', async () => {
    // Supabase returns no signed URL for storage keys containing '#', so such a
    // file could be uploaded but never opened.
    const file = tmpFile('Invoice #91244912 [final]%.pdf');
    const [, lookup, insert] = queueResults(
      { data: { id: KID }, error: null },
      { data: [], error: null },
      { data: null, error: null },
    );

    const result = await storage.addKnowledgeAttachment('home/hvac/leak.md', file);

    expect(result.filename).toBe('Invoice 91244912 _final__.pdf');
    expect(lookup.eq).toHaveBeenCalledWith('storage_path', `${USER}/knowledge/home/hvac/Invoice 91244912 _final__.pdf`);
    expect(insert.insert.mock.calls[0][0].filename).toBe('Invoice 91244912 _final__.pdf');
  });

  test('detects video content types', async () => {
    const file = tmpFile('leak.mov');
    queueResults({ data: { id: KID }, error: null }, { data: [], error: null }, { data: null, error: null });

    const result = await storage.addKnowledgeAttachment('home/hvac/leak.md', file);

    expect(result.content_type).toBe('video/quicktime');
  });

  test('refuses to overwrite an existing attachment without replace', async () => {
    const file = tmpFile('a.pdf');
    queueResults(
      { data: { id: KID }, error: null },
      { data: [{ id: 'att-1', knowledge_id: KID }], error: null },
    );

    await expect(storage.addKnowledgeAttachment('home/hvac/leak.md', file))
      .rejects.toThrow(/already exists.*--replace/);
    expect(bucket.upload).not.toHaveBeenCalled();
  });

  test('replace re-uploads the file and keeps the existing row', async () => {
    const file = tmpFile('a.pdf');
    queueResults(
      { data: { id: KID }, error: null },
      { data: [{ id: 'att-1', knowledge_id: KID }], error: null },
    );

    const result = await storage.addKnowledgeAttachment('home/hvac/leak.md', file, { replace: true });

    expect(result.replaced).toBe(true);
    expect(bucket.upload).toHaveBeenCalledTimes(1);
    // Knowledge lookup + attachment lookup only: no second row inserted.
    expect(mockSupabase.supabase.from).toHaveBeenCalledTimes(2);
  });

  test('refuses a filename already used by another entry in the same folder', async () => {
    const file = tmpFile('a.pdf');
    queueResults(
      { data: { id: KID }, error: null },
      { data: [{ id: 'att-9', knowledge_id: 'other-entry' }], error: null },
    );

    await expect(storage.addKnowledgeAttachment('home/hvac/leak.md', file, { replace: true }))
      .rejects.toThrow(/another knowledge entry/);
    expect(bucket.upload).not.toHaveBeenCalled();
  });

  test('unknown knowledge path → clear error, nothing uploaded', async () => {
    const file = tmpFile('a.pdf');
    queueResults(NOT_FOUND);

    await expect(storage.addKnowledgeAttachment('nope.md', file)).rejects.toThrow("Knowledge 'nope.md' not found");
    expect(bucket.upload).not.toHaveBeenCalled();
  });

  test('missing local file fails before touching Supabase', async () => {
    await expect(storage.addKnowledgeAttachment('home/hvac/leak.md', '/no/such/file.pdf')).rejects.toThrow(/ENOENT/);
    expect(mockSupabase.supabase.from).not.toHaveBeenCalled();
  });
});

describe('listKnowledgeAttachments', () => {
  test('returns filenames with content types, scoped to the entry', async () => {
    const [, list] = queueResults(
      { data: { id: KID }, error: null },
      { data: [{ filename: 'a.pdf' }, { filename: 'b.jpg' }], error: null },
    );

    const result = await storage.listKnowledgeAttachments('home/hvac/leak.md');

    expect(result).toEqual([
      { filename: 'a.pdf', content_type: 'application/pdf' },
      { filename: 'b.jpg', content_type: 'image/jpeg' },
    ]);
    expect(list.eq).toHaveBeenCalledWith('knowledge_id', KID);
  });
});

describe('removeKnowledgeAttachment', () => {
  test('deletes the stored file and the row', async () => {
    const [, , del] = queueResults(
      { data: { id: KID }, error: null },
      { data: { id: 'att-1', storage_path: 'u/knowledge/home/a.pdf' }, error: null },
      { data: null, error: null },
    );

    const result = await storage.removeKnowledgeAttachment('home/hvac/leak.md', 'a.pdf');

    expect(result).toEqual({ filename: 'a.pdf', removed: true });
    expect(bucket.remove).toHaveBeenCalledWith(['u/knowledge/home/a.pdf']);
    expect(del.delete).toHaveBeenCalled();
    expect(del.eq).toHaveBeenCalledWith('id', 'att-1');
  });

  test('unknown attachment → clear error', async () => {
    queueResults({ data: { id: KID }, error: null }, NOT_FOUND);

    await expect(storage.removeKnowledgeAttachment('home/hvac/leak.md', 'x.pdf'))
      .rejects.toThrow("Attachment 'x.pdf' not found on 'home/hvac/leak.md'");
    expect(bucket.remove).not.toHaveBeenCalled();
  });
});

describe('getKnowledgeAttachment', () => {
  test('returns a signed URL', async () => {
    queueResults(
      { data: { id: KID }, error: null },
      { data: { filename: 'a.pdf', storage_path: 'u/knowledge/home/a.pdf' }, error: null },
    );

    const result = await storage.getKnowledgeAttachment('home/hvac/leak.md', 'a.pdf');

    expect(result).toEqual({ filename: 'a.pdf', content_type: 'application/pdf', url: 'https://signed/x' });
    expect(bucket.createSignedUrls).toHaveBeenCalledWith(['u/knowledge/home/a.pdf'], 3600);
  });
});
