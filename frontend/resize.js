// eslint-disable-next-line no-unused-vars
function resizeImageIfNeeded(file, maxDimension) {
  maxDimension = maxDimension || 1920;

  if (!file.type || !file.type.match(/^image\//)) {
    return Promise.resolve({ file: file, wasResized: false });
  }

  if (typeof createImageBitmap === 'undefined') {
    return Promise.resolve({ file: file, wasResized: false });
  }

  return createImageBitmap(file).then(function (bitmap) {
    var w = bitmap.width;
    var h = bitmap.height;

    if (w <= maxDimension && h <= maxDimension) {
      bitmap.close();
      return { file: file, wasResized: false };
    }

    var ratio = maxDimension / Math.max(w, h);
    var newW = Math.round(w * ratio);
    var newH = Math.round(h * ratio);

    var canvas = document.createElement('canvas');
    canvas.width = newW;
    canvas.height = newH;
    var ctx = canvas.getContext('2d');
    ctx.drawImage(bitmap, 0, 0, newW, newH);
    bitmap.close();

    return new Promise(function (resolve) {
      canvas.toBlob(function (blob) {
        resolve({ file: blob, wasResized: true });
      }, 'image/jpeg', 0.85);
    });
  }).catch(function () {
    return { file: file, wasResized: false };
  });
}
