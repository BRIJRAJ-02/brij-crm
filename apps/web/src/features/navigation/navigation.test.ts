// The page's title and focus after a route change (spec 0005, every screen),
// against a stand in document: which element takes focus, and what the tab
// is called.
import { describe, expect, it } from 'vitest';
import { focusFirstLoad, focusPage } from './focus.ts';
import { documentTitle, followPageTitle } from './title.ts';

/** A stand in document: the elements each selector finds, which record a focus, a title, and what has focus. */
function fakeDocument(
  found: Readonly<Record<string, { textContent?: string }>>,
  active: 'body' | 'elsewhere' = 'body',
) {
  const focused: string[] = [];
  const body = {};
  const doc = {
    title: 'CRM',
    body,
    activeElement: active === 'body' ? body : {},
    querySelector: (selector: string) => {
      const element = found[selector];
      if (element === undefined) return null;
      return {
        ...element,
        focus: () => {
          focused.push(selector);
        },
      };
    },
  };
  return { doc, focused, asDocument: doc as unknown as Document };
}

describe('focusPage', () => {
  const page = {
    'main h1': { textContent: 'Sign in' },
    'main input[name="email"]': {},
    'main input[autocomplete="one-time-code"]': {},
  };

  it('puts focus in the email field on /sign-in and the code on /verify', () => {
    const signIn = fakeDocument(page);
    focusPage(signIn.asDocument, '/sign-in');
    expect(signIn.focused).toEqual(['main input[name="email"]']);
    const verify = fakeDocument(page);
    focusPage(verify.asDocument, '/verify');
    expect(verify.focused).toEqual(['main input[autocomplete="one-time-code"]']);
  });

  it('puts focus on the title everywhere else, and when a one field page has no field yet', () => {
    const welcome = fakeDocument(page);
    focusPage(welcome.asDocument, '/welcome');
    expect(welcome.focused).toEqual(['main h1']);
    const loading = fakeDocument({ 'main h1': { textContent: 'Sign in' } });
    focusPage(loading.asDocument, '/sign-in');
    expect(loading.focused).toEqual(['main h1']);
  });
});

describe('focusFirstLoad', () => {
  const page = {
    'main h1': { textContent: 'Sign in' },
    'main input[name="email"]': {},
    'main input[autocomplete="one-time-code"]': {},
  };

  it('puts focus in the one field on /sign-in and /verify, as after a route change', () => {
    const signIn = fakeDocument(page);
    focusFirstLoad(signIn.asDocument, '/sign-in');
    expect(signIn.focused).toEqual(['main input[name="email"]']);
    const verify = fakeDocument(page);
    focusFirstLoad(verify.asDocument, '/verify');
    expect(verify.focused).toEqual(['main input[autocomplete="one-time-code"]']);
  });

  it('leaves focus alone everywhere else, never moving it to the title', () => {
    const welcome = fakeDocument(page);
    focusFirstLoad(welcome.asDocument, '/welcome');
    expect(welcome.focused).toEqual([]);
  });

  it('never takes focus the person already moved', () => {
    const moved = fakeDocument(page, 'elsewhere');
    focusFirstLoad(moved.asDocument, '/sign-in');
    expect(moved.focused).toEqual([]);
  });
});

describe('the document title', () => {
  it('is the page title, then the product', () => {
    expect(documentTitle('People')).toBe('People · CRM');
    expect(documentTitle('  Name your\n workspace ')).toBe('Name your workspace · CRM');
  });

  it('is the product alone while the page has no title', () => {
    expect(documentTitle(undefined)).toBe('CRM');
    expect(documentTitle('   ')).toBe('CRM');
  });

  it('says the product once when the page is named after it (a failed load before the workspace is known)', () => {
    expect(documentTitle('CRM')).toBe('CRM');
  });

  it('follows the h1 from the first load, at most once a frame', () => {
    const h1 = { textContent: 'Sign in' };
    const { doc, asDocument } = fakeDocument({ 'main h1': h1 });
    let onChange: () => void = () => undefined;
    const frames: (() => void)[] = [];
    let stopped = false;
    const stop = followPageTitle({
      doc: asDocument,
      observe: (listener) => {
        onChange = listener;
        return () => {
          stopped = true;
        };
      },
      nextFrame: (run) => frames.push(run),
    });
    expect(doc.title).toBe('Sign in · CRM');
    h1.textContent = 'Check your email';
    onChange();
    onChange();
    expect(frames).toHaveLength(1);
    frames.shift()?.();
    expect(doc.title).toBe('Check your email · CRM');
    stop();
    expect(stopped).toBe(true);
  });
});
