const { getStorage } = require('../backend/storage');
const { execFile } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

function convertPdf(inputPath, outputPath) {
  const pythonPath = path.join(__dirname, '.venv', 'Scripts', 'python.exe');
  const scriptPath = path.join(__dirname, 'pdf-to-md.py');
  return new Promise((resolve, reject) => {
    execFile(pythonPath, [scriptPath, inputPath, outputPath], (err, stdout, stderr) => {
      if (err) reject(new Error(`PDF conversion failed: ${stderr || err.message}`));
      else resolve();
    });
  });
}

async function convertAllCapturePdfs() {
  const storage = getStorage();
  const captures = await storage.listCaptures(false);

  if (!captures.length) {
    console.log('No unprocessed captures.');
    return { converted: 0, failed: 0 };
  }

  const ids = captures.map((c) => c.id);
  const allMedia = await storage.listCaptureMedia(ids);

  // Group media by capture and find unconverted PDFs
  const filenames = new Set(allMedia.map((m) => m.filename));
  const pdfs = allMedia.filter(
    (m) => m.content_type === 'application/pdf' && !filenames.has(m.filename + '.md')
  );

  if (!pdfs.length) {
    console.log('No PDFs to convert.');
    return { converted: 0, failed: 0 };
  }

  console.log(`Found ${pdfs.length} PDF(s) across ${captures.length} capture(s). Converting...`);

  let converted = 0;
  let failed = 0;

  for (let i = 0; i < pdfs.length; i++) {
    const pdf = pdfs[i];
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'brainy-pdf-'));
    const tmpPdf = path.join(tmpDir, pdf.filename);
    const tmpMd = path.join(tmpDir, pdf.filename + '.md');

    try {
      process.stdout.write(`  [${i + 1}/${pdfs.length}] Converting ${pdf.storage_path}...`);
      const buffer = await storage.downloadMedia(pdf.storage_path);
      fs.writeFileSync(tmpPdf, buffer);
      await convertPdf(tmpPdf, tmpMd);
      const mdBuffer = fs.readFileSync(tmpMd);
      await storage.uploadCaptureMedia({
        captureId: pdf.capture_id,
        filename: pdf.filename + '.md',
        contentType: 'text/markdown',
        buffer: mdBuffer,
      });
      converted++;
      console.log(' Done.');
    } catch (err) {
      failed++;
      console.error(` Failed: ${err.message}`);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  }

  console.log(`Done. Converted: ${converted}, Failed: ${failed}`);
  return { converted, failed };
}

if (require.main === module) {
  convertAllCapturePdfs().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}

module.exports = { convertAllCapturePdfs };
