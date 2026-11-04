// The Timefix embed script, version 1 (spec 0023, 0023-embeds.md). One small
// classic script per site, served at /embed/v1.js and cached; a change that
// breaks a site's markup gets /embed/v2.js instead. It finds, anywhere on the
// page and as often as the site likes:
//
//   <div data-timefix-form="KEY"></div>                      a form, inline
//   <div data-timefix-booking="KEY"></div>                   a booking page, inline
//   <div data-timefix-booking="HANDLE/SLUG"></div>           the same, by its handle address (22 Oct 2026)
//   <button data-timefix-form="KEY" data-timefix-mode="popup">  opens it in a dialog
//   <div data-timefix-form="KEY" data-timefix-mode="floating"
//        data-timefix-text="Talk to us" data-timefix-color="#2563eb"></div>  a corner button
//   <form data-timefix-form="KEY" data-timefix-workspace="ws_…">  the site's own form, posted by us
//
// `data-timefix-panel="side"` on a popup or floating holder opens a column
// against the inline end instead of the middle of the screen, and a sheet from
// the bottom on a phone (2 Nov 2026). A panel opened from a button grows out of
// that button.
//
// Inline frames fill their container's width and take their content's height,
// which the frame posts as it changes, so they never scroll inside or spill
// sideways. Everything we draw lives in a shadow root with its own styles, so
// the site's CSS can't reach in and ours can't leak out. Messages are taken
// only from our own origin, from a frame we made, and in our shape.
//
// Tagging (like HubSpot's): each submit carries where it came from (the page,
// its title, the visit's first landing, its referrer and UTM tags, kept in
// this tab's session storage) and, only once the site allows it, a first
// party visitor id cookie, tfx_vid. Without consent no cookie is set.
// Consent: data-timefix-consent="granted" on this script tag, or
// window.Timefix.consent(true) from the site's consent banner (false removes it).
(function () {
  'use strict';
  var me = document.currentScript;
  if (!me || !me.src) return;
  var given = me.getAttribute('data-timefix-consent');
  var running = window.Timefix;
  if (running && running.v === 1) {
    // A second copy of the tag: the first one does the work.
    if (given) running.consent(given === 'granted');
    running.scan();
    return;
  }

  var ORIGIN = new URL(me.src).origin;
  var UTM = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content'];
  var LANDING = 'tfx_landing';
  var COOKIE = 'tfx_vid';
  var MAX_HEIGHT = 20000;
  var frames = [];
  var seen = new WeakSet();
  var granted = given === 'granted';
  var count = 0;

  function cut(text, max) {
    return String(text).slice(0, max);
  }

  // A page's address as a submission keeps it: no query but its UTM tags, no fragment.
  // A site's own query values (a reset link's token, a session) never leave the page.
  function bare(href) {
    var url = new URL(href);
    var kept = new URLSearchParams();
    url.searchParams.forEach(function (value, name) {
      if (UTM.indexOf(name) !== -1) kept.append(name, value);
    });
    var query = kept.toString();
    return cut(url.origin + url.pathname + (query ? '?' + query : ''), 2048);
  }

  // Query names a question may prefill from: plain keys, never ones that look like a credential.
  var SECRETISH = /token|code|session|secret|key|auth|pass|sig|nonce|state|csrf|jwt|otp|ticket/i;
  function passable(name) {
    return (
      /^[a-z][a-z0-9_]{0,39}$/i.test(name) && !SECRETISH.test(name) && name !== 'embed' && name !== 'p' && name !== 't'
    );
  }

  // The visit's first landing in this tab: its address, referrer and UTM tags.
  function landing() {
    var stored;
    try {
      stored = JSON.parse(sessionStorage.getItem(LANDING) || 'null');
    } catch {
      stored = null;
    }
    if (stored && typeof stored === 'object') return stored;
    var query = new URLSearchParams(location.search);
    var info = { landing_url: bare(location.href) };
    if (document.referrer) info.referrer = cut(document.referrer, 2048);
    UTM.forEach(function (key) {
      var value = query.get(key);
      if (value) info[key] = cut(value, 200);
    });
    try {
      sessionStorage.setItem(LANDING, JSON.stringify(info));
    } catch {
      // Storage refused: this page's own landing still goes.
    }
    return info;
  }

  function readCookie() {
    var match = /(?:^|;\s*)tfx_vid=([A-Za-z0-9_-]{16,64})(?:;|$)/.exec(document.cookie);
    return match ? match[1] : undefined;
  }

  function newId() {
    var bytes = crypto.getRandomValues(new Uint8Array(18));
    return btoa(String.fromCharCode.apply(null, bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }

  // The visitor id, minted once consent is given; undefined without it.
  function visitor() {
    if (!granted) return undefined;
    var id = readCookie();
    if (!id) {
      id = newId();
      document.cookie =
        COOKIE +
        '=' +
        id +
        '; Max-Age=15552000; Path=/; SameSite=Lax' +
        (location.protocol === 'https:' ? '; Secure' : '');
    }
    return id;
  }

  function consent(allowed) {
    granted = allowed === true;
    if (!granted && readCookie()) document.cookie = COOKIE + '=; Max-Age=0; Path=/; SameSite=Lax';
    else visitor();
  }

  // Where a submission comes from, as the server's SubmitContext takes it.
  function context(element, mode) {
    var first = landing();
    var query = new URLSearchParams(location.search);
    var out = { page_url: bare(location.href), mode: mode, version: '1' };
    if (document.title) out.page_title = cut(document.title, 300);
    ['landing_url', 'referrer'].concat(UTM).forEach(function (key) {
      if (first[key]) out[key] = first[key];
    });
    UTM.forEach(function (key) {
      var value = query.get(key);
      if (value) out[key] = cut(value, 200);
    });
    var pass = (element.getAttribute('data-timefix-pass') || '').split(/[\s,]+/);
    var params = {};
    var any = false;
    for (var i = 0; i < pass.length && i < 10; i += 1) {
      var name = pass[i];
      var value = name && /^[a-z][a-z0-9_]{0,39}$/.test(name) ? query.get(name) : null;
      if (value) {
        params[name] = cut(value, 200);
        any = true;
      }
    }
    if (any) out.params = params;
    var workspace = element.getAttribute('data-timefix-workspace');
    if (workspace) out.workspace = workspace;
    var id = visitor();
    if (id) out.visitor_id = id;
    return out;
  }

  // The corner button's marks, drawn from Lucide's calendar-days, message-circle and mail, at 18px to sit on the
  // words' line. They are inert pictures: the button's words are its name.
  var MARKS = {
    calendar:
      '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M8 2v4M16 2v4M3 10h18"/><rect width="18" height="18" x="3" y="4" rx="2"/><path d="M8 14h.01M12 14h.01M16 14h.01M8 18h.01M12 18h.01M16 18h.01"/></svg>',
    chat: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M7.9 20A9 9 0 1 0 4 16.1L2 22Z"/></svg>',
    mail: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="20" height="16" x="2" y="4" rx="2"/><path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7"/></svg>',
  };

  var STYLE =
    ':host{all:initial;display:block;inline-size:100%;max-inline-size:100%;min-inline-size:0}' +
    '.box{position:relative;inline-size:100%;min-block-size:var(--tfx-min,360px)}' +
    '.box[data-ready]{min-block-size:0}' +
    'iframe{display:block;box-sizing:border-box;inline-size:100%;max-inline-size:100%;min-inline-size:0;block-size:var(--tfx-min,360px);' +
    'border:0;margin:0;padding:0;background:transparent;opacity:0;transition:opacity 160ms ease-out}' +
    '[data-ready] iframe{opacity:1}' +
    '.sk{position:absolute;inset:0;pointer-events:none;display:flex;flex-direction:column;gap:12px;padding:24px;box-sizing:border-box}' +
    '.sk i{display:block;block-size:12px;border-radius:6px;background:var(--tfx-sk);animation:tfx-pulse 1.2s ease-in-out infinite alternate}' +
    '.sk i:nth-child(1){inline-size:60%;block-size:20px}.sk i:nth-child(2n){block-size:32px}.sk i:last-child{inline-size:100%;block-size:36px}' +
    '[data-ready] .sk{display:none}' +
    // A booking page's stand in is booking shaped (critic A20): the host's face and two lines, then a month of tiles,
    // where a form's is a few fields. Its tiles stop growing at a laptop month's size in a wide frame.
    '.sb{display:grid;grid-template-columns:repeat(7,1fr);gap:6px;align-content:start}.sb i{grid-column:1/-1}' +
    '.sk u{display:block;aspect-ratio:1;max-height:64px;border-radius:8px;background:var(--tfx-sk);animation:tfx-pulse 1.2s infinite alternate}' +
    '@keyframes tfx-pulse{from{opacity:.55}to{opacity:1}}' +
    // `block-size:100dvh` beside `inset:0`: on a phone the viewport shrinks as the address bar slides away, and a
    // panel measured in `vh` keeps the taller figure, so its foot (the submit button, the Book button) sits below
    // the fold with nothing to scroll. `dvh` follows the bar. The `inset` stays for browsers without `dvh`.
    '.veil{position:fixed;inset:0;block-size:100dvh;z-index:2147483000;display:flex;align-items:center;justify-content:center;' +
    'background:rgba(15,18,25,.55);opacity:0;transition:opacity 240ms ease-out;overscroll-behavior:contain}' +
    '.veil:not([data-open]){transition-duration:120ms}' +
    '.veil[hidden]{display:none}.veil[data-open]{opacity:1}' +
    '.panel{position:relative;box-sizing:border-box;display:flex;flex-direction:column;inline-size:min(560px,calc(100% - 32px));max-block-size:calc(100% - 64px);' +
    'overflow:hidden;border-radius:12px;background:var(--tfx-bg);box-shadow:0 24px 64px rgba(0,0,0,.28);' +
    'transform-origin:var(--tfx-ox,50%) var(--tfx-oy,50%);' +
    'transform:scale(.98);transition:transform 240ms ease-out}' +
    '.veil[data-open] .panel{transform:none}' +
    // A booking page in the middle panel gets a laptop's width (critic B-11), so it lays out its month and times side
    // by side rather than a phone's column in a box. Phones take the whole screen below.
    '@media (min-width:641px){.bk:not([data-side]) .panel{inline-size:min(1000px,calc(100% - 32px))}}' +
    // A panel opened from a button grows out of that button: the origin is the button's middle, so the corner
    // the eye was on is the corner that expands. Opened from anywhere else the origin stays the middle.
    '.veil[data-grow] .panel{transform:scale(.88)}' +
    // Side: a column against the inline end, full height, its outer corners square against the edge. It keeps the
    // same veil, focus trap and close button as the middle panel; only where it sits and how it arrives differ.
    '.veil[data-side]{align-items:stretch;justify-content:flex-end}' +
    '.veil[data-side] .panel{inline-size:min(440px,100%);max-block-size:none;block-size:100%;' +
    'border-start-end-radius:0;border-end-end-radius:0;border-start-start-radius:16px;border-end-start-radius:16px;' +
    'transform:translateX(16px) scale(.99)}' +
    '.veil[data-side][data-open] .panel{transform:none}' +
    '.veil[data-side] .panel iframe{flex:1;min-block-size:0;block-size:auto;max-block-size:none}' +
    // Until the page inside posts its height, a dialog opened at a flat 480px was shorter than almost every form
    // and booking page, so the first thing a visitor saw was a scrollbar, and then a jump when the real height
    // arrived. 70dvh opens near the room it has, and the transition eases to the measured height rather than
    // snapping. The reduced motion block below turns that transition off with the rest.
    '.panel iframe{opacity:1;max-block-size:calc(100dvh - 112px);block-size:var(--tfx-h,70dvh);' +
    'transition:block-size 200ms ease-out}' +
    // A bar above the page holds its name and Close. Close used to float over the page's own top corner, where a
    // form's long heading ran under it, and a booking page and a form each framed it differently; the bar gives
    // both the same head and keeps Close off whatever the page puts there (3 November 2026).
    // The bar holds Close alone, on the page's own ground with no line under it, so the dialog reads as the form
    // with a way out rather than a window around it (5 November 2026).
    '.hd{flex:none;display:flex;align-items:center;justify-content:flex-end;block-size:40px;box-sizing:border-box;' +
    'padding:8px 8px 0;background:var(--tfx-bg);color:var(--tfx-fg)}' +
    '.hd span{flex:1;min-inline-size:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}' +
    '.panel .sk{inset-block-start:40px}' +
    '.x{flex:none;display:grid;place-items:center;inline-size:32px;block-size:32px;' +
    'padding:0;border:0;border-radius:8px;background:transparent;color:var(--tfx-fg);cursor:pointer;transition:background 120ms ease-out}' +
    '.x:hover{background:var(--tfx-sk)}' +
    '.x:focus-visible,.fab:focus-visible,.off a:focus-visible{outline:2px solid #fff;outline-offset:2px;box-shadow:0 0 0 4px #111318}' +
    '.off{position:absolute;inset:0;display:grid;place-items:center;padding:24px;box-sizing:border-box;' +
    'font:15px/1.4 system-ui,-apple-system,"Segoe UI",sans-serif;color:var(--tfx-fg)}.off a{color:inherit}' +
    // Two corner buttons on one site (a form and a booking page, say) would otherwise sit on exactly the same
    // 16px, one hiding the other. Each one we draw lifts the next by its own height plus a gap.
    '.fab{position:fixed;inset-block-end:calc(16px + var(--tfx-lift,0px));inset-inline-end:16px;z-index:2147482999;box-sizing:border-box;min-block-size:44px;' +
    'max-inline-size:calc(100vw - 32px);padding:0 20px;border:0;border-radius:22px;background:var(--tfx-accent);color:var(--tfx-on);' +
    'font:600 15px/1.2 system-ui,-apple-system,"Segoe UI",sans-serif;box-shadow:0 8px 24px rgba(0,0,0,.2);cursor:pointer;' +
    'white-space:nowrap;overflow:hidden;text-overflow:ellipsis}' +
    '.fab:has(.mark){display:inline-flex;align-items:center;gap:8px}' +
    '.mark{display:grid;place-items:center;flex:none}' +
    '@media (max-width:640px){.panel{inline-size:100%;block-size:100dvh;max-block-size:none;border-radius:0}' +
    '.panel iframe{flex:1;min-block-size:0;block-size:auto;max-block-size:none}' +
    // A 390px wide "side" panel is the whole screen pretending to be a panel, so on a phone it is a sheet that
    // rises from the bottom instead, which is where a thumb is and which no longer claims to be beside anything.
    '.veil[data-side]{align-items:flex-end;justify-content:center}' +
    '.veil[data-side] .panel{inline-size:100%;block-size:92dvh;border-radius:16px 16px 0 0;transform:translateY(16px)}' +
    '.veil[data-side][data-open] .panel{transform:none}' +
    '.veil[data-grow] .panel{transform:translateY(16px)}}' +
    // Open always lands at rest. The grow rules above have the same weight as `[data-open]` and come later, so
    // they won: the middle panel stayed at 88% of its size and a phone's sat 16px low with its foot off screen.
    '.veil[data-open][data-grow] .panel{transform:none}' +
    '@media (prefers-reduced-motion:reduce){.veil,.panel,iframe{transition:opacity 160ms ease-out}' +
    '.veil .panel,.veil[data-side] .panel,.veil[data-grow] .panel{transform:none}.sk i,.sk u{animation:none}}';

  var LIGHT = ':host{--tfx-bg:#ffffff;--tfx-fg:#1f2329;--tfx-sk:#eceef2;--tfx-line:#e6e8ec}';
  var DARK = ':host{--tfx-bg:#16181d;--tfx-fg:#e7e9ee;--tfx-sk:#2a2e36;--tfx-line:#2a2e36}';

  // A themed shadow root inside a fresh element the site's CSS can't size or pad. `theme` is the holder's
  // `data-timefix-theme`: `dark` or `light` fixes it; anything else follows the visitor's system, as the page in the
  // frame does. A dialog themed light around a page drawn dark showed a white bar and white corners round it
  // (3 November 2026).
  function shell(theme) {
    var host = document.createElement('div');
    host.setAttribute('data-timefix-embed', '');
    host.style.cssText =
      'all:initial!important;display:block!important;width:100%!important;max-width:100%!important;min-width:0!important';
    var root = host.attachShadow({ mode: 'open' });
    var style = document.createElement('style');
    style.textContent =
      STYLE +
      (theme === 'dark'
        ? DARK
        : theme === 'light'
          ? LIGHT
          : LIGHT + '@media (prefers-color-scheme:dark){' + DARK + '}');
    root.appendChild(style);
    return { host: host, root: root };
  }

  // Where a key's page is: a form at /f/KEY; a booking page at /b/KEY, or at /HANDLE/SLUG when given that way.
  var HANDLE_ADDRESS = /^[a-z0-9]+(?:-[a-z0-9]+)*\/[a-z0-9]+(?:-[a-z0-9]+)*$/;
  /** A page's own key: what `/f/KEY` and `/b/KEY` take. */
  var PLAIN_KEY = /^[A-Za-z0-9_-]{1,64}$/;
  function pageUrl(kind, key) {
    if (kind === 'booking' && HANDLE_ADDRESS.test(key)) return new URL('/' + key, ORIGIN);
    return new URL((kind === 'booking' ? '/b/' : '/f/') + encodeURIComponent(key), ORIGIN);
  }

  function frameFor(kind, key, mode, element) {
    var id = String((count += 1));
    var src = pageUrl(kind, key);
    var query = new URLSearchParams(location.search);
    query.forEach(function (value, name) {
      // The site's own address passes plain parameters along, so a question's key prefills it.
      if (passable(name)) src.searchParams.set(name, cut(value, 500));
    });
    src.searchParams.set('embed', '1');
    src.searchParams.set('mode', mode);
    // An inline form's look, as the Share tab wrote it: a clear ground (the site's background shows through) and
    // the headline left to the site.
    if (mode === 'inline' && element.getAttribute('data-timefix-ground') === 'none')
      src.searchParams.set('ground', 'none');
    if (mode === 'inline' && element.getAttribute('data-timefix-head') === 'none') src.searchParams.set('head', 'none');
    src.searchParams.set('fid', id);
    src.searchParams.set('host', location.origin);
    if (kind === 'form') src.searchParams.set('ctx', JSON.stringify(context(element, mode)));
    var frame = document.createElement('iframe');
    frame.src = src.href;
    frame.title = element.getAttribute('data-timefix-title') || (kind === 'booking' ? 'Book a time' : 'Form');
    frame.setAttribute('allow', 'clipboard-write');
    return { id: id, frame: frame };
  }

  function track(entry) {
    frames.push(entry);
    return entry;
  }

  function inline(holder, kind, key) {
    var parts = shell(holder.getAttribute('data-timefix-theme'));
    var box = document.createElement('div');
    box.className = 'box';
    var made = frameFor(kind, key, 'inline', holder);
    made.frame.loading = 'lazy';
    made.frame.setAttribute('scrolling', 'no');
    var skeleton = standIn(kind);
    box.appendChild(made.frame);
    box.appendChild(skeleton);
    parts.root.appendChild(box);
    holder.appendChild(parts.host);
    stall(box, skeleton, kind, key, made.frame);
    track({
      frame: made.frame,
      height: function (height) {
        made.frame.style.blockSize = height + 'px';
        box.setAttribute('data-ready', '');
      },
    });
  }

  // What stands in while a frame loads: a form's few fields, or a booking page's face, lines and month.
  function standIn(kind) {
    var skeleton = document.createElement('div');
    skeleton.className = 'sk';
    skeleton.setAttribute('aria-hidden', 'true');
    skeleton.innerHTML =
      kind === 'booking' ? '<i></i><i></i>' + new Array(36).join('<u></u>') : '<i></i><i></i><i></i><i></i><i></i>';
    if (kind === 'booking') skeleton.className = 'sk sb';
    return skeleton;
  }

  // A frame that never says its height (offline, blocked) gives way to a plain link to its own page.
  function stall(box, skeleton, kind, key, frame) {
    var waited = function () {
      if (box.hasAttribute('data-ready')) return;
      skeleton.className = 'off';
      skeleton.removeAttribute('aria-hidden');
      skeleton.textContent = '';
      var link = document.createElement('a');
      link.href = pageUrl(kind, key).href;
      link.target = '_blank';
      link.rel = 'noopener';
      link.textContent = 'Open ' + frame.title + ' in a new tab';
      skeleton.appendChild(link);
    };
    // Lazy frames start their clock when they come near the screen.
    if (typeof IntersectionObserver === 'function') {
      var near = new IntersectionObserver(function (entries) {
        if (
          !entries.some(function (entry) {
            return entry.isIntersecting;
          })
        )
          return;
        near.disconnect();
        setTimeout(waited, 15000);
      });
      near.observe(box);
    } else setTimeout(waited, 15000);
  }

  var dialogs = {};

  function dialogFor(kind, key, element, side) {
    var name = kind + ':' + key + (side ? ':side' : '');
    if (dialogs[name]) return dialogs[name];
    var parts = shell(element.getAttribute('data-timefix-theme'));
    var veil = document.createElement('div');
    veil.className = kind === 'booking' ? 'veil bk' : 'veil';
    if (side) veil.setAttribute('data-side', '');
    veil.hidden = true;
    var panel = document.createElement('div');
    panel.className = 'panel';
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-modal', 'true');
    var made = frameFor(kind, key, 'popup', element);
    panel.setAttribute('aria-label', made.frame.title);
    var close = document.createElement('button');
    close.type = 'button';
    close.className = 'x';
    close.setAttribute('aria-label', 'Close');
    close.innerHTML =
      '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12"/></svg>';
    var head = document.createElement('div');
    head.className = 'hd';
    // The words on the button that opened it name the panel for screen readers, so what you pressed is what it is
    // called; nothing in the bar shows them.
    panel.setAttribute(
      'aria-label',
      cut(
        element.getAttribute('data-timefix-title') ||
          element.getAttribute('data-timefix-text') ||
          element.textContent.trim() ||
          made.frame.title,
        60,
      ),
    );
    // Only Close in the bar (5 November 2026): the form's own headline is right under it, so naming it again in the
    // bar said it twice. The panel keeps the name for screen readers.
    head.appendChild(close);
    var start = document.createElement('span');
    var end = document.createElement('span');
    start.tabIndex = 0;
    end.tabIndex = 0;
    panel.appendChild(start);
    panel.appendChild(head);
    panel.appendChild(made.frame);
    var skeleton = standIn(kind);
    panel.appendChild(skeleton);
    panel.appendChild(end);
    stall(panel, skeleton, kind, key, made.frame);
    veil.appendChild(panel);
    parts.root.appendChild(veil);
    document.body.appendChild(parts.host);
    var back = null;
    var opener = null;
    var overflow = '';
    var padding = '';
    var shut = function () {
      if (veil.hidden) return;
      veil.removeAttribute('data-open');
      var root = document.documentElement;
      root.style.overflow = overflow;
      root.style.paddingRight = padding;
      setTimeout(
        function () {
          veil.hidden = true;
        },
        matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 120,
      );
      if (opener) opener.style.visibility = '';
      if (back && back.focus) back.focus();
    };
    var dialog = {
      /**
       * `from` is the button that asked for it, when there was one: the panel then grows out of that button
       * rather than out of the middle of the screen, so what you pressed becomes what you are looking at. A
       * panel opened from anywhere else (a link, a script) has nothing to grow from, and a grow from nowhere
       * reads as a glitch, so it keeps the plain rise.
       */
      open: function (from) {
        if (!veil.hidden) return;
        back = document.activeElement;
        var root = document.documentElement;
        overflow = root.style.overflow;
        padding = root.style.paddingRight;
        var gap = window.innerWidth - root.clientWidth;
        root.style.overflow = 'hidden';
        if (gap > 0) root.style.paddingRight = gap + 'px';
        veil.hidden = false;
        panel.style.removeProperty('--tfx-ox');
        panel.style.removeProperty('--tfx-oy');
        veil.removeAttribute('data-grow');
        if (from && from.getBoundingClientRect) {
          var button = from.getBoundingClientRect();
          var box = panel.getBoundingClientRect();
          if (box.width > 0 && box.height > 0) {
            panel.style.setProperty('--tfx-ox', button.left + button.width / 2 - box.left + 'px');
            panel.style.setProperty('--tfx-oy', button.top + button.height / 2 - box.top + 'px');
            veil.setAttribute('data-grow', '');
          }
        }
        // A corner launcher steps out of sight while its panel is up, and back on close (critic A20): it showed
        // through the veil, under the dialog.
        opener = from && from.className === 'fab' ? from : null;
        if (opener) opener.style.visibility = 'hidden';
        requestAnimationFrame(function () {
          veil.setAttribute('data-open', '');
        });
        close.focus();
      },
      close: shut,
    };
    close.addEventListener('click', shut);
    veil.addEventListener('click', function (event) {
      if (event.target === veil) shut();
    });
    veil.addEventListener('keydown', function (event) {
      if (event.key === 'Escape') {
        event.stopPropagation();
        shut();
      }
    });
    // Focus stays inside: off the end it comes back to Close, off the start it goes into the form.
    start.addEventListener('focus', function () {
      made.frame.focus();
    });
    end.addEventListener('focus', function () {
      close.focus();
    });
    track({
      frame: made.frame,
      height: function (height) {
        made.frame.style.setProperty('--tfx-h', height + 'px');
        panel.style.setProperty('--tfx-h', height + 'px');
        panel.setAttribute('data-ready', '');
      },
      close: shut,
    });
    dialogs[name] = dialog;
    return dialog;
  }

  // White or near black on the button, whichever reads on its colour.
  function onColour(hex) {
    var full = hex.length === 4 ? hex.replace(/[0-9a-f]/gi, '$&$&') : hex.slice(0, 7);
    var rgb = [1, 3, 5].map(function (at) {
      var value = parseInt(full.slice(at, at + 2), 16) / 255;
      return value <= 0.03928 ? value / 12.92 : Math.pow((value + 0.055) / 1.055, 2.4);
    });
    var light = 0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2];
    return light > 0.179 ? '#111318' : '#ffffff';
  }

  // How many corner buttons we have drawn, so the next one sits above the last rather than on top of it.
  var fabs = 0;
  function floating(holder, kind, key, side) {
    var parts = shell(holder.getAttribute('data-timefix-theme'));
    var colour = holder.getAttribute('data-timefix-color') || '';
    if (!/^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(colour)) colour = '#2563eb';
    var button = document.createElement('button');
    button.type = 'button';
    button.className = 'fab';
    button.setAttribute('aria-haspopup', 'dialog');
    button.textContent = cut(holder.getAttribute('data-timefix-text') || 'Contact us', 40);
    // The mark goes before the words and is hidden from screen readers: the words already name the button, and
    // a mark that named it too would be read twice. Only the marks we draw are allowed; anything else is words only.
    var mark = MARKS[holder.getAttribute('data-timefix-icon')];
    if (mark) {
      var glyph = document.createElement('span');
      glyph.className = 'mark';
      glyph.setAttribute('aria-hidden', 'true');
      glyph.innerHTML = mark;
      button.insertBefore(glyph, button.firstChild);
    }
    button.style.setProperty('--tfx-lift', fabs * 56 + 'px');
    fabs += 1;
    button.style.setProperty('--tfx-accent', colour);
    button.style.setProperty('--tfx-on', onColour(colour));
    button.addEventListener('click', function () {
      dialogFor(kind, key, holder, side).open(button);
    });
    parts.root.appendChild(button);
    document.body.appendChild(parts.host);
  }

  function popup(trigger, kind, key, side) {
    trigger.setAttribute('aria-haspopup', 'dialog');
    trigger.addEventListener('click', function (event) {
      event.preventDefault();
      dialogFor(kind, key, trigger, side).open(trigger);
    });
  }

  function uuid() {
    if (crypto.randomUUID) return crypto.randomUUID();
    var bytes = crypto.getRandomValues(new Uint8Array(16));
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    var hex = Array.prototype.map
      .call(bytes, function (b) {
        return (b + 0x100).toString(16).slice(1);
      })
      .join('');
    return hex.replace(/^(.{8})(.{4})(.{4})(.{4})/, '$1-$2-$3-$4-');
  }

  // The site's own form: each input's name is its question's key.
  function own(form, key, legacy) {
    var started = Date.now();
    var attempt = uuid();
    // The polite status line and the alert line are always there and filled when needed, so they are read out.
    var success = form.querySelector('[data-timefix-success]');
    var thanks = form.querySelector('[data-crm-thanks]');
    var failure = form.querySelector('[data-timefix-error]');
    form.addEventListener('submit', function (event) {
      event.preventDefault();
      var answers = {};
      var fields = form.querySelectorAll(legacy ? '[data-crm-field]' : 'input[name],select[name],textarea[name]');
      var trap = '';
      for (var i = 0; i < fields.length; i += 1) {
        var field = fields[i];
        var name = legacy ? field.getAttribute('data-crm-field') : field.name;
        // The honeypot: `tf-trap` since 25 Oct 2026 (autofill filled `company_url`), the old name for snippets already pasted.
        if (name === 'tf-trap' || name === 'company_url') {
          trap = field.value;
          continue;
        }
        if (!/^[a-z][a-z0-9_]{0,39}$/.test(name) || field.disabled) continue;
        field.removeAttribute('aria-invalid');
        if (field.type === 'checkbox') answers[name] = field.checked;
        else if (field.type === 'radio') {
          // A group with nothing picked still says it was asked, so a required choice left empty is refused.
          if (field.checked) answers[name] = field.value;
          else if (!Object.prototype.hasOwnProperty.call(answers, name)) answers[name] = '';
        } else answers[name] = field.value;
      }
      var mode = 'own';
      var ctx = context(form, mode);
      var hidden = { page: ctx.page_url };
      if (ctx.referrer) hidden.referrer = ctx.referrer;
      UTM.forEach(function (name) {
        if (ctx[name]) hidden[name] = ctx[name];
      });
      var body = {
        idempotencyKey: attempt,
        answers: answers,
        hidden: hidden,
        fillMs: Date.now() - started,
        context: ctx,
      };
      if (trap) body.company_url = cut(trap, 1000);
      var version = Number(form.getAttribute('data-timefix-version'));
      if (version >= 1 && version % 1 === 0) body.versionNumber = version;
      var send = form.querySelector('[type="submit"]');
      if (send) send.disabled = true;
      form.setAttribute('aria-busy', 'true');
      if (success) success.textContent = '';
      if (failure) failure.textContent = '';
      var done = function (ok, status, message) {
        if (send) send.disabled = false;
        form.removeAttribute('aria-busy');
        form.dispatchEvent(new CustomEvent(ok ? 'timefix:sent' : 'timefix:refused', { detail: { status: status } }));
        if (legacy)
          form.dispatchEvent(new CustomEvent(ok ? 'crm:sent' : 'crm:refused', { detail: { status: status } }));
        if (ok) {
          attempt = uuid();
          started = Date.now();
          form.reset();
          if (success) success.textContent = success.getAttribute('data-timefix-success') || 'Thank you.';
          if (thanks) thanks.hidden = false;
        } else if (failure) failure.textContent = message;
      };
      fetch(ORIGIN + '/api/public/forms/' + encodeURIComponent(key) + '/submissions', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      }).then(
        function (response) {
          if (response.ok) return done(true, response.status, '');
          return response.json().then(
            function (refused) {
              var lines = [refused && refused.message ? String(refused.message) : 'That did not send. Try again.'];
              var found = (refused && refused.fields) || {};
              Object.keys(found).forEach(function (name) {
                var input = form.querySelector('[name="' + name.replace(/[^a-z0-9_]/g, '') + '"]');
                if (input) input.setAttribute('aria-invalid', 'true');
                lines.push(String(found[name]));
              });
              done(false, response.status, lines.join(' '));
            },
            function () {
              done(false, response.status, 'That did not send. Try again.');
            },
          );
        },
        function () {
          done(false, 0, 'That did not send. Check your connection and try again.');
        },
      );
    });
  }

  function take(element) {
    if (seen.has(element)) return;
    var kind = element.hasAttribute('data-timefix-booking') ? 'booking' : 'form';
    var key = element.getAttribute('data-timefix-' + kind) || element.getAttribute('data-crm-form');
    var legacyPost = element.getAttribute('data-crm-form-post');
    if (element.tagName === 'FORM' && (legacyPost || (key && kind === 'form'))) {
      seen.add(element);
      own(element, legacyPost || key, Boolean(legacyPost));
      return;
    }
    // A booking page's key is either its own `publicKey` or the `handle/slug` address the editor hands out, which
    // carries a slash. Checking only the plain shape skipped every handled page's snippet in silence, so a site
    // owner saw nothing at all and nothing to search for (reported 2 November 2026). `pageUrl` has always known
    // both shapes; only this guard did not.
    if (!key || !(PLAIN_KEY.test(key) || (kind === 'booking' && HANDLE_ADDRESS.test(key)))) {
      if (key && window.console) window.console.warn('Timefix: unknown page address ' + key);
      return;
    }
    seen.add(element);
    var mode = element.getAttribute('data-timefix-mode') || 'inline';
    // Two separate choices, so they compose: `mode` is what the visitor presses (their own button, or the
    // corner bubble we draw), and `data-timefix-panel` is what opens (the middle of the screen, or a column
    // against the edge). Anything but `side` is the middle, so an older snippet keeps its behaviour.
    var side = element.getAttribute('data-timefix-panel') === 'side';
    if (mode === 'popup') popup(element, kind, key, side);
    else if (mode === 'floating') floating(element, kind, key, side);
    else inline(element, kind, key);
  }

  function scan() {
    var found = document.querySelectorAll(
      '[data-timefix-form],[data-timefix-booking],[data-crm-form],form[data-crm-form-post]',
    );
    for (var i = 0; i < found.length; i += 1) take(found[i]);
  }

  window.addEventListener('message', function (event) {
    var data = event.data;
    if (!data || typeof data !== 'object' || data.timefix !== 1 || typeof data.type !== 'string') return;
    for (var i = 0; i < frames.length; i += 1) {
      var entry = frames[i];
      if (entry.frame.contentWindow !== event.source) continue;
      // Not `event.origin !== ORIGIN`. A booking page given as `handle/slug` is built on the app host, which
      // answers 308 to the apex, so the page that loads is on a different origin than this script — and every
      // message it sent was dropped: the skeleton never cleared and the dialog never closed itself after a
      // booking (reported 3 November 2026). The frame is one we made and pointed at our own address, and only
      // its own window can be `event.source`, so that identity is the guard. The origin is pinned to whatever
      // the frame first speaks from and any later change is refused, so a frame navigated somewhere else
      // cannot start talking to us halfway through.
      if (entry.from === undefined) entry.from = event.origin;
      else if (entry.from !== event.origin) return;
      // A hidden frame (a closed dialog) measures nothing: its last height stands.
      if (data.type === 'height' && typeof data.height === 'number' && isFinite(data.height) && data.height > 0) {
        entry.height(Math.max(0, Math.min(Math.ceil(data.height), MAX_HEIGHT)));
      } else if (data.type === 'close' && entry.close) entry.close();
      // `booked` (critic B-01) is the site's own to hear: the frame posts it to this page's origin, naming no guest.
      return;
    }
  });

  window.Timefix = { v: 1, scan: scan, consent: consent };
  if (granted) visitor();
  landing();
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', scan);
  else scan();
})();
