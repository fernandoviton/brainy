var db = supabase.createClient(CONFIG.SUPABASE_URL, CONFIG.SUPABASE_PUBLISHABLE_KEY);

var captureForm = document.getElementById('capture-form');
var loginBtn = document.getElementById('login-btn');
var authSection = document.getElementById('auth-section');
var captureSection = document.getElementById('capture-section');

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

captureForm.addEventListener('submit', function (e) {
  e.preventDefault();
  var text = document.getElementById('capture-text').value.trim();
  if (!text) return;

  db.from('brainy_captures')
    .insert({ text: text })
    .then(function (result) {
      if (result.error) {
        console.error('Capture failed:', result.error.message);
        return;
      }
      document.getElementById('capture-text').value = '';
    });
});
