const flushPromises = () => new Promise(process.nextTick);

function buildMocks(overrides) {
  const mockUpload = jest.fn().mockResolvedValue({ data: { path: 'uid/captures/file.jpg' }, error: null });
  const mockStorageFrom = jest.fn().mockReturnValue({ upload: mockUpload });
  const mockSelect = jest.fn().mockResolvedValue({ data: [{ id: 'capture-id-123' }], error: null });
  const mockCaptureInsert = jest.fn().mockReturnValue({ select: mockSelect });
  const mockMediaInsert = jest.fn().mockResolvedValue({ error: null });
  const mockFrom = jest.fn((table) => {
    if (table === 'brainy_capture_media') return { insert: mockMediaInsert };
    return { insert: mockCaptureInsert };
  });
  const mockDb = {
    from: mockFrom,
    storage: { from: mockStorageFrom },
  };
  const mockResizeFn = jest.fn((file) => Promise.resolve({ file: file, wasResized: false }));

  return {
    mockDb,
    mockFrom,
    mockCaptureInsert,
    mockSelect,
    mockMediaInsert,
    mockUpload,
    mockStorageFrom,
    mockResizeFn,
    ...overrides,
  };
}

// Load the module — it's vanilla JS that attaches uploadCapture to global/window
// We'll use require and assume it exports via module.exports if available
let uploadCapture;
beforeAll(() => {
  // uploadCapture is defined as a global function in upload.js
  // For Node testing, we load it as a module
  const path = require('path');
  const fs = require('fs');
  const vm = require('vm');
  const code = fs.readFileSync(path.join(__dirname, '../../frontend/upload.js'), 'utf8');
  const ctx = { Promise: Promise };
  vm.createContext(ctx);
  vm.runInContext(code, ctx);
  uploadCapture = ctx.uploadCapture;
});

describe('uploadCapture', () => {
  test('text-only capture: no storage calls, inserts with text', async () => {
    const m = buildMocks();

    const result = await uploadCapture(m.mockDb, 'user-1', 'my thought', [], m.mockResizeFn);

    expect(m.mockStorageFrom).not.toHaveBeenCalled();
    expect(m.mockResizeFn).not.toHaveBeenCalled();
    expect(m.mockFrom).toHaveBeenCalledWith('brainy_captures');
    expect(m.mockCaptureInsert).toHaveBeenCalledWith({ text: 'my thought', user_id: 'user-1' });
    expect(m.mockSelect).toHaveBeenCalled();
    expect(result.captureId).toBe('capture-id-123');
    expect(result.resizedFiles).toEqual([]);
  });

  test('file-only capture: inserts with text null', async () => {
    const m = buildMocks();
    const file = { name: 'photo.jpg', type: 'image/jpeg', size: 5000 };

    await uploadCapture(m.mockDb, 'user-1', '', [file], m.mockResizeFn);

    expect(m.mockCaptureInsert).toHaveBeenCalledWith({ text: null, user_id: 'user-1' });
  });

  test('file capture: uploads to brainy_files at correct path', async () => {
    const m = buildMocks();
    const file = { name: 'photo.jpg', type: 'image/jpeg', size: 5000 };
    const now = Date.now();

    await uploadCapture(m.mockDb, 'user-1', 'text', [file], m.mockResizeFn);

    expect(m.mockStorageFrom).toHaveBeenCalledWith('brainy_files');
    expect(m.mockUpload).toHaveBeenCalledTimes(1);
    const uploadPath = m.mockUpload.mock.calls[0][0];
    expect(uploadPath).toMatch(/^user-1\/captures\/\d+-photo\.jpg$/);
    // Timestamp should be recent
    const ts = parseInt(uploadPath.split('/')[2].split('-')[0]);
    expect(ts).toBeGreaterThanOrEqual(now - 1000);
  });

  test('media record inserted with user_id, capture_id, filename, content_type, storage_path', async () => {
    const m = buildMocks();
    const file = { name: 'doc.pdf', type: 'application/pdf', size: 10000 };

    await uploadCapture(m.mockDb, 'user-1', 'text', [file], m.mockResizeFn);

    expect(m.mockFrom).toHaveBeenCalledWith('brainy_capture_media');
    expect(m.mockMediaInsert).toHaveBeenCalledWith({
      user_id: 'user-1',
      capture_id: 'capture-id-123',
      filename: 'doc.pdf',
      content_type: 'application/pdf',
      storage_path: expect.stringMatching(/^user-1\/captures\/\d+-doc\.pdf$/),
    });
  });

  test('upload failure throws, no capture row inserted', async () => {
    const m = buildMocks();
    m.mockUpload.mockResolvedValue({ data: null, error: { message: 'quota exceeded' } });
    const file = { name: 'big.jpg', type: 'image/jpeg', size: 50000000 };

    await expect(uploadCapture(m.mockDb, 'user-1', 'text', [file], m.mockResizeFn))
      .rejects.toThrow('Upload failed: quota exceeded');

    expect(m.mockCaptureInsert).not.toHaveBeenCalled();
  });

  test('returns captureId and resizedFiles with wasResized flags', async () => {
    const m = buildMocks();
    const file1 = { name: 'small.jpg', type: 'image/jpeg', size: 1000 };
    const resizedBlob = { name: 'big.jpg', type: 'image/jpeg', size: 500 };
    const file2 = { name: 'big.jpg', type: 'image/jpeg', size: 8000000 };
    m.mockResizeFn
      .mockResolvedValueOnce({ file: file1, wasResized: false })
      .mockResolvedValueOnce({ file: resizedBlob, wasResized: true });

    const result = await uploadCapture(m.mockDb, 'user-1', 'text', [file1, file2], m.mockResizeFn);

    expect(result.captureId).toBe('capture-id-123');
    expect(result.resizedFiles).toEqual([
      { name: 'small.jpg', wasResized: false },
      { name: 'big.jpg', wasResized: true },
    ]);
  });

  test('multiple files uploaded sequentially', async () => {
    const m = buildMocks();
    const callOrder = [];
    m.mockUpload.mockImplementation((path) => {
      callOrder.push(path);
      return Promise.resolve({ data: { path }, error: null });
    });

    const files = [
      { name: 'a.jpg', type: 'image/jpeg', size: 1000 },
      { name: 'b.jpg', type: 'image/jpeg', size: 2000 },
      { name: 'c.pdf', type: 'application/pdf', size: 3000 },
    ];

    await uploadCapture(m.mockDb, 'user-1', 'text', files, m.mockResizeFn);

    expect(m.mockUpload).toHaveBeenCalledTimes(3);
    expect(m.mockMediaInsert).toHaveBeenCalledTimes(3);
    // All three files uploaded
    expect(callOrder[0]).toMatch(/a\.jpg$/);
    expect(callOrder[1]).toMatch(/b\.jpg$/);
    expect(callOrder[2]).toMatch(/c\.pdf$/);
  });

  test('filenames sanitized: spaces and special chars replaced with dashes', async () => {
    const m = buildMocks();
    const file = { name: 'my photo (1).jpg', type: 'image/jpeg', size: 5000 };

    await uploadCapture(m.mockDb, 'user-1', 'text', [file], m.mockResizeFn);

    const uploadPath = m.mockUpload.mock.calls[0][0];
    expect(uploadPath).toMatch(/my-photo--1-\.jpg$/);
    // Media record keeps original filename
    expect(m.mockMediaInsert).toHaveBeenCalledWith(
      expect.objectContaining({ filename: 'my photo (1).jpg' })
    );
  });

  test('capture insert failure throws after uploads', async () => {
    const m = buildMocks();
    m.mockSelect.mockResolvedValue({ data: null, error: { message: 'RLS violation' } });
    const file = { name: 'a.jpg', type: 'image/jpeg', size: 1000 };

    await expect(uploadCapture(m.mockDb, 'user-1', 'text', [file], m.mockResizeFn))
      .rejects.toThrow('Capture failed: RLS violation');
  });

  test('media insert failure throws', async () => {
    const m = buildMocks();
    m.mockMediaInsert.mockResolvedValue({ error: { message: 'media RLS' } });
    const file = { name: 'a.jpg', type: 'image/jpeg', size: 1000 };

    await expect(uploadCapture(m.mockDb, 'user-1', 'text', [file], m.mockResizeFn))
      .rejects.toThrow('Media record failed: media RLS');
  });
});
