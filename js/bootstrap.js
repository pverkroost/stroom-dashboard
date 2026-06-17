// Bootstrap: bepaalt de actieve gebruiker en laadt daarna pas user-config +
// app-scripts. Vervangt de oude inline ?u=-loader + statische script-tags.
//
// Volgorde:
//  1. Expliciete ?u= in de URL → legacy-modus, auth overgeslagen (backwards-compat
//     tijdens de transitie naar echte login).
//  2. Anders → GET /api/auth?action=me. 200 → start app met session.userId. 401 → login-overlay.
(function () {
  var GELDIGE_USERS = ['001', '002'];

  function loadScript(src) {
    return new Promise(function (resolve, reject) {
      var s = document.createElement('script');
      s.src = src;
      s.onload = resolve;
      s.onerror = function () { reject(new Error('Kon script niet laden: ' + src)); };
      document.body.appendChild(s);
    });
  }

  // Laad user-config + app-modules sequentieel — zelfde volgorde als de oude
  // statische <script>-tags: users/<id>.js zet window.CONFIG, config.js leest dat,
  // app.js verwacht de overige modules.
  async function startApp(userId) {
    var v = '?v=' + window.APP_VERSION;
    var bestanden = [
      'users/' + userId + '.js' + v,
      'js/config.js' + v,
      'js/solar.js' + v,
      'js/prijzen.js' + v,
      'js/apparaten.js' + v,
      'js/app.js' + v,
    ];
    for (var i = 0; i < bestanden.length; i++) {
      await loadScript(bestanden[i]);
    }
  }

  function toonLogin() {
    var overlay = document.getElementById('loginOverlay');
    if (overlay) overlay.style.display = 'flex';
    var email = document.getElementById('loginEmail');
    if (email) email.focus();
  }

  async function doeLogin(e) {
    if (e) e.preventDefault();
    var btn   = document.getElementById('loginBtn');
    var fout  = document.getElementById('loginFout');
    var email = (document.getElementById('loginEmail') || {}).value || '';
    var pw    = (document.getElementById('loginWachtwoord') || {}).value || '';
    if (fout) fout.style.display = 'none';
    if (btn) { btn.disabled = true; btn.textContent = 'Bezig…'; }
    try {
      var r = await fetch('/api/auth?action=login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ email: email.trim(), wachtwoord: pw }),
      });
      var data = await r.json().catch(function () { return {}; });
      if (r.ok && data.success) {
        window.location.reload();
        return false;
      }
      if (fout) {
        fout.textContent = data.error || 'Inloggen mislukt';
        fout.style.display = 'block';
      }
    } catch (err) {
      if (fout) { fout.textContent = 'Verbindingsfout — probeer opnieuw'; fout.style.display = 'block'; }
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = 'Inloggen'; }
    }
    return false;
  }

  // Globaal beschikbaar voor het inline onsubmit van het login-formulier.
  window._eqDoeLogin = doeLogin;

  async function init() {
    var legacyU = new URLSearchParams(window.location.search).get('u');
    if (legacyU) {
      startApp(GELDIGE_USERS.indexOf(legacyU) >= 0 ? legacyU : '001');
      return;
    }
    try {
      var r = await fetch('/api/auth?action=me', { credentials: 'same-origin' });
      if (r.ok) {
        var session = await r.json();
        startApp(GELDIGE_USERS.indexOf(session.userId) >= 0 ? session.userId : '001');
      } else {
        toonLogin();
      }
    } catch (err) {
      toonLogin();
    }
  }

  init();
})();
