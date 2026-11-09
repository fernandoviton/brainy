// Attachment viewer: renders an HTML attachment that Supabase Storage would
// otherwise serve as text/plain (see attachmentViewerHref in utils.js).
//
// The file is downloaded with the signed-in client and handed to a sandboxed
// iframe via srcdoc. The sandbox has no allow-same-origin, so the document
// gets an opaque origin: its scripts run, but can't read this origin's
// localStorage (the Supabase session) or cookies. Never render it through a
// blob: URL or document.write here — both would run it as Brainy.

var db = supabase.createClient(CONFIG.SUPABASE_URL, CONFIG.SUPABASE_PUBLISHABLE_KEY);

var authSection = document.getElementById('auth-section');
var loginBtn = document.getElementById('login-btn');
var titleEl = document.getElementById('viewer-title');
var rawEl = document.getElementById('viewer-raw');
var statusEl = document.getElementById('viewer-status');
var frameEl = document.getElementById('viewer-frame');

// "#path=<storage path>&name=<filename>", as built by attachmentViewerHref.
function parseViewerHash(hash) {
  var out = { path: '', name: '' };
  var parts = (hash || '').replace(/^#/, '').split('&');
  for (var i = 0; i < parts.length; i++) {
    var eq = parts[i].indexOf('=');
    if (eq === -1) continue;
    var key = parts[i].substring(0, eq);
    if (key !== 'path' && key !== 'name') continue;
    try {
      out[key] = decodeURIComponent(parts[i].substring(eq + 1));
    } catch (e) {
      out[key] = '';
    }
  }
  if (!out.name && out.path) out.name = out.path.substring(out.path.lastIndexOf('/') + 1);
  return out;
}

// Belt and braces: the sandbox lives in index.html, but refuse to render if an
// edit ever drops it or adds allow-same-origin.
function frameIsIsolated() {
  var sandbox = frameEl.getAttribute('sandbox');
  if (sandbox === null || sandbox === undefined) return false;
  return !/\ballow-same-origin\b/.test(sandbox);
}

// about:srcdoc can't change its URL, so history.pushState/replaceState with a
// URL throws a SecurityError — and slide decks that mirror the slide number
// into the hash do that on every change, killing their script. Injected into
// the document (so it runs inside the sandbox), the shim retries without the URL.
var SRCDOC_SHIM = '<script data-brainy-shim>(function () {' +
  '["pushState", "replaceState"].forEach(function (m) {' +
    'var orig = history[m];' +
    'history[m] = function (state, title, url) {' +
      'try { return orig.call(history, state, title, url); }' +
      'catch (e) { try { return orig.call(history, state, title); } catch (e2) {} }' +
    '};' +
  '});' +
'})();</script>';

// Insert the shim as early as possible without preceding the doctype (which
// would drop the document into quirks mode).
function withSrcdocShims(html) {
  var m = /<head(\s[^>]*)?>/i.exec(html) || /<html(\s[^>]*)?>/i.exec(html) || /^\s*<!doctype[^>]*>/i.exec(html);
  var at = m ? m.index + m[0].length : 0;
  return html.substring(0, at) + SRCDOC_SHIM + html.substring(at);
}

// Signing in returns here with the session in the URL hash, replacing the
// attachment path, so the path is parked in sessionStorage across the trip.
var TARGET_KEY = 'brainy.viewerTarget';
var _session = window.sessionStorage;
var _target = parseViewerHash(window.location.hash);
if (!_target.path && _session) _target = parseViewerHash(_session.getItem(TARGET_KEY));
var _loaded = false;

if (_target.name) {
  titleEl.textContent = _target.name;
  document.title = _target.name + ' — Brainy';
}

function loadAttachment() {
  if (!_target.path) {
    statusEl.textContent = 'No attachment specified.';
    return;
  }
  if (!frameIsIsolated()) {
    statusEl.textContent = 'Refusing to render: the viewer frame is not sandboxed.';
    return;
  }

  var bucket = db.storage.from('brainy_files');

  bucket.createSignedUrl(_target.path, 3600, { download: _target.name })
    .then(function (result) {
      if (result.data && result.data.signedUrl) rawEl.href = result.data.signedUrl;
    });

  statusEl.textContent = 'Loading…';
  bucket.download(_target.path)
    .then(function (result) {
      if (result.error || !result.data) {
        throw new Error((result.error && result.error.message) || 'empty response');
      }
      return result.data.text();
    })
    .then(function (html) {
      statusEl.textContent = '';
      frameEl.srcdoc = withSrcdocShims(html);
    })
    .catch(function (err) {
      statusEl.textContent = 'Could not load attachment: ' + err.message;
    });
}

// So keyboard-driven content (slide decks) works without a click first.
// Focusing before the srcdoc document has loaded doesn't stick.
frameEl.addEventListener('load', function () {
  if (frameEl.srcdoc) frameEl.focus();
});

db.auth.onAuthStateChange(function (event, session) {
  if (session) {
    authSection.style.display = 'none';
    if (_session) _session.removeItem(TARGET_KEY);
    if (!_loaded) {
      _loaded = true;
      loadAttachment();
    }
  } else {
    authSection.style.display = 'block';
  }
});

loginBtn.addEventListener('click', function () {
  if (_session && _target.path) _session.setItem(TARGET_KEY, attachmentViewerHref(_target.path, _target.name).replace(/^[^#]*/, ''));
  db.auth.signInWithOAuth({
    provider: 'google',
    options: { redirectTo: window.location.origin + window.location.pathname },
  });
});
