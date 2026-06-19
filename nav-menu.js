/* Shared mobile-nav helpers — augments the per-page hamburger toggle with
   tap-the-backdrop-to-close and Escape-to-close. Loaded site-wide so the
   behaviour is identical on every page; it only ADDS listeners (it never
   re-binds the hamburger), so it can't double-toggle the existing handler. */
(function () {
  var hamburger = document.querySelector('.nav-hamburger');
  var overlay = document.querySelector('.nav-mobile-overlay');
  if (!hamburger || !overlay) return;

  function closeMenu() {
    if (!overlay.classList.contains('open')) return;
    hamburger.classList.remove('open');
    overlay.classList.remove('open');
    hamburger.setAttribute('aria-expanded', 'false');
    document.body.style.overflow = '';
  }

  /* Tap the backdrop (any empty space outside a link) to close. A click that
     lands on the overlay itself — not a child link — means the user tapped off
     the menu. */
  overlay.addEventListener('click', function (e) {
    if (e.target === overlay) closeMenu();
  });

  /* Escape closes the menu (keyboard / hardware-keyboard users). */
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' || e.key === 'Esc') closeMenu();
  });
})();
