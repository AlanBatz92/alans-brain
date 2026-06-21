/* ═══════════════════════════════════════════
   THEME SWITCHER — Alan's Brain
   Swaps CSS custom properties via data-theme attribute.
   Loads theme CSS on demand. Persists choice in localStorage.
   ═══════════════════════════════════════════ */

var THEMES = {
  default:   { label: 'Deep Space', css: null },
  starfield: { label: 'Starfield',  css: 'themes/starfield.css' },
  quake2:    { label: 'Quake II',   css: 'themes/quake2.css' }
};

var STORAGE_KEY = 'ab_theme';

/**
 * Lazy-load the starfield canvas script — only ever fetched when the
 * Starfield theme is actually used, so it adds no overhead otherwise.
 * starfield.js self-boots on load and then listens for `themechange`.
 */
function ensureStarfield() {
  if (document.getElementById('starfield-js')) return;
  var s = document.createElement('script');
  s.id = 'starfield-js';
  s.src = 'starfield.js';
  s.defer = true;
  document.head.appendChild(s);
}

/**
 * Apply a theme by name.
 * Sets data-theme on <html>, loads theme CSS, saves to localStorage.
 */
function setTheme(name) {
  var theme = THEMES[name];
  if (!theme) return;

  // Remove any previously loaded theme stylesheet
  var existing = document.getElementById('theme-css');
  if (existing) existing.remove();

  if (name === 'default') {
    document.documentElement.removeAttribute('data-theme');
  } else {
    document.documentElement.setAttribute('data-theme', name);

    // Load the theme CSS file
    if (theme.css) {
      var link = document.createElement('link');
      link.id = 'theme-css';
      link.rel = 'stylesheet';
      link.href = theme.css;
      document.head.appendChild(link);
    }

    // Starfield needs its canvas animation script (lazy, once).
    if (name === 'starfield') ensureStarfield();
  }

  localStorage.setItem(STORAGE_KEY, name);

  // Update picker UI if it exists
  updatePickerUI(name);

  // Dispatch event so other scripts can react
  window.dispatchEvent(new CustomEvent('themechange', { detail: { theme: name } }));
}

/**
 * Get the currently active theme name.
 */
function getTheme() {
  return localStorage.getItem(STORAGE_KEY) || 'default';
}

/**
 * Initialize — apply saved theme on page load.
 */
function initTheme() {
  var saved = getTheme();
  if (saved !== 'default') {
    setTheme(saved);
  }
}

/* ── Picker UI ── */

/**
 * Build the theme picker and insert it into the footer.
 * Call after DOM is ready.
 */
function buildThemePicker() {
  var footer = document.querySelector('.site-footer');
  if (!footer) return;

  var wrap = document.createElement('div');
  wrap.className = 'theme-picker-wrap';

  var trigger = document.createElement('button');
  trigger.className = 'theme-trigger';
  trigger.setAttribute('aria-label', 'Change theme');
  trigger.setAttribute('title', 'Change theme');
  var triggerImg = document.createElement('img');
  triggerImg.src = 'img/Icons/icons/Theme/colors.png';
  triggerImg.alt = 'Theme';
  triggerImg.style.cssText = 'width:24px;height:24px;object-fit:contain';
  trigger.appendChild(triggerImg);

  var picker = document.createElement('div');
  picker.className = 'theme-picker';
  picker.id = 'themePicker';

  var heading = document.createElement('div');
  heading.className = 'theme-picker-heading';
  heading.textContent = 'Choose Your Skin';

  picker.appendChild(heading);

  var current = getTheme();

  Object.keys(THEMES).forEach(function(key) {
    var t = THEMES[key];
    var btn = document.createElement('button');
    btn.className = 'theme-option';
    if (key === current) btn.classList.add('active');
    btn.setAttribute('data-theme-key', key);
    btn.textContent = t.label;
    btn.addEventListener('click', function() {
      setTheme(key);
    });
    picker.appendChild(btn);
  });

  wrap.appendChild(trigger);
  wrap.appendChild(picker);
  footer.appendChild(wrap);

  // Toggle picker on trigger click
  trigger.addEventListener('click', function(e) {
    e.stopPropagation();
    picker.classList.toggle('open');
  });

  // Close picker when clicking outside
  document.addEventListener('click', function(e) {
    if (!wrap.contains(e.target)) {
      picker.classList.remove('open');
    }
  });
}

/**
 * Update active state in picker buttons.
 */
function updatePickerUI(activeName) {
  var buttons = document.querySelectorAll('.theme-option');
  buttons.forEach(function(btn) {
    btn.classList.toggle('active', btn.getAttribute('data-theme-key') === activeName);
  });
}

/* ── Konami Code Easter Egg ── */

var konamiSequence = [
  'ArrowUp','ArrowUp','ArrowDown','ArrowDown',
  'ArrowLeft','ArrowRight','ArrowLeft','ArrowRight',
  'b','a'
];
var konamiIndex = 0;

document.addEventListener('keydown', function(e) {
  if (e.key === konamiSequence[konamiIndex]) {
    konamiIndex++;
    if (konamiIndex === konamiSequence.length) {
      konamiIndex = 0;
      var picker = document.getElementById('themePicker');
      if (picker) picker.classList.add('open');
    }
  } else {
    konamiIndex = 0;
  }
});

/* ── Auto-init ── */
initTheme();
document.addEventListener('DOMContentLoaded', buildThemePicker);
