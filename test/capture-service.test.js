const mockStorage = {
  listCaptures: jest.fn(),
  listCaptureMedia: jest.fn(),
  getCapture: jest.fn(),
  processCapture: jest.fn(),
  createSignedMediaUrls: jest.fn(),
};

jest.mock('../backend/storage', () => ({
  getStorage: () => mockStorage,
}));

const captureService = require('../backend/capture-service');

beforeEach(() => {
  jest.clearAllMocks();
});

describe('listCapturesWithMedia', () => {
  test('joins media to correct captures by capture_id', async () => {
    const captures = [
      { id: 'aaa', text: 'first', processed_at: null, created_at: '2026-04-04T10:00:00Z' },
      { id: 'bbb', text: 'second', processed_at: null, created_at: '2026-04-03T10:00:00Z' },
    ];
    const media = [
      { id: 'm1', capture_id: 'aaa', filename: 'photo.jpg', content_type: 'image/jpeg', storage_path: 'p/photo.jpg', created_at: '2026-04-04T10:00:00Z' },
      { id: 'm2', capture_id: 'aaa', filename: 'doc.pdf', content_type: 'application/pdf', storage_path: 'p/doc.pdf', created_at: '2026-04-04T10:01:00Z' },
      { id: 'm3', capture_id: 'bbb', filename: 'note.txt', content_type: 'text/plain', storage_path: 'p/note.txt', created_at: '2026-04-03T10:00:00Z' },
    ];

    mockStorage.listCaptures.mockResolvedValue(captures);
    mockStorage.listCaptureMedia.mockResolvedValue(media);

    const result = await captureService.listCapturesWithMedia();

    expect(mockStorage.listCaptureMedia).toHaveBeenCalledWith(['aaa', 'bbb']);
    expect(result).toHaveLength(2);
    expect(result[0].id).toBe('aaa');
    expect(result[0].media).toHaveLength(2);
    expect(result[0].media[0].filename).toBe('photo.jpg');
    expect(result[0].media[1].filename).toBe('doc.pdf');
    expect(result[1].id).toBe('bbb');
    expect(result[1].media).toHaveLength(1);
    expect(result[1].media[0].filename).toBe('note.txt');
  });

  test('captures with no media get empty array', async () => {
    mockStorage.listCaptures.mockResolvedValue([
      { id: 'aaa', text: 'lonely', processed_at: null, created_at: '2026-04-04T10:00:00Z' },
    ]);
    mockStorage.listCaptureMedia.mockResolvedValue([]);

    const result = await captureService.listCapturesWithMedia();

    expect(result[0].media).toEqual([]);
  });

  test('empty capture list skips media query', async () => {
    mockStorage.listCaptures.mockResolvedValue([]);

    const result = await captureService.listCapturesWithMedia();

    expect(mockStorage.listCaptureMedia).not.toHaveBeenCalled();
    expect(result).toEqual([]);
  });

  test('passes all flag through to listCaptures', async () => {
    mockStorage.listCaptures.mockResolvedValue([]);

    await captureService.listCapturesWithMedia(true);

    expect(mockStorage.listCaptures).toHaveBeenCalledWith(true);
  });

  test('filters out PDFs with .pdf.md siblings', async () => {
    mockStorage.listCaptures.mockResolvedValue([
      { id: 'aaa', text: 'first', processed_at: null, created_at: '2026-04-04T10:00:00Z' },
    ]);
    mockStorage.listCaptureMedia.mockResolvedValue([
      { id: 'm1', capture_id: 'aaa', filename: 'report.pdf', content_type: 'application/pdf' },
      { id: 'm2', capture_id: 'aaa', filename: 'report.pdf.md', content_type: 'text/markdown' },
      { id: 'm3', capture_id: 'aaa', filename: 'photo.jpg', content_type: 'image/jpeg' },
    ]);

    const result = await captureService.listCapturesWithMedia();

    expect(result[0].media).toHaveLength(2);
    expect(result[0].media.map((m) => m.filename)).toEqual(['report.pdf.md', 'photo.jpg']);
  });
});

describe('getCapture', () => {
  test('delegates to storage', async () => {
    const capture = { id: 'aaa', text: 'test', media: [{ filename: 'f.jpg' }] };
    mockStorage.getCapture.mockResolvedValue(capture);

    const result = await captureService.getCapture('aaa');

    expect(mockStorage.getCapture).toHaveBeenCalledWith('aaa');
    expect(result).toEqual(capture);
  });

  test('filters out PDF when .pdf.md sibling exists', async () => {
    mockStorage.getCapture.mockResolvedValue({
      id: 'aaa',
      text: 'test',
      media: [
        { filename: 'report.pdf', content_type: 'application/pdf' },
        { filename: 'report.pdf.md', content_type: 'text/markdown' },
      ],
    });

    const result = await captureService.getCapture('aaa');

    expect(result.media).toHaveLength(1);
    expect(result.media[0].filename).toBe('report.pdf.md');
  });

  test('keeps PDF when no .pdf.md sibling exists', async () => {
    mockStorage.getCapture.mockResolvedValue({
      id: 'aaa',
      text: 'test',
      media: [
        { filename: 'report.pdf', content_type: 'application/pdf' },
      ],
    });

    const result = await captureService.getCapture('aaa');

    expect(result.media).toHaveLength(1);
    expect(result.media[0].filename).toBe('report.pdf');
  });

  test('does not filter non-PDF files', async () => {
    mockStorage.getCapture.mockResolvedValue({
      id: 'aaa',
      text: 'test',
      media: [
        { filename: 'photo.jpg', content_type: 'image/jpeg' },
        { filename: 'report.pdf.md', content_type: 'text/markdown' },
      ],
    });

    const result = await captureService.getCapture('aaa');

    expect(result.media).toHaveLength(2);
  });

  test('returns null when capture not found', async () => {
    mockStorage.getCapture.mockResolvedValue(null);

    const result = await captureService.getCapture('nonexistent');

    expect(result).toBeNull();
  });
});

describe('processCapture', () => {
  test('delegates directly to storage', async () => {
    mockStorage.processCapture.mockResolvedValue({ id: 'aaa', processed: true });

    const result = await captureService.processCapture('aaa');

    expect(mockStorage.processCapture).toHaveBeenCalledWith('aaa');
    expect(result).toEqual({ id: 'aaa', processed: true });
  });
});

describe('getCaptureMediaUrls', () => {
  test('fetches capture then generates signed URLs for its media', async () => {
    mockStorage.getCapture.mockResolvedValue({
      id: 'aaa',
      text: 'test',
      media: [
        { id: 'm1', filename: 'photo.jpg', storage_path: 'uid/captures/photo.jpg', content_type: 'image/jpeg' },
        { id: 'm2', filename: 'doc.pdf', storage_path: 'uid/captures/doc.pdf', content_type: 'application/pdf' },
      ],
    });
    mockStorage.createSignedMediaUrls.mockResolvedValue([
      { path: 'uid/captures/photo.jpg', signedUrl: 'https://example.com/signed/photo.jpg' },
      { path: 'uid/captures/doc.pdf', signedUrl: 'https://example.com/signed/doc.pdf' },
    ]);

    const result = await captureService.getCaptureMediaUrls('aaa');

    expect(mockStorage.getCapture).toHaveBeenCalledWith('aaa');
    expect(mockStorage.createSignedMediaUrls).toHaveBeenCalledWith([
      'uid/captures/photo.jpg',
      'uid/captures/doc.pdf',
    ]);
    expect(result).toEqual([
      { filename: 'photo.jpg', content_type: 'image/jpeg', url: 'https://example.com/signed/photo.jpg' },
      { filename: 'doc.pdf', content_type: 'application/pdf', url: 'https://example.com/signed/doc.pdf' },
    ]);
  });

  test('returns empty array when capture has no media', async () => {
    mockStorage.getCapture.mockResolvedValue({
      id: 'aaa',
      text: 'test',
      media: [],
    });

    const result = await captureService.getCaptureMediaUrls('aaa');

    expect(mockStorage.createSignedMediaUrls).not.toHaveBeenCalled();
    expect(result).toEqual([]);
  });

  test('returns null when capture not found', async () => {
    mockStorage.getCapture.mockResolvedValue(null);

    const result = await captureService.getCaptureMediaUrls('nonexistent');

    expect(result).toBeNull();
  });

  test('filters out PDF when .pdf.md sibling exists', async () => {
    mockStorage.getCapture.mockResolvedValue({
      id: 'aaa',
      text: 'test',
      media: [
        { id: 'm1', filename: 'report.pdf', storage_path: 'uid/captures/report.pdf', content_type: 'application/pdf' },
        { id: 'm2', filename: 'report.pdf.md', storage_path: 'uid/captures/report.pdf.md', content_type: 'text/markdown' },
      ],
    });
    mockStorage.createSignedMediaUrls.mockResolvedValue([
      { path: 'uid/captures/report.pdf.md', signedUrl: 'https://example.com/signed/report.pdf.md' },
    ]);

    const result = await captureService.getCaptureMediaUrls('aaa');

    expect(result).toHaveLength(1);
    expect(result[0].filename).toBe('report.pdf.md');
    expect(mockStorage.createSignedMediaUrls).toHaveBeenCalledWith(['uid/captures/report.pdf.md']);
  });
});

