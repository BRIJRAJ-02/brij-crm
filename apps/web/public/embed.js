// The first embed script's address, kept for the snippets sites already have
// (`data-crm-form` and `data-crm-form-post`): it loads version 1 from the same
// origin, which reads those attributes too. New snippets name /embed/v1.js.
(function () {
  'use strict';
  var me = document.currentScript;
  if (!me || !me.src) return;
  var next = document.createElement('script');
  next.src = new URL('/embed/v1.js', me.src).href;
  next.async = true;
  var consent = me.getAttribute('data-timefix-consent');
  if (consent) next.setAttribute('data-timefix-consent', consent);
  document.head.appendChild(next);
})();
