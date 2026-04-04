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
