// The managed page editor in Chromium (spec 0037, L10, AC-1333 to AC-1335): the lock Switches and who has the
// page; the two opposite endings each ask first and say which one they are (taking someone off deletes their page,
// deleting the managed page keeps every page); and a member's own page shows what their workspace sets, read only.
// The screenshots the lane owes are the `it.runIf` at the end, behind VITE_MANAGED_SHOTS=1. The member's own page
// is NOT covered here: it renders through `PageEditor`, and faking enough of that 1600 line screen to render it
// cost more than the coverage was worth. Its lock is tested where it is enforced, on the server
// (`packages/core/src/booking/managed.test.ts`).
import '@crm/ui/app.css';
import { type CaptureListState, type CaptureListView, type DataLayer, type ManagedPageView } from '@crm/data';
import { PageColumn, TopBar } from '@crm/ui';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { page } from 'vitest/browser';
import { applyTheme, axeViolations, resetTheme, THEMES } from '../../testing/axe.ts';
import { openDialog, renderInApp, type InApp } from '../../testing/renderInApp.tsx';
import { ManagedPageEditor } from './ManagedPageEditor.tsx';
import { managedStrings } from './managed-strings.ts';

const SAM = '11111111-1111-4111-8111-111111111111';
const KIM = '22222222-2222-4222-8222-222222222222';

/** The template as its editor reads it: locked Details, two people with their pages. */
function templateOf(over: Partial<ManagedPageView> = {}): ManagedPageView {
  return {
    id: '33333333-3333-4333-8333-333333333333',
    title: 'Intro call',
    slug: 'intro-call',
    description: 'Fifteen minutes to say hello.',
    locked: ['address', 'details', 'durations'],
    followTeamId: null,
    canChange: true,
    members: [
      { id: SAM, name: 'Sam Lee', pageId: 'p-sam', slug: 'intro-call-sam' },
      { id: KIM, name: 'Kim Park', pageId: 'p-kim', slug: 'intro-call-kim' },
    ],
    ...over,
  };
}

/** A fake held list that answers `ready` at once, as the data layer's does. */
function listOf<Item>(items: readonly Item[]): CaptureListView<Item> {
  const snapshot: CaptureListState<Item> = { status: 'ready', items, pendingIds: new Set() };
  return {
    subscribe: () => () => undefined,
    getSnapshot: () => snapshot,
    retain: () => () => undefined,
    ready: () => Promise.resolve(),
    reload: () => undefined,
  };
}

let shown: InApp | undefined;
beforeAll(() => {
  resetTheme();
});
// A desktop view for every case, so the column never scrolls its controls out of reach and the shots are the same
// size each run. The lane checks the phone width by hand rather than pinning a second size here.
beforeEach(async () => {
  await page.viewport(1280, 1000);
});
afterEach(() => {
  shown?.unmount();
  shown = undefined;
  resetTheme();
  vi.restoreAllMocks();
});

/** The editor inside the page's real chrome: the TopBar it has in the route, and the one column it sits in. */
async function render(template: ManagedPageView, layer: Partial<DataLayer> = {}) {
  const setMembers = vi.fn(() => Promise.resolve(template));
  const update = vi.fn(() => Promise.resolve(template));
  const remove = vi.fn(() => Promise.resolve({ deleted: true as const }));
  const data = {
    managedPages: { setMembers, update, remove, view: () => listOf<ManagedPageView>([template]) },
    ...layer,
  } as unknown as Partial<DataLayer>;
  shown = await renderInApp(
    () => (
      <>
        <TopBar title={template.title} meta={managedStrings.editorTitle} />
        <PageColumn>
          <ManagedPageEditor
            data={data as DataLayer}
            slug="acme"
            template={template}
            people={[
              { id: SAM, name: 'Sam Lee', email: 'sam@example.com' },
              { id: KIM, name: 'Kim Park', email: 'kim@example.com' },
              { id: '44444444-4444-4444-8444-444444444444', name: 'Ada Lovelace', email: 'ada@example.com' },
            ]}
            toasts={shownToasts()}
            onDeleted={() => undefined}
          />
        </PageColumn>
      </>
    ),
    {
      data,
      pattern: '/w/$slug/captures/managed/$templateId',
      at: '/w/acme/captures/managed/t',
      permissions: ['booking.admin'],
    },
  );
  return { setMembers, update, remove };
}

/** The app's toast queue for the screen under test; `renderInApp` makes its own for the provider. */
function shownToasts() {
  return { toast: () => undefined, dismiss: () => undefined, queue: [] } as unknown as Parameters<
    typeof ManagedPageEditor
  >[0]['toasts'];
}

describe('the managed page editor (AC-1333 to AC-1335)', () => {
  it('shows a Switch per lockable part, with the locked ones on', async () => {
    await render(templateOf());
    for (const name of Object.values(managedStrings.partName)) {
      await expect.element(page.getByRole('switch', { name })).toBeVisible();
    }
    await expect.element(page.getByRole('switch', { name: managedStrings.partName.details })).toBeChecked();
    await expect.element(page.getByRole('switch', { name: managedStrings.partName.limits })).not.toBeChecked();
  });

  it('asks before taking someone off, and says their page is deleted', async () => {
    const { setMembers } = await render(templateOf());
    await page.getByRole('button', { name: managedStrings.removePerson('Sam Lee') }).click();
    const asked = openDialog('alertdialog');
    expect(asked).not.toBeNull();
    // The question names the ending: their page goes, their bookings stay.
    expect(asked?.textContent).toContain('page and its link are deleted');
    expect(asked?.textContent).toContain('Bookings already made stay in Bookings');
    expect(setMembers).not.toHaveBeenCalled();
    await page.getByRole('button', { name: managedStrings.removeAction('Sam Lee') }).click();
    expect(setMembers).toHaveBeenCalledTimes(1);
    // Only Kim is left in what was sent.
    expect(setMembers).toHaveBeenCalledWith('acme', templateOf().id, [KIM]);
  });

  it('asks before deleting the managed page, and says every member page stays', async () => {
    const { remove } = await render(templateOf());
    await page.getByRole('button', { name: managedStrings.deleteTemplate }).click();
    const asked = openDialog('alertdialog');
    expect(asked).not.toBeNull();
    // The opposite ending, said as plainly: nothing is deleted.
    expect(asked?.textContent).toContain('keep working and become their owners’ own');
    // Never the broader (and false) "nothing is deleted": the template itself does go.
    expect(asked?.textContent).not.toContain('nothing is deleted');
    expect(remove).not.toHaveBeenCalled();
    await page.getByRole('button', { name: managedStrings.deleteAction }).click();
    expect(remove).toHaveBeenCalledTimes(1);
  });

  it('keeps the two endings apart: neither question can be read as the other', async () => {
    await render(templateOf());
    await page.getByRole('button', { name: managedStrings.removePerson('Sam Lee') }).click();
    const removal = openDialog('alertdialog')?.textContent ?? '';
    expect(removal).not.toContain('keep working');
    await page.getByRole('button', { name: managedStrings.removeKeep }).click();
    await page.getByRole('button', { name: managedStrings.deleteTemplate }).click();
    const deletion = openDialog('alertdialog')?.textContent ?? '';
    expect(deletion).not.toContain('are deleted');
  });

  it('saves the details and the locks together, and can be saved again straight after', async () => {
    const { update } = await render(templateOf());
    await page.getByRole('textbox', { name: managedStrings.title }).fill('Intro chat');
    await page.getByRole('button', { name: 'Save' }).click();
    expect(update).toHaveBeenCalledTimes(1);
    // The bar's status is derived, not latched: a second edit finds Save pressable again (a latch killed it once).
    await page.getByRole('textbox', { name: managedStrings.title }).fill('Intro chat again');
    await expect.element(page.getByRole('button', { name: 'Save' })).toBeEnabled();
  });

  it('makes the people wait while the locks are unsaved, so nobody gets a page built from the old settings', async () => {
    await render(templateOf());
    await page.getByRole('textbox', { name: managedStrings.title }).fill('Intro chat');
    // Adding someone now would make their page from the template as last saved, without the change just made.
    await expect.element(page.getByRole('button', { name: managedStrings.removePerson('Sam Lee') })).toBeDisabled();
  });

  it.each(THEMES)('has no axe violations in %s', async (theme) => {
    await render(templateOf());
    applyTheme(theme);
    expect(await axeViolations()).toEqual([]);
  });

  it.runIf(import.meta.env.VITE_MANAGED_SHOTS === '1')('saves the three screenshots, light and dark', async () => {
    // Beside this file (Vite serves nothing outside the project); the lane moves them to its scratchpad.
    const dir = 'managed-shots';
    for (const theme of THEMES) {
      await page.viewport(1280, 1000);
      await render(templateOf());
      // `applyTheme` finishes every running CSS transition, so no shot is caught mid theme change.
      applyTheme(theme);
      await settle();
      await page.screenshot({ path: `${dir}/template-editor-${theme}.png` });
      // The removal question, the ending that deletes a page.
      await page.getByRole('button', { name: managedStrings.removePerson('Sam Lee') }).click();
      await expect.element(page.getByRole('alertdialog')).toBeVisible();
      applyTheme(theme);
      await settle();
      await page.screenshot({ path: `${dir}/remove-confirm-${theme}.png` });
      shown?.unmount();
      shown = undefined;
      resetTheme();
    }
  });
});

/** Past the enter animation and any transition the theme change started, so no shot is caught mid change. */
async function settle(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 450));
  await Promise.all(document.getAnimations().map((animation) => animation.finished.catch(() => undefined)));
}
