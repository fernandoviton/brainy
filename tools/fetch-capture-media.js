#!/usr/bin/env node
/**
 * Download a capture's media into tmp/captures/<capture id>/ so it can be read
 * with the Read tool (images and converted .pdf.md files alike). Original PDFs
 * with a .pdf.md sibling are skipped, as everywhere else.
 *
 * Scheduled agent jobs get this one command instead of general network access.
 *
 * Usage: node tools/fetch-capture-media.js <capture id>
 */
const fs = require('fs');
const path = require('path');

const DEFAULT_DEST = path.join(__dirname, '..', 'tmp', 'captures');

async function fetchCaptureMedia(id, { captureService, storage, destRoot = DEFAULT_DEST }) {
  const capture = await captureService.getCapture(id);
  if (!capture) throw new Error(`capture '${id}' not found`);
  const dir = path.join(destRoot, capture.id);
  fs.mkdirSync(dir, { recursive: true });
  const files = [];
  for (const m of capture.media || []) {
    const dest = path.join(dir, path.basename(m.filename));
    fs.writeFileSync(dest, await storage.downloadMedia(m.storage_path));
    files.push(dest);
  }
  return files;
}

module.exports = { fetchCaptureMedia };

if (require.main === module) {
  const id = process.argv[2];
  if (!id) {
    console.error('Usage: node tools/fetch-capture-media.js <capture id>');
    process.exit(1);
  }
  fetchCaptureMedia(id, {
    captureService: require('../backend/capture-service'),
    storage: require('../backend/storage').getStorage(),
  }).then((files) => {
    console.log(files.length ? files.join('\n') : 'No media on this capture.');
  }).catch((err) => {
    console.error(`Error: ${err.message}`);
    process.exit(1);
  });
}
