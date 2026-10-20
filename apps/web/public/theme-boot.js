// Applies a saved Light or Dark choice before the first paint, so the page
// never flashes the other theme, and colours the phone browser bar (the
// theme-color metas) with that theme's surface token. System (nothing saved)
// needs no script: the tokens CSS and the metas' media follow the OS. The two
// colours must match THEME_SURFACE in @crm/ui/theme (a test checks them). The key must match THEME_STORAGE_KEY in
// @crm/ui/theme (a test in apps/web checks it). Loaded by index.html as a
// plain, blocking script from this origin, so the CSP needs no inline script.
(function () {
  try {
    const choice = window.localStorage.getItem('crm.theme');
    if (choice === 'light' || choice === 'dark') {
      document.documentElement.setAttribute('data-theme', choice);
      const surface = choice === 'dark' ? '#18191c' : '#fdfdff';
      const metas = document.querySelectorAll('meta[name="theme-color"]');
      for (let i = 0; i < metas.length; i += 1) metas[i].setAttribute('content', surface);
    }
  } catch {
    // Storage is blocked: follow the OS.
  }
})();
