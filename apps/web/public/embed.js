// The form embed (spec 0023, 0023-experience.md, Install tab). A site adds
// this script and a `<div data-crm-form="<address>">`; the script puts the
// hosted form in an iframe there and sizes it to the form's height, which the
// form posts as it changes, so the form looks the same everywhere and the
// site's CSS can't reach it. The iframe learns the site's page, referrer and
// query (UTM tags) from its address.
//
// "Your own form": a `<form data-crm-form-post="<address>">` keeps the site's
// own markup; each input carrying `data-crm-field="<question key>"` is sent
// as that question's answer, and the page then shows the element marked
// `data-crm-thanks`, if any. The site must be listed in the form's settings.
// A plain classic script, no modules, no dependencies.
(function () {
  'use strict';
  var script = document.currentScript;
  if (!script || !script.src) return;
  var origin = new URL(script.src).origin;
  var frames = [];
  var bound = new WeakSet();

  function embed(holder) {
    var address = holder.getAttribute('data-crm-form');
    if (!address || holder.querySelector('iframe')) return;
    var src = new URL('/f/' + encodeURIComponent(address), origin);
    src.searchParams.set('embed', '1');
    src.searchParams.set('page', window.location.href.slice(0, 2048));
    if (document.referrer) src.searchParams.set('referrer', document.referrer.slice(0, 2048));
    if (window.location.search) src.searchParams.set('from', window.location.search.slice(0, 2048));
    var frame = document.createElement('iframe');
    frame.src = src.href;
    frame.title = holder.getAttribute('data-crm-title') || 'Form';
    frame.loading = 'lazy';
    frame.setAttribute('scrolling', 'no');
    frame.style.width = '100%';
    frame.style.border = '0';
    frame.style.display = 'block';
    frame.style.height = '480px';
    holder.appendChild(frame);
    frames.push({ frame: frame, address: address });
  }

  window.addEventListener('message', function (event) {
    if (event.origin !== origin || !event.data || event.data.type !== 'crm-form-height') return;
    for (var i = 0; i < frames.length; i += 1) {
      var entry = frames[i];
      if (entry.frame.contentWindow === event.source && typeof event.data.height === 'number') {
        entry.frame.style.height = Math.max(0, Math.min(event.data.height, 20000)) + 'px';
      }
    }
  });

  function uuid() {
    if (window.crypto && window.crypto.randomUUID) return window.crypto.randomUUID();
    var bytes = window.crypto.getRandomValues(new Uint8Array(16));
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    var hex = Array.prototype.map
      .call(bytes, function (b) {
        return (b + 0x100).toString(16).slice(1);
      })
      .join('');
    return (
      hex.slice(0, 8) + '-' + hex.slice(8, 12) + '-' + hex.slice(12, 16) + '-' + hex.slice(16, 20) + '-' + hex.slice(20)
    );
  }

  function own(form) {
    var address = form.getAttribute('data-crm-form-post');
    if (!address || bound.has(form)) return;
    bound.add(form);
    var started = Date.now();
    var key = uuid();
    form.addEventListener('submit', function (event) {
      event.preventDefault();
      var answers = {};
      var fields = form.querySelectorAll('[data-crm-field]');
      for (var i = 0; i < fields.length; i += 1) {
        var field = fields[i];
        var name = field.getAttribute('data-crm-field');
        if (field.type === 'checkbox') answers[name] = field.checked;
        else if (field.type === 'radio') {
          if (field.checked) answers[name] = field.value;
        } else answers[name] = field.value;
      }
      var params = new URLSearchParams(window.location.search);
      var hidden = { page: window.location.href.slice(0, 2048) };
      if (document.referrer) hidden.referrer = document.referrer.slice(0, 2048);
      ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content'].forEach(function (name) {
        var value = params.get(name);
        if (value) hidden[name] = value.slice(0, 200);
      });
      var body = { idempotencyKey: key, answers: answers, hidden: hidden, fillMs: Date.now() - started };
      fetch(origin + '/api/public/forms/' + encodeURIComponent(address) + '/submissions', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      }).then(
        function (response) {
          form.dispatchEvent(
            new CustomEvent(response.ok ? 'crm:sent' : 'crm:refused', { detail: { status: response.status } }),
          );
          if (!response.ok) return;
          key = uuid();
          var thanks = form.querySelector('[data-crm-thanks]');
          if (thanks) thanks.hidden = false;
          form.reset();
          started = Date.now();
        },
        function () {
          form.dispatchEvent(new CustomEvent('crm:refused', { detail: { status: 0 } }));
        },
      );
    });
  }

  function scan() {
    var holders = document.querySelectorAll('[data-crm-form]');
    for (var i = 0; i < holders.length; i += 1) embed(holders[i]);
    var owned = document.querySelectorAll('form[data-crm-form-post]');
    for (var j = 0; j < owned.length; j += 1) own(owned[j]);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', scan);
  else scan();
})();
