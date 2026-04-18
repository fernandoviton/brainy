const mockStorage = {
  listCaptures: jest.fn(),
  getCapture: jest.fn(),
  processCapture: jest.fn(),
  downloadMedia: jest.fn(),
  uploadCaptureMedia: jest.fn(),
  listTodos: jest.fn(),
  getTodo: jest.fn(),
  createTodo: jest.fn(),
  updateTodo: jest.fn(),
  deleteTodo: jest.fn(),
  archiveTodo: jest.fn(),
  listKnowledge: jest.fn(),
  getKnowledge: jest.fn(),
  upsertKnowledge: jest.fn(),
  checkIntegrity: jest.fn(),
  promoteScheduled: jest.fn(),
};

jest.mock('../backend/storage', () => ({
  getStorage: () => mockStorage,
}));

const mockCaptureService = {
  listCapturesWithMedia: jest.fn(),
  getCapture: jest.fn(),
  processCapture: jest.fn(),
  getCaptureMediaUrls: jest.fn(),
};

jest.mock('../backend/capture-service', () => mockCaptureService);

const { main } = require('../backend/cli.js');

function runCLI(args) {
  const origArgv = process.argv;
  const origExit = process.exit;
  const origLog = console.log;
  const origError = console.error;

  const output = [];
  const errors = [];
  let exitCode = 0;

  process.argv = ['node', 'backend/cli.js', ...args];
  console.log = (...a) => output.push(a.join(' '));
  console.error = (...a) => errors.push(a.join(' '));
  process.exit = (code) => {
    exitCode = code;
    throw new Error(`EXIT_${code}`);
  };

  return main()
    .catch(() => {})
    .then(() => {
      process.argv = origArgv;
      process.exit = origExit;
      console.log = origLog;
      console.error = origError;
      return { output, errors, exitCode };
    });
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe('capture list', () => {
  test('calls listCapturesWithMedia() with unprocessed default', async () => {
    mockCaptureService.listCapturesWithMedia.mockResolvedValue([
      { id: 'abcd1234-0000-0000-0000-000000000000', text: 'buy milk', processed_at: null, created_at: '2026-04-04T10:00:00Z', media: [] },
    ]);

    const { output } = await runCLI(['capture', 'list']);

    expect(mockCaptureService.listCapturesWithMedia).toHaveBeenCalledWith(undefined);
    expect(output[0]).toContain('abcd1234');
    expect(output[0]).toContain('buy milk');
    expect(output[0]).toContain('unprocessed');
  });

  test('capture list --all calls listCapturesWithMedia(true)', async () => {
    mockCaptureService.listCapturesWithMedia.mockResolvedValue([]);

    await runCLI(['capture', 'list', '--all']);

    expect(mockCaptureService.listCapturesWithMedia).toHaveBeenCalledWith(true);
  });

  test('capture list --format json includes media arrays', async () => {
    mockCaptureService.listCapturesWithMedia.mockResolvedValue([
      {
        id: 'abcd1234-0000-0000-0000-000000000000',
        text: 'buy milk',
        processed_at: null,
        created_at: '2026-04-04T10:00:00Z',
        media: [
          { id: 'm1', capture_id: 'abcd1234-0000-0000-0000-000000000000', filename: 'photo.jpg', content_type: 'image/jpeg', storage_path: 'p/photo.jpg', created_at: '2026-04-04T10:00:00Z' },
        ],
      },
    ]);

    const { output } = await runCLI(['capture', 'list', '--format', 'json']);

    const parsed = JSON.parse(output.join('\n'));
    expect(parsed).toHaveLength(1);
    expect(parsed[0].media).toHaveLength(1);
    expect(parsed[0].media[0].filename).toBe('photo.jpg');
    expect(parsed[0].media[0].content_type).toBe('image/jpeg');
  });

  test('capture list text format shows media count when present', async () => {
    mockCaptureService.listCapturesWithMedia.mockResolvedValue([
      { id: 'abcd1234-0000-0000-0000-000000000000', text: 'with files', processed_at: null, created_at: '2026-04-04T10:00:00Z', media: [{ filename: 'a.jpg' }, { filename: 'b.png' }] },
      { id: 'efgh5678-0000-0000-0000-000000000000', text: 'just text', processed_at: null, created_at: '2026-04-04T11:00:00Z', media: [] },
    ]);

    const { output } = await runCLI(['capture', 'list']);

    expect(output[0]).toContain('[2 files]');
    expect(output[1]).not.toContain('file');
  });
});

describe('capture get', () => {
  test('outputs capture details + media', async () => {
    mockCaptureService.getCapture.mockResolvedValue({
      id: 'abcd1234-0000-0000-0000-000000000000',
      text: 'buy milk and eggs',
      processed_at: null,
      created_at: '2026-04-04T10:00:00Z',
      media: [{ filename: 'photo.jpg' }],
    });

    const { output } = await runCLI(['capture', 'get', 'abcd1234-0000-0000-0000-000000000000']);

    expect(mockCaptureService.getCapture).toHaveBeenCalledWith('abcd1234-0000-0000-0000-000000000000');
    expect(output.join('\n')).toContain('buy milk and eggs');
    expect(output.join('\n')).toContain('photo.jpg');
  });

  test('capture get with no id exits with error', async () => {
    const { errors, exitCode } = await runCLI(['capture', 'get']);
    expect(exitCode).toBe(1);
    expect(errors[0]).toContain('Usage');
  });
});

describe('capture process', () => {
  test('marks capture as processed', async () => {
    mockCaptureService.processCapture.mockResolvedValue({ id: 'aaa', processed: true });

    const { output } = await runCLI(['capture', 'process', 'aaa']);

    expect(mockCaptureService.processCapture).toHaveBeenCalledWith('aaa');
    expect(output[0]).toContain('Processed');
  });
});

describe('capture get - PDF filtering', () => {
  test('shows .pdf.md but not the original PDF when both exist', async () => {
    mockCaptureService.getCapture.mockResolvedValue({
      id: 'abcd1234-0000-0000-0000-000000000000',
      text: 'scanned doc',
      processed_at: null,
      created_at: '2026-04-04T10:00:00Z',
      media: [{ filename: 'report.pdf.md' }],
    });

    const { output } = await runCLI(['capture', 'get', 'abcd1234-0000-0000-0000-000000000000']);

    const joined = output.join('\n');
    expect(joined).toContain('report.pdf.md');
    expect(joined).not.toMatch(/\breport\.pdf\b(?!\.md)/);
  });

  test('shows PDF when no .pdf.md sibling exists', async () => {
    mockCaptureService.getCapture.mockResolvedValue({
      id: 'abcd1234-0000-0000-0000-000000000000',
      text: 'raw pdf',
      processed_at: null,
      created_at: '2026-04-04T10:00:00Z',
      media: [{ filename: 'report.pdf' }],
    });

    const { output } = await runCLI(['capture', 'get', 'abcd1234-0000-0000-0000-000000000000']);

    expect(output.join('\n')).toContain('report.pdf');
  });

  test('shows non-PDF media alongside .pdf.md', async () => {
    mockCaptureService.getCapture.mockResolvedValue({
      id: 'abcd1234-0000-0000-0000-000000000000',
      text: 'mixed media',
      processed_at: null,
      created_at: '2026-04-04T10:00:00Z',
      media: [{ filename: 'photo.jpg' }, { filename: 'report.pdf.md' }],
    });

    const { output } = await runCLI(['capture', 'get', 'abcd1234-0000-0000-0000-000000000000']);

    const joined = output.join('\n');
    expect(joined).toContain('photo.jpg');
    expect(joined).toContain('report.pdf.md');
  });
});

describe('capture media - PDF filtering', () => {
  test('shows .pdf.md URL but not original PDF when both exist', async () => {
    mockCaptureService.getCaptureMediaUrls.mockResolvedValue([
      { filename: 'report.pdf.md', content_type: 'text/markdown', url: 'https://example.com/signed/report.pdf.md' },
    ]);

    const { output } = await runCLI(['capture', 'media', 'aaa']);

    const joined = output.join('\n');
    expect(joined).toContain('report.pdf.md');
    expect(joined).not.toMatch(/\breport\.pdf\b(?!\.md)/);
  });

  test('shows PDF URL when no .pdf.md sibling exists', async () => {
    mockCaptureService.getCaptureMediaUrls.mockResolvedValue([
      { filename: 'report.pdf', content_type: 'application/pdf', url: 'https://example.com/signed/report.pdf' },
    ]);

    const { output } = await runCLI(['capture', 'media', 'aaa']);

    expect(output.join('\n')).toContain('report.pdf');
  });
});

describe('capture media', () => {
  test('outputs signed URLs for capture media', async () => {
    mockCaptureService.getCaptureMediaUrls.mockResolvedValue([
      { filename: 'photo.jpg', content_type: 'image/jpeg', url: 'https://example.com/signed/photo.jpg' },
      { filename: 'doc.pdf', content_type: 'application/pdf', url: 'https://example.com/signed/doc.pdf' },
    ]);

    const { output } = await runCLI(['capture', 'media', 'aaa']);

    expect(mockCaptureService.getCaptureMediaUrls).toHaveBeenCalledWith('aaa');
    expect(output[0]).toContain('photo.jpg');
    expect(output[0]).toContain('https://example.com/signed/photo.jpg');
    expect(output[1]).toContain('doc.pdf');
  });

  test('capture media --format json outputs array', async () => {
    mockCaptureService.getCaptureMediaUrls.mockResolvedValue([
      { filename: 'photo.jpg', content_type: 'image/jpeg', url: 'https://example.com/signed/photo.jpg' },
    ]);

    const { output } = await runCLI(['capture', 'media', 'aaa', '--format', 'json']);

    const parsed = JSON.parse(output.join('\n'));
    expect(parsed).toHaveLength(1);
    expect(parsed[0].url).toBe('https://example.com/signed/photo.jpg');
    expect(parsed[0].filename).toBe('photo.jpg');
  });

  test('capture media with no id exits with error', async () => {
    const { errors, exitCode } = await runCLI(['capture', 'media']);
    expect(exitCode).toBe(1);
    expect(errors[0]).toContain('capture_id');
  });

  test('capture media for not-found capture exits with error', async () => {
    mockCaptureService.getCaptureMediaUrls.mockResolvedValue(null);

    const { errors, exitCode } = await runCLI(['capture', 'media', 'nonexistent']);
    expect(exitCode).toBe(1);
    expect(errors[0]).toContain('not found');
  });

  test('capture media with no media shows message', async () => {
    mockCaptureService.getCaptureMediaUrls.mockResolvedValue([]);

    const { output } = await runCLI(['capture', 'media', 'aaa']);
    expect(output[0]).toContain('No media');
  });
});
