// The code a site pastes (spec 0023, 0023-embeds.md): each embed mode names
// the script once and the right holder, and the site's own HTML is tagged
// with stable ids, names, labels, autofill hints, choice keys, the honeypot
// and live status lines, every word escaped.
import { describe, expect, it } from 'vitest';
import type { FormDocument } from '@crm/data';
import { siteOrigin } from './InstallTab.tsx';
import { embedSnippet, escapeHtml, ownFormHtml, type EmbedTarget } from './snippets.ts';

const SCRIPT = 'https://brij-crm-phi.vercel.app/embed/v1.js';

const target: EmbedTarget = {
  kind: 'form',
  publicKey: 'demo-request',
  title: 'Talk to "us" <now>',
  theme: 'dark',
  buttonText: 'Talk to us',
};

const draft: FormDocument = {
  questions: [
    { id: 'q1', key: 'name', label: 'Your name', answerType: 'short_text', required: true, update: 'fill' },
    { id: 'q2', key: 'email', label: 'Work email', answerType: 'email', required: true, update: 'fill' },
    { id: 'q3', key: 'phone', label: 'Phone', answerType: 'phone', required: false, update: 'fill' },
    {
      id: 'q4',
      key: 'budget',
      label: 'Budget <band>',
      answerType: 'dropdown',
      required: false,
      update: 'fill',
      choices: ['Under $5k', 'Over $5k'],
    },
    { id: 'q5', key: 'terms', label: 'I agree', answerType: 'checkbox', required: true, update: 'fill' },
    { id: 'q6', key: 'deck', label: 'Your deck', answerType: 'file', required: false, update: 'fill' },
  ],
  targets: {},
  look: { colour: 'light', corners: 'rounded' },
  headline: 'Talk to us',
  buttonText: 'Send it',
  language: 'en',
  after: { kind: 'message', message: 'Thanks, we will write back.' },
  routing: { rules: [] },
  spam: { minFillMs: 2_000, scoreThreshold: 0.3 },
};

describe('the embed snippets', () => {
  it('puts the script first, then the holder for each mode, with every word escaped', () => {
    const inline = embedSnippet(SCRIPT, target, 'inline');
    expect(inline.split('\n')).toEqual([
      `<script src="${SCRIPT}" async></script>`,
      '<div data-timefix-form="demo-request" data-timefix-title="Talk to &quot;us&quot; &lt;now&gt;" data-timefix-theme="dark"></div>',
    ]);
    expect(embedSnippet(SCRIPT, target, 'popup')).toContain(
      '<button type="button" data-timefix-form="demo-request" data-timefix-mode="popup"',
    );
    const floating = embedSnippet(SCRIPT, { ...target, kind: 'booking', theme: 'light' }, 'floating');
    expect(floating).toContain('data-timefix-booking="demo-request" data-timefix-mode="floating"');
    expect(floating).toContain('data-timefix-text="Talk to us" data-timefix-color="#1f5fd6"');
    expect(floating).not.toContain('data-timefix-theme');
  });

  it('escapes every character that could leave an attribute or start markup', () => {
    expect(escapeHtml(`<a href="x" onclick='y'>&</a>`)).toBe(
      '&lt;a href=&quot;x&quot; onclick=&#39;y&#39;&gt;&amp;&lt;/a&gt;',
    );
  });
});

describe('the site’s own HTML', () => {
  const html = ownFormHtml(
    { publicKey: 'demo-request', draft, liveVersionNumber: 4, workspaceKey: 'ws_0123456789abcdef' },
    SCRIPT,
  );

  it('names the workspace by its public key, the form and its version, never an internal id', () => {
    expect(html.split('\n')[0]).toBe(
      '<form id="timefix-demo-request" data-timefix-form="demo-request" data-timefix-workspace="ws_0123456789abcdef" data-timefix-version="4">',
    );
  });

  it('names each input by its question’s key, with a matching id, a label for it, autofill and required', () => {
    expect(html).toContain('<label for="tfx-demo-request-name">Your name</label>');
    expect(html).toContain('<input type="text" id="tfx-demo-request-name" name="name" autocomplete="name" required>');
    expect(html).toContain(
      '<input type="email" id="tfx-demo-request-email" name="email" autocomplete="email" required>',
    );
    expect(html).toContain('<input type="tel" id="tfx-demo-request-phone" name="phone" autocomplete="tel">');
    expect(html).toContain('<input type="checkbox" id="tfx-demo-request-terms" name="terms" value="yes" required>');
  });

  it('posts a choice by its stable key, after a Choose one that counts as no answer', () => {
    expect(html).toContain('<label for="tfx-demo-request-budget">Budget &lt;band&gt;</label>');
    expect(html).toContain('<option value="">Choose one</option>');
    expect(html).toContain('<option value="under_5k">Under $5k</option>');
    expect(html).toContain('<option value="over_5k">Over $5k</option>');
  });

  it('brings the honeypot, the polite thank you and the alert line, then the script, and leaves files out', () => {
    expect(html).toContain(
      '<input type="text" id="tfx-demo-request-tf-trap" name="tf-trap" tabindex="-1" autocomplete="off" data-1p-ignore="true" data-lpignore="true" data-bwignore="true" data-form-type="other">',
    );
    expect(html).not.toContain('company_url');
    expect(html).toContain('<p role="status" data-timefix-success="Thanks, we will write back."></p>');
    expect(html).toContain('<p role="alert" data-timefix-error></p>');
    expect(html).toContain('<button type="submit">Send it</button>');
    expect(html).not.toContain('name="deck"');
    expect(html.endsWith(`<script src="${SCRIPT}" async></script>`)).toBe(true);
  });
});

describe('a site’s address', () => {
  it('takes an https origin, or http on this machine, and refuses anything else', () => {
    expect(siteOrigin('http://localhost:3000/form')).toEqual({ origin: 'http://localhost:3000' });
    expect(siteOrigin(' https://acme.com/pricing ')).toEqual({ origin: 'https://acme.com' });
    expect(siteOrigin('http://acme.com').problem).toBeDefined();
    expect(siteOrigin('acme.com').problem).toBeDefined();
    expect(siteOrigin('https://ada:pw@acme.com').problem).toBeDefined();
  });
});
