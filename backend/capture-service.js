const { getStorage } = require('./storage');

/**
 * Filter out PDF media items that have a converted .pdf.md sibling.
 * If both `report.pdf` and `report.pdf.md` exist, the PDF is omitted.
 */
function filterConvertedPdfs(media) {
  const filenames = new Set(media.map((m) => m.filename));
  return media.filter((m) => {
    if (m.content_type === 'application/pdf' && filenames.has(m.filename + '.md')) {
      return false;
    }
    return true;
  });
}

async function listCapturesWithMedia(all) {
  const storage = getStorage();
  const captures = await storage.listCaptures(all);
  if (!captures.length) return captures;

  const ids = captures.map((c) => c.id);
  const media = await storage.listCaptureMedia(ids);

  const byCapture = new Map();
  for (const c of captures) byCapture.set(c.id, { ...c, media: [] });
  for (const m of media) byCapture.get(m.capture_id)?.media.push(m);

  return Array.from(byCapture.values()).map((c) => ({
    ...c,
    media: filterConvertedPdfs(c.media),
  }));
}

async function getCapture(id) {
  const storage = getStorage();
  const resolvedId = await storage.resolveCaptureId(id);
  if (!resolvedId) return null;
  const capture = await storage.getCapture(resolvedId);
  if (!capture) return null;
  return { ...capture, media: filterConvertedPdfs(capture.media) };
}

async function processCapture(id) {
  const storage = getStorage();
  const resolvedId = await storage.resolveCaptureId(id);
  if (!resolvedId) return null;
  return storage.processCapture(resolvedId);
}

async function getCaptureMediaUrls(id) {
  const storage = getStorage();
  const resolvedId = await storage.resolveCaptureId(id);
  if (!resolvedId) return null;
  const capture = await storage.getCapture(resolvedId);
  if (!capture) return null;

  const filtered = filterConvertedPdfs(capture.media);
  if (!filtered.length) return [];

  const paths = filtered.map((m) => m.storage_path);
  const signed = await storage.createSignedMediaUrls(paths);

  const urlByPath = new Map(signed.map((s) => [s.path, s.signedUrl]));
  return filtered.map((m) => ({
    filename: m.filename,
    content_type: m.content_type,
    url: urlByPath.get(m.storage_path),
  }));
}

module.exports = { listCapturesWithMedia, getCapture, processCapture, getCaptureMediaUrls };
