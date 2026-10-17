const fs = require('fs');
const os = require('os');
const path = require('path');
const { fetchCaptureMedia } = require('../tools/fetch-capture-media');

let dir;
beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'brainy-media-')); });
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

test('downloads every (non-hidden) media file into <dest>/<capture id>/ and lists the paths', async () => {
  const captureService = {
    getCapture: jest.fn().mockResolvedValue({
      id: 'cap-1',
      media: [
        { filename: 'photo.jpg', storage_path: 'u/captures/1-photo.jpg' },
        { filename: 'report.pdf.md', storage_path: 'u/captures/1-report.pdf.md' },
      ],
    }),
  };
  const storage = { downloadMedia: jest.fn(async (p) => Buffer.from(`bytes:${p}`)) };
  const files = await fetchCaptureMedia('cap', { captureService, storage, destRoot: dir });
  expect(files).toEqual([path.join(dir, 'cap-1', 'photo.jpg'), path.join(dir, 'cap-1', 'report.pdf.md')]);
  expect(fs.readFileSync(files[1], 'utf8')).toBe('bytes:u/captures/1-report.pdf.md');
});

test('filenames cannot escape the destination folder', async () => {
  const captureService = { getCapture: jest.fn().mockResolvedValue({ id: 'c', media: [{ filename: '../../evil.sh', storage_path: 'k' }] }) };
  const storage = { downloadMedia: jest.fn(async () => Buffer.from('x')) };
  const files = await fetchCaptureMedia('c', { captureService, storage, destRoot: dir });
  expect(files).toEqual([path.join(dir, 'c', 'evil.sh')]);
});

test('unknown capture -> error', async () => {
  const captureService = { getCapture: jest.fn().mockResolvedValue(null) };
  await expect(fetchCaptureMedia('nope', { captureService, storage: {}, destRoot: dir })).rejects.toThrow(/not found/);
});
