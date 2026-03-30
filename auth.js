/* ══════════════════════════════════════════════
   AUTH GATE — Alan's Brain
   SHA-256 hashed passphrase check.
   
   HOW TO SET YOUR PASSPHRASE:
   ──────────────────────────────────────────────
   1. Pick a passphrase (e.g. "our house rocks")
   2. Open your browser console (F12 → Console) and run:
   
      crypto.subtle.digest('SHA-256', new TextEncoder().encode('our house rocks'))
        .then(b => console.log(Array.from(new Uint8Array(b)).map(x => x.toString(16).padStart(2,'0')).join('')));
   
   3. Copy the hex string it prints
   4. Paste it into PASSPHRASE_HASH below
   5. Share the passphrase (NOT the hash) with your people
   ──────────────────────────────────────────────
   ══════════════════════════════════════════════ */

var PASSPHRASE_HASH = 'e1d2af2c58543c34910115fa89871af058e5274adc2a8955dd8385d0b303ef25'; // <-- PASTE YOUR SHA-256 HEX HASH HERE

// Key used in sessionStorage so the unlock persists across page navigations
var AUTH_SESSION_KEY = 'ab_auth';

/**
 * Hash a string using SHA-256 and return the hex digest.
 */
function hashPassphrase(input) {
  return crypto.subtle.digest('SHA-256', new TextEncoder().encode(input))
    .then(function(buffer) {
      return Array.from(new Uint8Array(buffer))
        .map(function(b) { return b.toString(16).padStart(2, '0'); })
        .join('');
    });
}

/**
 * Check if the user is already authenticated this session.
 */
function isAuthenticated() {
  // If no hash is configured, skip the gate entirely (dev/setup mode)
  if (!PASSPHRASE_HASH) return true;
  return sessionStorage.getItem(AUTH_SESSION_KEY) === PASSPHRASE_HASH;
}

/**
 * Initialize the auth gate on a protected page.
 * Call this from any page that needs passphrase protection.
 *
 * - gateId: the ID of the .auth-gate element
 * - protectedId: the ID of the wrapper around protected content
 * - onUnlock: optional callback to run after successful unlock (e.g. loadTasks)
 */
function initAuthGate(gateId, protectedId, onUnlock) {
  var gate = document.getElementById(gateId);
  var protectedContent = document.getElementById(protectedId);
  var input = gate ? gate.querySelector('.auth-input') : null;
  var btn = gate ? gate.querySelector('.auth-btn') : null;
  var error = gate ? gate.querySelector('.auth-error') : null;

  // If no hash configured or already authenticated, skip the gate
  if (isAuthenticated()) {
    if (gate) gate.remove();
    if (protectedContent) protectedContent.style.display = '';
    if (onUnlock) onUnlock();
    return;
  }

  // Check for passphrase in URL parameter (?p=yourpassphrase)
  var urlParams = new URLSearchParams(window.location.search);
  var urlPass = urlParams.get('p');
  if (urlPass) {
    // Clean the passphrase out of the address bar immediately
    urlParams.delete('p');
    var cleanUrl = window.location.pathname + (urlParams.toString() ? '?' + urlParams.toString() : '') + window.location.hash;
    history.replaceState(null, '', cleanUrl);

    // Hash and verify
    hashPassphrase(urlPass).then(function(hash) {
      if (hash === PASSPHRASE_HASH) {
        sessionStorage.setItem(AUTH_SESSION_KEY, PASSPHRASE_HASH);
        if (gate) gate.remove();
        if (protectedContent) protectedContent.style.display = '';
        if (onUnlock) onUnlock();
      }
      // If wrong, just show the normal gate (don't reveal the error — they might have a typo in the URL)
    });
    return;
  }

  // Show gate, hide protected content
  if (protectedContent) protectedContent.style.display = 'none';

  function attemptUnlock() {
    var value = input.value.trim();
    if (!value) {
      input.focus();
      return;
    }

    btn.textContent = '...';
    btn.disabled = true;

    hashPassphrase(value).then(function(hash) {
      if (hash === PASSPHRASE_HASH) {
        // Success — store in session and reveal content
        sessionStorage.setItem(AUTH_SESSION_KEY, PASSPHRASE_HASH);
        gate.classList.add('unlocked');
        setTimeout(function() {
          gate.remove();
          if (protectedContent) {
            protectedContent.style.display = '';
            protectedContent.style.animation = 'fadeUp 0.4s ease forwards';
          }
          if (onUnlock) onUnlock();
        }, 500);
      } else {
        // Wrong passphrase
        btn.textContent = 'UNLOCK';
        btn.disabled = false;
        input.value = '';
        input.classList.add('shake');
        if (error) error.classList.add('visible');
        setTimeout(function() {
          input.classList.remove('shake');
        }, 600);
        input.focus();
      }
    });
  }

  if (btn) btn.addEventListener('click', attemptUnlock);
  if (input) {
    input.addEventListener('keydown', function(e) {
      if (e.key === 'Enter') attemptUnlock();
      // Clear error when they start typing again
      if (error) error.classList.remove('visible');
    });
    // Auto-focus the input
    setTimeout(function() { input.focus(); }, 100);
  }
}
