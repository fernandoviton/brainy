var db = supabase.createClient(CONFIG.SUPABASE_URL, CONFIG.SUPABASE_PUBLISHABLE_KEY);

var authSection = document.getElementById('auth-section');
var contentSection = document.getElementById('content-section');
var loginBtn = document.getElementById('login-btn');
var logoutBtn = document.getElementById('logout-btn');
var cardsEl = document.getElementById('cards');
var statusMsg = document.getElementById('status-msg');

var _processedFilter = 'unprocessed';

function showStatus(message, className) {
  statusMsg.textContent = message;
  statusMsg.className = className;
}

db.auth.onAuthStateChange(function (event, session) {
  if (session) {
    authSection.style.display = 'none';
    contentSection.style.display = 'block';
    loadCaptures();
  } else {
    authSection.style.display = 'block';
    contentSection.style.display = 'none';
  }
});

loginBtn.addEventListener('click', function () {
  db.auth.signInWithOAuth({
    provider: 'google',
    options: { redirectTo: window.location.origin + window.location.pathname },
  });
});

logoutBtn.addEventListener('click', function () {
  db.auth.signOut();
});

// Filter pill handler
var processedGroup = document.getElementById('processed-filter');
processedGroup.addEventListener('click', function (e) {
  if (!e.target.classList.contains('pill')) return;
  var pills = processedGroup.querySelectorAll('.pill');
  for (var i = 0; i < pills.length; i++) pills[i].classList.remove('active');
  e.target.classList.add('active');
  _processedFilter = e.target.getAttribute('data-value');
  loadCaptures();
});

function loadCaptures() {
  var query = db.from('brainy_captures')
    .select('*, brainy_capture_media(filename, content_type, storage_path)')
    .order('created_at', { ascending: false })
    .limit(50);

  if (_processedFilter === 'processed') query = query.not('processed_at', 'is', null);
  if (_processedFilter === 'unprocessed') query = query.is('processed_at', null);

  query.then(function (result) {
    if (result.error) {
      showStatus('Failed to load: ' + result.error.message, 'status-error');
      return;
    }
    renderCaptures(result.data);
  });
}

function getSignedUrl(storagePath) {
  return db.storage.from('brainy_files').createSignedUrl(storagePath, 3600)
    .then(function (result) {
      return result.data ? result.data.signedUrl : null;
    });
}

function renderCaptures(captures) {
  if (!captures || captures.length === 0) {
    cardsEl.innerHTML = '<div class="empty-state">No captures found.</div>';
    return;
  }

  var html = '';
  for (var i = 0; i < captures.length; i++) {
    var c = captures[i];
    var media = c.brainy_capture_media || [];
    var processedClass = c.processed_at ? 'badge-processed' : 'badge-unprocessed';
    var processedLabel = c.processed_at ? 'Processed' : 'Unprocessed';

    html += '<div class="card">' +
      (c.text ? '<div class="card-text">' + escapeHtml(truncate(c.text, 300)) + '</div>' : '') +
      (media.length > 0 ? '<div class="card-media" data-capture="' + i + '">' + renderMediaPlaceholders(media) + '</div>' : '') +
      '<div class="card-meta">' +
        '<span class="' + processedClass + '">' + processedLabel + '</span>' +
        (media.length > 0 ? '<span>' + media.length + ' file' + (media.length > 1 ? 's' : '') + '</span>' : '') +
        '<span>' + escapeHtml(formatDate(c.created_at)) + '</span>' +
      '</div>' +
    '</div>';
  }
  cardsEl.innerHTML = html;

  // Load signed URLs for media
  for (var j = 0; j < captures.length; j++) {
    var mediaItems = captures[j].brainy_capture_media || [];
    if (mediaItems.length > 0) {
      loadMediaUrls(j, mediaItems);
    }
  }
}

function renderMediaPlaceholders(media) {
  var html = '';
  for (var i = 0; i < media.length; i++) {
    var m = media[i];
    if (m.content_type && m.content_type.match(/^image\//)) {
      html += '<span class="media-file" data-path="' + escapeHtml(m.storage_path) + '" data-type="image">' + escapeHtml(m.filename) + '</span>';
    } else {
      html += '<span class="media-file" data-path="' + escapeHtml(m.storage_path) + '">' + escapeHtml(m.filename) + '</span>';
    }
  }
  return html;
}

function loadMediaUrls(captureIndex, mediaItems) {
  var container = document.querySelector('[data-capture="' + captureIndex + '"]');
  if (!container) return;

  for (var i = 0; i < mediaItems.length; i++) {
    (function (idx, item) {
      getSignedUrl(item.storage_path).then(function (url) {
        if (!url) return;
        var el = container.children[idx];
        if (!el) return;

        if (item.content_type && item.content_type.match(/^image\//)) {
          var img = document.createElement('img');
          img.className = 'media-thumb';
          img.src = url;
          img.alt = item.filename;
          img.addEventListener('click', function () { window.open(url, '_blank'); });
          el.parentNode.replaceChild(img, el);
        } else {
          var a = document.createElement('a');
          a.className = 'media-file';
          a.href = url;
          a.target = '_blank';
          a.textContent = item.filename;
          el.parentNode.replaceChild(a, el);
        }
      });
    })(i, mediaItems[i]);
  }
}
