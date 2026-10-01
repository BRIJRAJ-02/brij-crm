// Applies a saved Light or Dark choice before the first paint, so the page
// never flashes the other theme. System (nothing saved) needs no script: the
// tokens CSS follows the OS. The key must match THEME_STORAGE_KEY in
// @crm/ui/theme (a test in apps/web checks it). Loaded by index.html as a
// plain, blocking script from this origin, so the CSP needs no inline script.
(function () {
  try {
    const choice = window.localStorage.getItem('crm.theme');
    if (choice === 'light' || choice === 'dark') {
      document.documentElement.setAttribute('data-theme', choice);
    }
  } catch {
    // Storage is blocked: follow the OS.
  }
})();
