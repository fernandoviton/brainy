const mockStorage = {
  listCaptures: jest.fn(),
  listCaptureMedia: jest.fn(),
  downloadMedia: jest.fn(),
  uploadCaptureMedia: jest.fn(),
};

jest.mock('../backend/storage', () => ({
  getStorage: () => mockStorage,
}));

const mockExecFile = jest.fn();
jest.mock('child_process', () => ({
  execFile: mockExecFile,
}));

const { convertAllCapturePdfs } = require('../tools/convert-capture-pdfs');

beforeEach(() => {
  jest.clearAllMocks();
});

describe('convertAllCapturePdfs', () => {
  test('no unprocessed captures → no work done', async () => {
    mockStorage.listCaptures.mockResolvedValue([]);

    const result = await convertAllCapturePdfs();

    expect(result.converted).toBe(0);
    expect(mockStorage.listCaptureMedia).not.toHaveBeenCalled();
  });

  test('captures with no PDFs → no downloads', async () => {
    mockStorage.listCaptures.mockResolvedValue([
      { id: 'aaa', text: 'text only' },
    ]);
    mockStorage.listCaptureMedia.mockResolvedValue([
      { id: 'm1', capture_id: 'aaa', filename: 'photo.jpg', content_type: 'image/jpeg', storage_path: 'p/photo.jpg' },
    ]);

    const result = await convertAllCapturePdfs();

    expect(result.converted).toBe(0);
    expect(mockStorage.downloadMedia).not.toHaveBeenCalled();
  });

  test('PDFs already converted (.pdf.md sibling exists) → skipped', async () => {
    mockStorage.listCaptures.mockResolvedValue([
      { id: 'aaa', text: 'has pdf' },
    ]);
    mockStorage.listCaptureMedia.mockResolvedValue([
      { id: 'm1', capture_id: 'aaa', filename: 'report.pdf', content_type: 'application/pdf', storage_path: 'p/report.pdf' },
      { id: 'm2', capture_id: 'aaa', filename: 'report.pdf.md', content_type: 'text/markdown', storage_path: 'p/report.pdf.md' },
    ]);

    const result = await convertAllCapturePdfs();

    expect(result.converted).toBe(0);
    expect(mockStorage.downloadMedia).not.toHaveBeenCalled();
  });

  test('unconverted PDF → downloads, converts, uploads .pdf.md', async () => {
    mockStorage.listCaptures.mockResolvedValue([
      { id: 'aaa', text: 'new pdf' },
    ]);
    mockStorage.listCaptureMedia.mockResolvedValue([
      { id: 'm1', capture_id: 'aaa', filename: 'report.pdf', content_type: 'application/pdf', storage_path: 'p/aaa/report.pdf' },
    ]);
    mockStorage.downloadMedia.mockResolvedValue(Buffer.from('fake-pdf'));
    mockStorage.uploadCaptureMedia.mockResolvedValue({ filename: 'report.pdf.md' });

    mockExecFile.mockImplementation((cmd, args, cb) => {
      const outputPath = args[args.length - 1];
      require('fs').writeFileSync(outputPath, '# Converted content');
      cb(null, '', '');
    });

    const result = await convertAllCapturePdfs();

    expect(result.converted).toBe(1);
    expect(mockStorage.downloadMedia).toHaveBeenCalledWith('p/aaa/report.pdf');
    expect(mockStorage.uploadCaptureMedia).toHaveBeenCalledWith({
      captureId: 'aaa',
      filename: 'report.pdf.md',
      contentType: 'text/markdown',
      buffer: expect.any(Buffer),
    });
  });

  test('multiple PDFs across captures → all processed', async () => {
    mockStorage.listCaptures.mockResolvedValue([
      { id: 'aaa', text: 'first' },
      { id: 'bbb', text: 'second' },
    ]);
    mockStorage.listCaptureMedia.mockResolvedValue([
      { id: 'm1', capture_id: 'aaa', filename: 'doc1.pdf', content_type: 'application/pdf', storage_path: 'p/aaa/doc1.pdf' },
      { id: 'm2', capture_id: 'bbb', filename: 'doc2.pdf', content_type: 'application/pdf', storage_path: 'p/bbb/doc2.pdf' },
    ]);
    mockStorage.downloadMedia.mockResolvedValue(Buffer.from('fake-pdf'));
    mockStorage.uploadCaptureMedia.mockResolvedValue({});

    mockExecFile.mockImplementation((cmd, args, cb) => {
      const outputPath = args[args.length - 1];
      require('fs').writeFileSync(outputPath, '# Converted');
      cb(null, '', '');
    });

    const result = await convertAllCapturePdfs();

    expect(result.converted).toBe(2);
    expect(mockStorage.downloadMedia).toHaveBeenCalledTimes(2);
    expect(mockStorage.uploadCaptureMedia).toHaveBeenCalledTimes(2);
  });

  test('conversion failure → logs error, continues with remaining', async () => {
    mockStorage.listCaptures.mockResolvedValue([
      { id: 'aaa', text: 'has pdfs' },
    ]);
    mockStorage.listCaptureMedia.mockResolvedValue([
      { id: 'm1', capture_id: 'aaa', filename: 'bad.pdf', content_type: 'application/pdf', storage_path: 'p/aaa/bad.pdf' },
      { id: 'm2', capture_id: 'aaa', filename: 'good.pdf', content_type: 'application/pdf', storage_path: 'p/aaa/good.pdf' },
    ]);
    mockStorage.downloadMedia.mockResolvedValue(Buffer.from('fake-pdf'));
    mockStorage.uploadCaptureMedia.mockResolvedValue({});

    let callCount = 0;
    mockExecFile.mockImplementation((cmd, args, cb) => {
      callCount++;
      if (callCount === 1) {
        cb(new Error('marker-pdf crashed'), '', 'segfault');
      } else {
        const outputPath = args[args.length - 1];
        require('fs').writeFileSync(outputPath, '# Converted');
        cb(null, '', '');
      }
    });

    const consoleSpy = jest.spyOn(console, 'error').mockImplementation();
    const result = await convertAllCapturePdfs();
    consoleSpy.mockRestore();

    expect(result.converted).toBe(1);
    expect(result.failed).toBe(1);
  });
});
