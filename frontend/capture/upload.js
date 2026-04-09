// eslint-disable-next-line no-unused-vars
function uploadCapture(db, userId, text, files, resizeFn) {
  resizeFn = resizeFn || resizeImageIfNeeded;

  function sanitizeFilename(name) {
    return name.replace(/[^a-zA-Z0-9._-]/g, '-');
  }

  var uploadedFiles = [];
  var resizedFiles = [];

  // Step 1: Resize and upload each file
  var uploadChain = Promise.resolve();
  for (var i = 0; i < files.length; i++) {
    (function (file) {
      uploadChain = uploadChain.then(function () {
        return resizeFn(file).then(function (resized) {
          resizedFiles.push({ name: file.name, wasResized: resized.wasResized });
          var storagePath = userId + '/captures/' + Date.now() + '-' + sanitizeFilename(file.name);
          return db.storage.from('brainy_files').upload(storagePath, resized.file).then(function (uploadResult) {
            if (uploadResult.error) {
              throw new Error('Upload failed: ' + uploadResult.error.message);
            }
            uploadedFiles.push({
              filename: file.name,
              content_type: file.type,
              storage_path: storagePath,
            });
          });
        });
      });
    })(files[i]);
  }

  return uploadChain.then(function () {
    // Step 2: Insert capture record
    return db.from('brainy_captures')
      .insert({ text: text || null, user_id: userId })
      .select()
      .then(function (result) {
        if (result.error) {
          throw new Error('Capture failed: ' + result.error.message);
        }
        var captureId = result.data[0].id;

        // Step 3: Insert media records
        var mediaChain = Promise.resolve();
        for (var j = 0; j < uploadedFiles.length; j++) {
          (function (uploaded) {
            mediaChain = mediaChain.then(function () {
              return db.from('brainy_capture_media').insert({
                user_id: userId,
                capture_id: captureId,
                filename: uploaded.filename,
                content_type: uploaded.content_type,
                storage_path: uploaded.storage_path,
              }).then(function (mediaResult) {
                if (mediaResult.error) {
                  throw new Error('Media record failed: ' + mediaResult.error.message);
                }
              });
            });
          })(uploadedFiles[j]);
        }

        return mediaChain.then(function () {
          return { captureId: captureId, resizedFiles: resizedFiles };
        });
      });
  });
}
