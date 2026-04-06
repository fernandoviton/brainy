const { getStorage } = require('./storage');

async function listCapturesWithMedia(all) {
  const storage = getStorage();
  const captures = await storage.listCaptures(all);
  if (!captures.length) return captures;

  const ids = captures.map((c) => c.id);
  const media = await storage.listCaptureMedia(ids);

  const byCapture = new Map();
  for (const c of captures) byCapture.set(c.id, { ...c, media: [] });
  for (const m of media) byCapture.get(m.capture_id)?.media.push(m);

  return Array.from(byCapture.values());
}

async function getCapture(id) {
  return getStorage().getCapture(id);
}

async function processCapture(id) {
  return getStorage().processCapture(id);
}

async function getCaptureMediaUrls(id) {
  const storage = getStorage();
  const capture = await storage.getCapture(id);
  if (!capture) return null;
  if (!capture.media.length) return [];

  const paths = capture.media.map((m) => m.storage_path);
  const signed = await storage.createSignedMediaUrls(paths);

  const urlByPath = new Map(signed.map((s) => [s.path, s.signedUrl]));
  return capture.media.map((m) => ({
    filename: m.filename,
    content_type: m.content_type,
    url: urlByPath.get(m.storage_path),
  }));
}

module.exports = { listCapturesWithMedia, getCapture, processCapture, getCaptureMediaUrls };
