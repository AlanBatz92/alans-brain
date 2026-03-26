/* Visit Ticker — odometer-style rolling digit counter
   Fetches total pageview count from GoatCounter and
   animates digits rolling into place. */

(function () {
  var SITE = 'dbatz92';
  var MIN_DIGITS = 6;
  var STAGGER_MS = 120;

  function buildDigits(container, count) {
    container.innerHTML = '';
    var str = String(count);
    while (str.length < MIN_DIGITS) str = '0' + str;

    var digits = str.split('');
    var fragment = document.createDocumentFragment();

    for (var i = 0; i < digits.length; i++) {
      var fromRight = digits.length - i;
      if (fromRight % 3 === 0 && i !== 0) {
        var sep = document.createElement('div');
        sep.className = 'ticker-separator';
        sep.textContent = ',';
        fragment.appendChild(sep);
      }

      var target = parseInt(digits[i], 10);
      var box = document.createElement('div');
      box.className = 'ticker-digit';

      var inner = document.createElement('div');
      inner.className = 'ticker-digit-inner';

      for (var d = 0; d <= 9; d++) {
        var s = document.createElement('span');
        s.textContent = d;
        inner.appendChild(s);
      }

      box.appendChild(inner);
      fragment.appendChild(box);

      (function (innerEl, targetVal, delay) {
        setTimeout(function () {
          innerEl.style.transform = 'translateY(-' + (targetVal * 30) + 'px)';
        }, 200 + delay);
      })(inner, target, i * STAGGER_MS);
    }

    container.appendChild(fragment);
  }

  function fetchCount(container) {
    // Fetch TOTAL site-wide pageviews (not per-page)
    var url = 'https://' + SITE + '.goatcounter.com/counter/' +
              encodeURIComponent('TOTAL') + '.json';

    var xhr = new XMLHttpRequest();
    xhr.open('GET', url);
    xhr.onload = function () {
      if (xhr.status === 200) {
        try {
          var data = JSON.parse(xhr.responseText);
          var count = parseInt(String(data.count).replace(/[^0-9]/g, ''), 10) || 0;
          buildDigits(container, count);
        } catch (e) {
          buildDigits(container, 0);
        }
      } else {
        buildDigits(container, 0);
      }
    };
    xhr.onerror = function () {
      buildDigits(container, 0);
    };
    xhr.send();
  }

  function initTicker() {
    var container = document.getElementById('visitTicker');
    if (!container) return;

    // Show zeros immediately, then fetch real count
    buildDigits(container, 0);

    // Small delay so the initial zeros render first, then real count rolls in
    setTimeout(function () { fetchCount(container); }, 800);
  }

  /* ── Grape-Nuts scroll easter egg (mobile) ──
     On touch devices / narrow screens, scale the Grape-Nuts icon
     as the user scrolls to the very bottom of the page. */
  function initGrapeNuts() {
    var gn = document.querySelector('.footer-btn[title="🥣"] img');
    if (!gn) return;

    var THRESHOLD = 200; // px from bottom where scaling begins
    var MAX_SCALE = 4.4;
    // On devices with a hover pointer, CSS :hover handles the effect,
    // so skip the scroll-based scaling there.
    var hasHover = window.matchMedia('(hover: hover)').matches;

    function onScroll() {
      if (hasHover) return;

      var scrollBottom = window.innerHeight + window.scrollY;
      var docHeight = document.documentElement.scrollHeight;
      var remaining = docHeight - scrollBottom;

      if (remaining < THRESHOLD) {
        var progress = 1 - (remaining / THRESHOLD); // 0→1
        var scale = 1 + (MAX_SCALE - 1) * progress;
        gn.style.transform = 'scale(' + Math.min(scale, MAX_SCALE) + ')';
      } else {
        gn.style.transform = '';
      }
    }

    window.addEventListener('scroll', onScroll, { passive: true });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function() {
      initTicker();
      initGrapeNuts();
    });
  } else {
    initTicker();
    initGrapeNuts();
  }
})();
