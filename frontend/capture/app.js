var db = supabase.createClient(CONFIG.SUPABASE_URL, CONFIG.SUPABASE_PUBLISHABLE_KEY);

var captureForm = document.getElementById('capture-form');
var loginBtn = document.getElementById('login-btn');
var logoutBtn = document.getElementById('logout-btn');
var authSection = document.getElementById('auth-section');
var captureSection = document.getElementById('capture-section');
var captureBtn = document.getElementById('capture-btn');
var statusMsg = document.getElementById('status-msg');
var fileInput = document.getElementById('file-input');
var attachBtn = document.getElementById('attach-btn');
var filePreview = document.getElementById('file-preview');
var resizeStatus = document.getElementById('resize-status');

var _pendingFiles = [];

function showStatus(message, className) {
  statusMsg.textContent = message;
  statusMsg.className = className;
}

function resetButton() {
  captureBtn.disabled = false;
  captureBtn.textContent = 'Capture';
}

db.auth.onAuthStateChange(function (event, session) {
  if (session) {
    authSection.style.display = 'none';
    captureSection.style.display = 'block';
  } else {
    authSection.style.display = 'block';
    captureSection.style.display = 'none';
  }
});

loginBtn.addEventListener('click', function () {
  db.auth.signInWithOAuth({
    provider: 'google',
    options: {
      redirectTo: window.location.origin + window.location.pathname,
    },
  });
});

logoutBtn.addEventListener('click', function () {
  db.auth.signOut();
});

attachBtn.addEventListener('click', function () {
  fileInput.click();
});

function _renderPreview() {
  var html = '';
  for (var i = 0; i < _pendingFiles.length; i++) {
    html += '<div class="file-preview-item">' +
      '<span>' + _pendingFiles[i].name + '</span>' +
      '<button type="button" data-index="' + i + '" class="remove-file">\u00d7</button>' +
      '</div>';
  }
  filePreview.innerHTML = html;
}

function _removeFile(index) {
  _pendingFiles.splice(index, 1);
  _renderPreview();
}

fileInput.addEventListener('change', function () {
  for (var i = 0; i < fileInput.files.length; i++) {
    _pendingFiles.push(fileInput.files[i]);
  }
  _renderPreview();
});

captureForm.addEventListener('submit', function (e) {
  e.preventDefault();
  var text = document.getElementById('capture-text').value.trim();
  if (!text && _pendingFiles.length === 0) return;

  captureBtn.disabled = true;
  captureBtn.textContent = _pendingFiles.length > 0 ? 'Uploading...' : 'Capturing...';
  statusMsg.textContent = '';
  statusMsg.className = '';
  resizeStatus.textContent = '';

  db.auth.getUser().then(function (userResult) {
    if (!userResult.data.user) {
      var msg = navigator.onLine ? 'not signed in' : 'no internet connection';
      showStatus('Capture failed: ' + msg, 'status-error');
      resetButton();
      return;
    }
    return uploadCapture(db, userResult.data.user.id, text, _pendingFiles)
      .then(function (result) {
        // Show resize notifications
        var resized = result.resizedFiles.filter(function (f) { return f.wasResized; });
        if (resized.length > 0) {
          var names = resized.map(function (f) { return f.name; }).join(', ');
          resizeStatus.textContent = 'Resized: ' + names;
        }

        document.getElementById('capture-text').value = '';
        _pendingFiles = [];
        filePreview.innerHTML = '';
        captureBtn.textContent = '\u2713 Done!';
        captureBtn.className = 'btn-success';
        captureBtn.disabled = false;
        setTimeout(function () {
          captureBtn.textContent = 'Capture';
          captureBtn.className = '';
        }, 1500);
      });
  }).catch(function (err) {
    var msg = err.message;
    if (msg.match(/fetch/i)) {
      msg = "can't find the file, please try again";
    } else if (msg.match(/network/i)) {
      msg = 'check your internet connection';
    }
    showStatus('Capture failed: ' + msg, 'status-error');
    resetButton();
  });
});
