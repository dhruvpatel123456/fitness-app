// Applies the light or dark theme before the page is drawn (no flash).
(function () {
  try {
    var choice = localStorage.getItem('tt-theme') || 'system';
    var dark = choice === 'dark' || (choice === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);
    document.documentElement.classList.toggle('dark', dark);
  } catch (e) {
    /* Storage can be unavailable in private windows; the default theme is used. */
  }
})();
