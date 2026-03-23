/* Visit Ticker — odometer-style rolling digit counter
   Fetches total unique visitor count from GoatCounter and
   animates digits rolling into place. */

(function () {
  var GOATCOUNTER_SITE = 'dbatz92';
  var MIN_DIGITS = 6; // pad to at least this many digits
  var STAGGER_MS = 120; // delay between each digit starting to roll

  function buildDigits(container, count) {
    var str = String(count);
    while (str.length < MIN_DIGITS) str = '0' + str;

    // Insert thousand separators
    var digits = str.split('');
    var fragment = document.createDocumentFragment();

    for (var i = 0; i < digits.length; i++) {
      // Add separator every 3 digits from the right
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

      // Build digit strip: 0–9 then repeat target at end
      for (var d = 0; d <= 9; d++) {
        var s = document.createElement('span');
        s.textContent = d;
        inner.appendChild(s);
      }

      box.appendChild(inner);
      fragment.appendChild(box);

      // Animate after a stagger delay
      (function (innerEl, targetVal, delay) {
        setTimeout(function () {
          innerEl.style.transform = 'translateY(-' + (targetVal * 30) + 'px)';
        }, 200 + delay);
      })(inner, target, i * STAGGER_MS);
    }

    container.appendChild(fragment);
  }

  function initTicker() {
    var container = document.getElementById('visitTicker');
    if (!container) return;

    // Fetch pageview count for this page from GoatCounter API
    var path = window.location.pathname;
    if (path === '/') path = '/index.html';
    var url = 'https://' + GOATCOUNTER_SITE + '.goatcounter.com/counter' +
              path + '.json';

    var xhr = new XMLHttpRequest();
    xhr.open('GET', url);
    xhr.onload = function () {
      if (xhr.status === 200) {
        try {
          var data = JSON.parse(xhr.responseText);
          var count = parseInt(data.count.replace(/,/g, ''), 10) || 0;
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

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initTicker);
  } else {
    initTicker();
  }
})();
