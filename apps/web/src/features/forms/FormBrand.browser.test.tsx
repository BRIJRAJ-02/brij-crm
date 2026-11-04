// The form's look and its branded preview in Chromium (spec 0063, AC-6327; forms fixes 3): Mode, Corners and Brand
// upfront over the preview, the preview wearing the workspace's kit while it is Workspace brand, and the one line that
// says where to put a kit the workspace hasn't saved yet.
import type { BrandKit, BrandStore, PublicForm } from '@crm/data';
import { useState } from 'react';
import { afterEach, expect, it } from 'vitest';
import { page, userEvent } from 'vitest/browser';
import { Card, PreviewLayout } from '@crm/ui';
import { renderInApp } from '../../testing/renderInApp.tsx';
import { BrandedFormPreview, LookControls, type FormLook } from './FormBrand.tsx';
// The app's own stylesheet, as `main.tsx` loads it: without it the shots below would be unstyled markup.
import '@crm/ui/styles.css';

let app: { readonly unmount: () => void } | undefined;

afterEach(() => {
  app?.unmount();
  app = undefined;
});

const FORM: PublicForm = {
  key: 'contact-us',
  status: 'live',
  versionNumber: 1,
  headline: 'Talk to us',
  buttonText: 'Send',
  language: 'en',
  look: { colour: 'light', corners: 'rounded', theme: 'brand' },
  offersMeeting: false,
  questions: [{ id: 'q-email', key: 'email', label: 'Work email', answerType: 'email', required: true }],
};

const KIT: BrandKit = { accent: '#1f5fd6', logo: { version: '0123456789ab' }, canEdit: true, template: 'classic' };
const EMPTY: BrandKit = { canEdit: true, template: 'classic' };

/**
 * A brand store whose kit never changes. The snapshot is one frozen constant: `useSyncExternalStore` compares
 * snapshots by identity, so a fresh object each read would redraw for ever.
 */
function storeOf(kit: BrandKit): BrandStore {
  const snapshot = { status: 'ready', value: kit } as const;
  const held = {
    subscribe: () => () => undefined,
    getSnapshot: () => snapshot,
    retain: () => () => undefined,
  };
  return {
    kit: () => held,
    // What `brandColours` answers for this accent: the six names the served stylesheet sets, light and dark.
    colours: (accent?: string) =>
      accent === undefined
        ? undefined
        : {
            variables: [
              ['--brand-accent', '#e65708'],
              ['--brand-on-accent', '#000000'],
              ['--brand-link', '#b74300'],
              ['--brand-accent-dark', '#e8590c'],
              ['--brand-on-accent-dark', '#000000'],
              ['--brand-link-dark', '#fd6c2b'],
            ],
            adjusted: false,
          },
    logoSrc: (_workspace: string, version: string) => `/api/public/forms/contact-us/logo?v=${version}`,
  } as unknown as BrandStore;
}

/** The look's controls on their own, the look kept as the editor's draft keeps it. */
function Picker({ kit }: { readonly kit: BrandKit }) {
  const [look, setLook] = useState<FormLook>({ colour: 'light', corners: 'rounded', theme: 'brand' });
  return (
    <>
      <LookControls brand={storeOf(kit)} slug="acme" look={look} isReadOnly={false} onChange={setLook} />
      <p>{`Look: ${look.colour} ${look.corners} ${look.theme ?? 'plain'}`}</p>
    </>
  );
}

/** Picks `option` from the Select named `name`. */
async function pick(name: RegExp, option: string) {
  await userEvent.click(page.getByRole('button', { name }));
  await userEvent.click(page.getByRole('option', { name: option }));
}

it('shows the look upfront, no click away: Mode, Corners, and Workspace brand or Plain (AC-6327)', async () => {
  app = await renderInApp(() => <Picker kit={KIT} />, { data: {}, pattern: '/w/$slug/forms', at: '/w/acme/forms' });
  await expect.element(page.getByRole('button', { name: /Brand/ })).toHaveTextContent('Workspace brand');
  await expect.element(page.getByRole('button', { name: /Mode/ })).toHaveTextContent('Light');
  await expect.element(page.getByRole('button', { name: /Corners/ })).toHaveTextContent('Rounded');
  await pick(/Brand/, 'Plain');
  await pick(/Mode/, 'Dark');
  await pick(/Corners/, 'Square');
  await expect.element(page.getByText('Look: dark square plain')).toBeVisible();
});

it('says where to add a kit the workspace hasn’t saved yet, in view without a click (AC-6327)', async () => {
  app = await renderInApp(() => <Picker kit={EMPTY} />, { data: {}, pattern: '/w/$slug/forms', at: '/w/acme/forms' });
  await expect.element(page.getByText('Add your logo and colour in Settings › Brand.')).toBeVisible();
});

it('wears the workspace logo in the preview while the look is Brand (AC-6327)', async () => {
  app = await renderInApp(() => <BrandedFormPreview brand={storeOf(KIT)} slug="acme" form={FORM} />, {
    data: {},
    pattern: '/w/$slug/forms',
    at: '/w/acme/forms',
  });
  const logo = document.querySelector('img[src^="/api/public/forms/"]');
  expect(logo?.getAttribute('src')).toBe('/api/public/forms/contact-us/logo?v=0123456789ab');
});

/**
 * The Form tab as the editor draws it (spec 0058, AC-1): the preview column with the look's controls above it. One
 * shot per theme and width, so the controls and the branded preview are checked in both.
 */
for (const [theme, width] of [
  ['light', 1280],
  ['dark', 1280],
] as const) {
  it(`draws the look over the branded preview in ${theme} at ${String(width)} (AC-6327)`, async () => {
    await page.viewport(width, 900);
    document.documentElement.dataset.theme = theme;
    app = await renderInApp(
      () => (
        <PreviewLayout
          bodyLayout="stack"
          preview={<BrandedFormPreview brand={storeOf(KIT)} slug="acme" form={FORM} />}
          previewControls={<Picker kit={KIT} />}
        >
          <Card title="Layout">
            <p>The form’s questions sit here.</p>
          </Card>
        </PreviewLayout>
      ),
      { data: {}, pattern: '/w/$slug/forms', at: '/w/acme/forms' },
    );
    await expect.element(page.getByRole('button', { name: /Corners/ })).toBeVisible();
    // After the page settles, so the shot is not caught mid theme change.
    await new Promise((resolve) => globalThis.setTimeout(resolve, 400));
    await page.screenshot({ path: `../../.vitest/shots/look-controls-${theme}-${String(width)}.png` });
    document.documentElement.dataset.theme = 'light';
  });
}
