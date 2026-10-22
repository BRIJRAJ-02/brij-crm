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

  var STYLE =
    ':host{all:initial;display:block;inline-size:100%;max-inline-size:100%;min-inline-size:0}' +
    '.box{position:relative;inline-size:100%;min-block-size:var(--tfx-min,360px)}' +
    '.box[data-ready]{min-block-size:0}' +
    'iframe{display:block;box-sizing:border-box;inline-size:100%;max-inline-size:100%;min-inline-size:0;block-size:var(--tfx-min,360px);' +
    'border:0;margin:0;padding:0;background:transparent;opacity:0;transition:opacity 160ms ease-out}' +
    '[data-ready] iframe{opacity:1}' +
    '.sk{position:absolute;inset:0;display:flex;flex-direction:column;gap:12px;padding:24px;box-sizing:border-box}' +
    '.sk i{display:block;block-size:12px;border-radius:6px;background:var(--tfx-sk);animation:tfx-pulse 1.2s ease-in-out infinite alternate}' +
    '.sk i:nth-child(1){inline-size:60%;block-size:20px}.sk i:nth-child(2n){block-size:32px}.sk i:last-child{inline-size:100%;block-size:36px}' +
    '[data-ready] .sk{display:none}' +
    '@keyframes tfx-pulse{from{opacity:.55}to{opacity:1}}' +
    '.veil{position:fixed;inset:0;z-index:2147483000;display:flex;align-items:center;justify-content:center;' +
    'background:rgba(15,18,25,.55);opacity:0;transition:opacity 240ms ease-out;overscroll-behavior:contain}' +
    '.veil:not([data-open]){transition-duration:120ms}' +
    '.veil[hidden]{display:none}.veil[data-open]{opacity:1}' +
    '.panel{position:relative;box-sizing:border-box;inline-size:min(560px,calc(100% - 32px));max-block-size:calc(100% - 64px);' +
    'overflow:hidden;border-radius:12px;background:var(--tfx-bg);box-shadow:0 24px 64px rgba(0,0,0,.28);' +
    'transform:scale(.98);transition:transform 240ms ease-out}' +
    '.veil[data-open] .panel{transform:none}' +
    '.panel iframe{opacity:1;max-block-size:calc(100vh - 64px);block-size:var(--tfx-h,480px)}' +
    '.x{position:absolute;inset-block-start:8px;inset-inline-end:8px;z-index:1;display:grid;place-items:center;inline-size:32px;block-size:32px;' +
    'padding:0;border:0;border-radius:8px;background:var(--tfx-bg);color:var(--tfx-fg);cursor:pointer}' +
    '.x:focus-visible,.fab:focus-visible,.off a:focus-visible{outline:2px solid #fff;outline-offset:2px;box-shadow:0 0 0 4px #111318}' +
    '.off{position:absolute;inset:0;display:grid;place-items:center;padding:24px;box-sizing:border-box;' +
    'font:15px/1.4 system-ui,-apple-system,"Segoe UI",sans-serif;color:var(--tfx-fg)}.off a{color:inherit}' +
    '.fab{position:fixed;inset-block-end:16px;inset-inline-end:16px;z-index:2147482999;box-sizing:border-box;min-block-size:44px;' +
    'max-inline-size:calc(100vw - 32px);padding:0 20px;border:0;border-radius:22px;background:var(--tfx-accent);color:var(--tfx-on);' +
    'font:600 15px/1.2 system-ui,-apple-system,"Segoe UI",sans-serif;box-shadow:0 8px 24px rgba(0,0,0,.2);cursor:pointer;' +
    'white-space:nowrap;overflow:hidden;text-overflow:ellipsis}' +
    '@media (max-width:640px){.panel{inline-size:100%;block-size:100%;max-block-size:none;border-radius:0}' +
    '.panel iframe{block-size:100%;max-block-size:none}}' +
    '@media (prefers-reduced-motion:reduce){.veil,.panel,iframe{transition:opacity 160ms ease-out}.panel{transform:none}.sk i{animation:none}}';

  // A themed shadow root inside a fresh element the site's CSS can't size or pad.
  function shell(dark) {
    var host = document.createElement('div');
    host.setAttribute('data-timefix-embed', '');
    host.style.cssText =
      'all:initial!important;display:block!important;width:100%!important;max-width:100%!important;min-width:0!important';
    var root = host.attachShadow({ mode: 'open' });
    var style = document.createElement('style');
    style.textContent =
      STYLE +
      ':host{--tfx-bg:' +
      (dark ? '#16181d' : '#ffffff') +
      ';--tfx-fg:' +
      (dark ? '#e7e9ee' : '#1f2329') +
      ';--tfx-sk:' +
      (dark ? '#2a2e36' : '#eceef2') +
      '}';
    root.appendChild(style);
    return { host: host, root: root };
  }

  // Where a key's page is: a form at /f/KEY; a booking page at /b/KEY, or at /HANDLE/SLUG when given that way.
  var HANDLE_ADDRESS = /^[a-z0-9]+(?:-[a-z0-9]+)*\/[a-z0-9]+(?:-[a-z0-9]+)*$/;
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
    var dark = holder.getAttribute('data-timefix-theme') === 'dark';
    var parts = shell(dark);
    var box = document.createElement('div');
    box.className = 'box';
    var made = frameFor(kind, key, 'inline', holder);
    made.frame.loading = 'lazy';
    made.frame.setAttribute('scrolling', 'no');
    var skeleton = document.createElement('div');
    skeleton.className = 'sk';
    skeleton.setAttribute('aria-hidden', 'true');
    skeleton.innerHTML = '<i></i><i></i><i></i><i></i><i></i>';
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

  function dialogFor(kind, key, element) {
    var name = kind + ':' + key;
    if (dialogs[name]) return dialogs[name];
    var dark = element.getAttribute('data-timefix-theme') === 'dark';
    var parts = shell(dark);
    var veil = document.createElement('div');
    veil.className = 'veil';
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
    var start = document.createElement('span');
    var end = document.createElement('span');
    start.tabIndex = 0;
    end.tabIndex = 0;
    panel.appendChild(start);
    panel.appendChild(close);
    panel.appendChild(made.frame);
    var skeleton = document.createElement('div');
    skeleton.className = 'sk';
    skeleton.setAttribute('aria-hidden', 'true');
    skeleton.innerHTML = '<i></i><i></i><i></i><i></i><i></i>';
    panel.appendChild(skeleton);
    panel.appendChild(end);
    stall(panel, skeleton, kind, key, made.frame);
    veil.appendChild(panel);
    parts.root.appendChild(veil);
    document.body.appendChild(parts.host);
    var back = null;
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
      if (back && back.focus) back.focus();
    };
    var dialog = {
      open: function () {
        if (!veil.hidden) return;
        back = document.activeElement;
        var root = document.documentElement;
        overflow = root.style.overflow;
        padding = root.style.paddingRight;
        var gap = window.innerWidth - root.clientWidth;
        root.style.overflow = 'hidden';
        if (gap > 0) root.style.paddingRight = gap + 'px';
        veil.hidden = false;
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

  function floating(holder, kind, key) {
    var parts = shell(holder.getAttribute('data-timefix-theme') === 'dark');
    var colour = holder.getAttribute('data-timefix-color') || '';
    if (!/^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(colour)) colour = '#2563eb';
    var button = document.createElement('button');
    button.type = 'button';
    button.className = 'fab';
    button.setAttribute('aria-haspopup', 'dialog');
    button.textContent = cut(holder.getAttribute('data-timefix-text') || 'Contact us', 40);
    button.style.setProperty('--tfx-accent', colour);
    button.style.setProperty('--tfx-on', onColour(colour));
    button.addEventListener('click', function () {
      dialogFor(kind, key, holder).open();
    });
    parts.root.appendChild(button);
    document.body.appendChild(parts.host);
  }

  function popup(trigger, kind, key) {
    trigger.setAttribute('aria-haspopup', 'dialog');
    trigger.addEventListener('click', function (event) {
      event.preventDefault();
      dialogFor(kind, key, trigger).open();
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
        if (name === 'company_url') {
          trap = field.value;
          continue;
        }
        if (!/^[a-z][a-z0-9_]{0,39}$/.test(name) || field.disabled) continue;
        field.removeAttribute('aria-invalid');
        if (field.type === 'checkbox') answers[name] = field.checked;
        else if (field.type === 'radio') {
          if (field.checked) answers[name] = field.value;
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
    if (!key || !/^[A-Za-z0-9_-]{1,64}$/.test(key)) return;
    seen.add(element);
    var mode = element.getAttribute('data-timefix-mode') || 'inline';
    if (mode === 'popup') popup(element, kind, key);
    else if (mode === 'floating') floating(element, kind, key);
    else inline(element, kind, key);
  }

  function scan() {
    var found = document.querySelectorAll(
      '[data-timefix-form],[data-timefix-booking],[data-crm-form],form[data-crm-form-post]',
    );
    for (var i = 0; i < found.length; i += 1) take(found[i]);
  }

  window.addEventListener('message', function (event) {
    if (event.origin !== ORIGIN) return;
    var data = event.data;
    if (!data || typeof data !== 'object' || data.timefix !== 1 || typeof data.type !== 'string') return;
    for (var i = 0; i < frames.length; i += 1) {
      var entry = frames[i];
      if (entry.frame.contentWindow !== event.source) continue;
      // A hidden frame (a closed dialog) measures nothing: its last height stands.
      if (data.type === 'height' && typeof data.height === 'number' && isFinite(data.height) && data.height > 0) {
        entry.height(Math.max(0, Math.min(Math.ceil(data.height), MAX_HEIGHT)));
      } else if (data.type === 'close' && entry.close) entry.close();
      return;
    }
  });

  window.Timefix = { v: 1, scan: scan, consent: consent };
  if (granted) visitor();
  landing();
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', scan);
  else scan();
})();
