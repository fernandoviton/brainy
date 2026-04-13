const mockSupabase = require('./helpers/mock-supabase');

jest.mock('../backend/supabase-client', () => mockSupabase);

const storage = require('../backend/storage-supabase');

beforeEach(() => {
  jest.clearAllMocks();
  mockSupabase.resetMock();
});

describe('listCaptures', () => {
  test('returns unprocessed only by default, newest first', async () => {
    const captures = [
      { id: 'aaa', text: 'buy milk', processed_at: null, created_at: '2026-04-04T10:00:00Z' },
      { id: 'bbb', text: 'call dentist', processed_at: null, created_at: '2026-04-03T10:00:00Z' },
    ];
    mockSupabase.setMockResult(captures);

    const result = await storage.listCaptures();

    const from = mockSupabase.supabase.from;
    expect(from).toHaveBeenCalledWith('brainy_captures');

    const chain = from.mock.results[0].value;
    expect(chain.is).toHaveBeenCalledWith('processed_at', null);
    expect(chain.order).toHaveBeenCalledWith('created_at', { ascending: false });
    expect(result).toEqual(captures);
  });

  test('returns all including processed when all=true', async () => {
    const captures = [
      { id: 'aaa', text: 'buy milk', processed_at: '2026-04-04T12:00:00Z', created_at: '2026-04-04T10:00:00Z' },
      { id: 'bbb', text: 'call dentist', processed_at: null, created_at: '2026-04-03T10:00:00Z' },
    ];
    mockSupabase.setMockResult(captures);

    const result = await storage.listCaptures(true);

    const chain = mockSupabase.supabase.from.mock.results[0].value;
    expect(chain.is).not.toHaveBeenCalled();
    expect(result).toEqual(captures);
  });
});

describe('getCapture', () => {
  test('returns capture with media array', async () => {
    const capture = { id: 'aaa', text: 'buy milk', processed_at: null, created_at: '2026-04-04T10:00:00Z' };
    const media = [{ id: 'm1', filename: 'photo.jpg', content_type: 'image/jpeg', storage_path: 'path/photo.jpg' }];

    let callCount = 0;
    mockSupabase.supabase.from.mockImplementation(() => {
      callCount++;
      const isFirst = callCount === 1;
      const chain = {
        select: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
        single: jest.fn(() => Promise.resolve({ data: capture, error: null })),
      };
      chain.then = function (resolve) {
        return resolve({ data: isFirst ? null : media, error: null });
      };
      return chain;
    });

    const result = await storage.getCapture('aaa');

    expect(result).toEqual({ ...capture, media });
  });

  test('returns null for not-found (PGRST116)', async () => {
    mockSupabase.supabase.from.mockImplementation(() => ({
      select: jest.fn().mockReturnThis(),
      eq: jest.fn().mockReturnThis(),
      single: jest.fn(() => Promise.resolve({ data: null, error: { code: 'PGRST116' } })),
    }));

    const result = await storage.getCapture('nonexistent');
    expect(result).toBeNull();
  });
});

describe('listCaptureMedia', () => {
  test('fetches media for given capture IDs', async () => {
    const media = [
      { id: 'm1', capture_id: 'aaa', filename: 'photo.jpg', content_type: 'image/jpeg', storage_path: 'path/photo.jpg', created_at: '2026-04-04T10:00:00Z' },
      { id: 'm2', capture_id: 'bbb', filename: 'doc.pdf', content_type: 'application/pdf', storage_path: 'path/doc.pdf', created_at: '2026-04-04T11:00:00Z' },
    ];
    mockSupabase.setMockResult(media);

    const result = await storage.listCaptureMedia(['aaa', 'bbb']);

    const from = mockSupabase.supabase.from;
    expect(from).toHaveBeenCalledWith('brainy_capture_media');

    const chain = from.mock.results[0].value;
    expect(chain.eq).toHaveBeenCalledWith('user_id', 'test-user-id');
    expect(chain.in).toHaveBeenCalledWith('capture_id', ['aaa', 'bbb']);
    expect(result).toEqual(media);
  });

  test('returns empty array for empty input without querying', async () => {
    const result = await storage.listCaptureMedia([]);

    expect(mockSupabase.supabase.from).not.toHaveBeenCalled();
    expect(result).toEqual([]);
  });
});

describe('createSignedMediaUrls', () => {
  test('generates signed URLs for given storage paths', async () => {
    mockSupabase.setMockSignedUrls([
      { path: 'uid/captures/photo.jpg', signedUrl: 'https://example.com/signed/photo.jpg' },
      { path: 'uid/captures/doc.pdf', signedUrl: 'https://example.com/signed/doc.pdf' },
    ]);

    const result = await storage.createSignedMediaUrls([
      'uid/captures/photo.jpg',
      'uid/captures/doc.pdf',
    ]);

    expect(mockSupabase.supabase.storage.from).toHaveBeenCalledWith('brainy_files');
    const bucket = mockSupabase.supabase.storage.from.mock.results[0].value;
    expect(bucket.createSignedUrls).toHaveBeenCalledWith(
      ['uid/captures/photo.jpg', 'uid/captures/doc.pdf'],
      3600
    );
    expect(result).toEqual([
      { path: 'uid/captures/photo.jpg', signedUrl: 'https://example.com/signed/photo.jpg' },
      { path: 'uid/captures/doc.pdf', signedUrl: 'https://example.com/signed/doc.pdf' },
    ]);
  });

  test('returns empty array for empty input without calling storage', async () => {
    const result = await storage.createSignedMediaUrls([]);

    expect(mockSupabase.supabase.storage.from).not.toHaveBeenCalled();
    expect(result).toEqual([]);
  });
});

describe('resolveCaptureId', () => {
  test('returns full UUID as-is without querying', async () => {
    const fullId = 'abcd1234-0000-0000-0000-000000000000';

    const result = await storage.resolveCaptureId(fullId);

    expect(result).toBe(fullId);
    expect(mockSupabase.supabase.from).not.toHaveBeenCalled();
  });

  test('returns full UUID when short prefix matches exactly one capture', async () => {
    const fullId = 'abcd1234-0000-0000-0000-000000000000';
    mockSupabase.setMockResult([
      { id: fullId },
      { id: 'eeee5678-0000-0000-0000-000000000000' },
    ]);

    const result = await storage.resolveCaptureId('abcd1234');

    const from = mockSupabase.supabase.from;
    expect(from).toHaveBeenCalledWith('brainy_captures');
    const chain = from.mock.results[0].value;
    expect(chain.select).toHaveBeenCalledWith('id');
    expect(chain.eq).toHaveBeenCalledWith('user_id', 'test-user-id');
    expect(result).toBe(fullId);
  });

  test('returns null when short prefix matches no captures', async () => {
    mockSupabase.setMockResult([
      { id: 'eeee5678-0000-0000-0000-000000000000' },
    ]);

    const result = await storage.resolveCaptureId('deadbeef');

    expect(result).toBeNull();
  });

  test('throws when short prefix matches multiple captures', async () => {
    mockSupabase.setMockResult([
      { id: 'abcd1234-0000-0000-0000-000000000000' },
      { id: 'abcd1234-1111-1111-1111-111111111111' },
    ]);

    await expect(storage.resolveCaptureId('abcd1234')).rejects.toThrow(/ambiguous/i);
  });
});

describe('processCapture', () => {
  test('sets processed_at', async () => {
    mockSupabase.setMockResult({ id: 'aaa', processed_at: '2026-04-04T12:00:00Z' });

    const result = await storage.processCapture('aaa');

    const from = mockSupabase.supabase.from;
    expect(from).toHaveBeenCalledWith('brainy_captures');

    const chain = from.mock.results[0].value;
    expect(chain.update).toHaveBeenCalled();
    const updateArg = chain.update.mock.calls[0][0];
    expect(updateArg).toHaveProperty('processed_at');
    expect(result).toEqual({ id: 'aaa', processed: true });
  });
});
