var db = supabase.createClient(CONFIG.SUPABASE_URL, CONFIG.SUPABASE_PUBLISHABLE_KEY);

var captureForm = document.getElementById('capture-form');
var loginBtn = document.getElementById('login-btn');
var logoutBtn = document.getElementById('logout-btn');
var authSection = document.getElementById('auth-section');
var captureSection = document.getElementById('capture-section');
var captureBtn = document.getElementById('capture-btn');
var statusMsg = document.getElementById('status-msg');

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

captureForm.addEventListener('submit', function (e) {
  e.preventDefault();
  var text = document.getElementById('capture-text').value.trim();
  if (!text) return;

  captureBtn.disabled = true;
  captureBtn.textContent = 'Capturing...';
  statusMsg.textContent = '';
  statusMsg.className = '';

  db.auth.getUser().then(function (userResult) {
    if (!userResult.data.user) {
      var msg = navigator.onLine ? 'not signed in' : 'no internet connection';
      showStatus('Capture failed: ' + msg, 'status-error');
      resetButton();
      return;
    }
    return db.from('brainy_captures')
      .insert({ text: text, user_id: userResult.data.user.id })
      .then(function (result) {
        if (result.error) {
          showStatus('Capture failed: ' + result.error.message, 'status-error');
          resetButton();
          return;
        }
        document.getElementById('capture-text').value = '';
        captureBtn.textContent = '\u2713 Done!';
        captureBtn.className = 'btn-success';
        captureBtn.disabled = false;
        setTimeout(function () {
          captureBtn.textContent = 'Capture';
          captureBtn.className = '';
        }, 1500);
      });
  }).catch(function (err) {
    showStatus('Capture failed: ' + err.message, 'status-error');
    resetButton();
  });
});
