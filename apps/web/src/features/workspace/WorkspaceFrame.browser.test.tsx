// The workspace frame's sidebar in Chromium (spec 0026, AC-681, AC-685; spec 0034, milestone 1): the theme switch
// left its footer for Settings, which sits there with ⌘, and opens on that shortcut (but not from a text field);
// inside Settings the settings sidebar takes its place. The app's sidebar draws Tasks, then the member's sections in
// their order and folds, then Trash, Settings and Help at the foot (AC-921, AC-928, AC-930); a fold or the rail goes
// through the data layer (AC-931, AC-935), and [ toggles the rail outside a text field; while the member's sidebar
// loads nothing guesses at their order, and one that couldn't be read draws the defaults.
import type { DataLayer, NavOperation, NavSnapshot, NavState } from '@crm/data';
import { createToasts, UiProvider } from '@crm/ui';
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  RouterProvider,
  type AnyRouter,
} from '@tanstack/react-router';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { page } from 'vitest/browser';
import { WorkspaceFrame, type SettingsSidebar, type WorkspaceFrameProps } from './WorkspaceFrame.tsx';

// The frame reaches the data layer on undo and sign out, which these tests never press, for the calendar banner,
// which reads the member's calendars (here none, still loading, so no banner shows), and for the member's sidebar,
// held here by hand: each change the frame sends is kept, and folds and the rail apply at once, as the layer's do.
const loading = { status: 'loading' as const };
const calendarView = {
  subscribe: () => () => undefined,
  getSnapshot: () => loading,
  retain: () => () => undefined,
  ready: () => Promise.resolve(),
  reload: () => undefined,
};

const PEOPLE = '01900000-0000-7000-8000-000000000001';
const COMPANIES = '01900000-0000-7000-8000-000000000002';

/** The member's sidebar with nothing stored: the defaults, as the server answers them. */
const STORED: NavState = {
  items: [],
  sections: { order: ['favourites', 'records', 'lists', 'scheduling'], folded: [] },
  rail: false,
  version: 0,
  favourites: [],
  top: ['tasks'],
  scheduling: ['bookings', 'availability', 'booking_pages', 'forms'],
};

let snapshot: NavSnapshot = { status: 'ready', nav: STORED };
let sent: NavOperation[] = [];
let held = 0;
const listeners = new Set<() => void>();
const show = (next: NavSnapshot) => {
  snapshot = next;
  for (const listener of listeners) listener();
};
const navSource = {
  retain: () => {
    held += 1;
    return () => {
      held -= 1;
    };
  },
  subscribe: (listener: () => void) => {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  },
  getSnapshot: () => snapshot,
};
const data = {
  calendar: { view: () => calendarView },
  nav: {
    source: () => navSource,
    change: (_workspace: string, op: NavOperation) => {
      sent = [...sent, op];
      if (snapshot.status !== 'ready') return;
      const { nav } = snapshot;
      if (op.op === 'rail') show({ status: 'ready', nav: { ...nav, rail: op.on } });
      if (op.op === 'fold') {
        const folded = op.folded
          ? [...nav.sections.folded, op.section]
          : nav.sections.folded.filter((key) => key !== op.section);
        show({ status: 'ready', nav: { ...nav, sections: { ...nav.sections, folded } } });
      }
    },
  },
} as unknown as DataLayer;

const OBJECTS = [
  {
    id: COMPANIES,
    apiSlug: 'companies',
    pluralName: 'Companies',
    position: 2,
    isArchived: false,
    icon: 'building',
    hue: 'blue',
  },
  { id: PEOPLE, apiSlug: 'people', pluralName: 'People', position: 1, isArchived: false, icon: 'user', hue: 'green' },
] as unknown as WorkspaceFrameProps['objects'];

beforeEach(() => {
  snapshot = { status: 'ready', nav: STORED };
  sent = [];
  held = 0;
  try {
    localStorage.clear();
  } catch {
    // Storage blocked: the rail hint reads as open, which these tests expect.
  }
});

// Wider than bp-page-compact, so the sidebar is open and shows its words and keycaps.
beforeAll(async () => {
  await page.viewport(1280, 800);
});

let mounted: { readonly root: Root; readonly host: HTMLElement } | undefined;

afterEach(() => {
  if (mounted === undefined) return;
  const { root, host } = mounted;
  act(() => {
    root.unmount();
  });
  host.remove();
  mounted = undefined;
});

/** Renders the frame at `/w/acme/start` inside a memory router, with a settings page to go to. */
async function renderFrame(
  settings?: SettingsSidebar,
  more: Partial<Pick<WorkspaceFrameProps, 'objects' | 'currentPage' | 'isMissing'>> = {},
): Promise<AnyRouter> {
  const toasts = createToasts();
  const rootRoute = createRootRoute();
  const frame = () => (
    <WorkspaceFrame
      data={data}
      toasts={toasts}
      slug="acme"
      workspaceName="Acme"
      objects={more.objects ?? []}
      {...(more.currentPage === undefined ? {} : { currentPage: more.currentPage })}
      {...(more.isMissing === undefined ? {} : { isMissing: more.isMissing })}
      {...(settings === undefined ? {} : { settings })}
    >
      <input aria-label="Draft" />
    </WorkspaceFrame>
  );
  const start = createRoute({ getParentRoute: () => rootRoute, path: '/w/acme/start', component: frame });
  const preferences = createRoute({
    getParentRoute: () => rootRoute,
    path: '/w/acme/settings/account/preferences',
    component: () => <p>Preferences page</p>,
  });
  const router = createRouter({
    routeTree: rootRoute.addChildren([start, preferences]),
    history: createMemoryHistory({ initialEntries: ['/w/acme/start'] }),
  });
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  mounted = { root, host };
  await act(async () => {
    root.render(
      <UiProvider
        locale="en-GB"
        timeZone="UTC"
        toasts={toasts}
        navigate={(href) => {
          router.history.push(href);
        }}
        useHref={(href) => router.history.createHref(href)}
      >
        <RouterProvider router={router} />
      </UiProvider>,
    );
    await router.load();
  });
  return router;
}

/** Presses ⌘, (Ctrl+, off a Mac) on `target`, and lets the router settle. */
async function pressSettingsKey(target: Element): Promise<void> {
  const isMac = /Mac|iPhone|iPad/.test(navigator.platform);
  await act(async () => {
    target.dispatchEvent(new KeyboardEvent('keydown', { key: ',', metaKey: isMac, ctrlKey: !isMac, bubbles: true }));
    await new Promise((resolve) => setTimeout(resolve, 50));
  });
}

describe('the workspace frame’s sidebar', () => {
  it('no longer holds the theme switch, and keeps Settings at its foot with ⌘,', async () => {
    await renderFrame();
    expect(document.querySelector('[role="radiogroup"]')).toBeNull();
    const settings = [...document.querySelectorAll<HTMLAnchorElement>('nav a')].find((link) =>
      link.textContent.startsWith('Settings'),
    );
    expect(settings?.getAttribute('href')).toBe('/w/acme/settings/account/preferences');
    expect(settings?.querySelector('kbd')).not.toBeNull();
    expect(settings?.getAttribute('aria-keyshortcuts')).toMatch(/^(Meta|Control)\+,$/);
  });

  it('opens Settings on ⌘, (Ctrl+, off a Mac)', async () => {
    const router = await renderFrame();
    await pressSettingsKey(document.body);
    expect(router.state.location.pathname).toBe('/w/acme/settings/account/preferences');
  });

  it('leaves a text field’s ⌘, alone, so a draft is never left behind', async () => {
    const router = await renderFrame();
    const draft = document.querySelector('input[aria-label="Draft"]');
    if (draft === null) throw new Error('No draft field.');
    await pressSettingsKey(draft);
    expect(router.state.location.pathname).toBe('/w/acme/start');
  });

  it('inside Settings, swaps the app sidebar for Settings with its way back and its groups', async () => {
    await renderFrame({ current: 'preferences', backHref: '/w/acme/objects/people' });
    const nav = document.querySelector('nav[aria-label="Settings"]');
    expect(nav).not.toBeNull();
    expect(document.querySelector('nav[aria-label="Main navigation"]')).toBeNull();
    expect(nav?.getAttribute('data-keyboard')).toBe('arrows');
    expect(nav?.querySelector('a[aria-label="Leave settings"]')?.getAttribute('href')).toBe('/w/acme/objects/people');
    // Named by their label on screen, or (folded to the rail on a narrow window) by aria-label.
    const groups = [...(nav?.querySelectorAll('[role="group"]') ?? [])].map((group) => {
      const labelledBy = group.getAttribute('aria-labelledby');
      return labelledBy === null ? group.getAttribute('aria-label') : document.getElementById(labelledBy)?.textContent;
    });
    expect(groups).toEqual(['Account', 'Workspace']);
    // Every entry is a page in Settings: no link out to Captures.
    expect(nav?.textContent).not.toContain('In Captures');
    expect(nav?.querySelector('a[aria-current="page"]')?.textContent).toBe('Preferences');
    // Nothing of the app's sidebar: no records, no Settings entry at the foot.
    expect(nav?.textContent).not.toContain('Records');
    expect(nav?.querySelector('kbd')).toBeNull();
  });
});

/** An element's name as the sidebar shows it: its label, else its words (a keycap, hidden from the name, left out). */
function nameOf(element: Element): string {
  const label = element.getAttribute('aria-label');
  if (label !== null) return label;
  const copy = element.cloneNode(true) as Element;
  for (const hidden of copy.querySelectorAll('[aria-hidden="true"]')) hidden.remove();
  return copy.textContent.trim();
}

/** The sidebar's links and buttons, top to bottom, by name. */
function sidebarNames(): string[] {
  const nav = document.querySelector('nav[aria-label="Main navigation"]');
  return [...(nav?.querySelectorAll('a[href], button') ?? [])].map(nameOf);
}

/** Presses a key on `target`, and lets React settle. */
async function press(target: Element, key: string): Promise<void> {
  await act(async () => {
    target.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
    await new Promise((resolve) => setTimeout(resolve, 20));
  });
}

const button = (name: string) =>
  [...document.querySelectorAll<HTMLButtonElement>('nav button')].find((each) => nameOf(each) === name);

describe('the app’s sidebar (spec 0034)', () => {
  it('draws Tasks, Records and Scheduling with its four pages, then Trash, Settings and Help at the foot', async () => {
    await renderFrame(undefined, { objects: OBJECTS });
    const names = sidebarNames();
    const expected = [
      'Tasks',
      'Records',
      'People',
      'Companies',
      'Scheduling',
      'Bookings',
      'Availability',
      'Booking pages',
      'Forms',
      'Trash',
      'Settings',
      'Help and shortcuts',
    ];
    expect(names.filter((name) => expected.includes(name))).toEqual(expected);
    expect(names).not.toContain('Captures');
    const link = (name: string) =>
      [...document.querySelectorAll<HTMLAnchorElement>('nav a')].find((each) => each.textContent.trim() === name);
    expect(link('Tasks')?.getAttribute('href')).toBe('/w/acme/tasks');
    expect(link('Bookings')?.getAttribute('href')).toBe('/w/acme/bookings/calendar');
    expect(link('Availability')?.getAttribute('href')).toBe('/w/acme/availability');
    expect(link('Booking pages')?.getAttribute('href')).toBe('/w/acme/booking-pages');
    expect(link('Forms')?.getAttribute('href')).toBe('/w/acme/forms');
    expect(link('Trash')?.getAttribute('href')).toBe('/w/acme/trash');
  });

  it('marks the page that is open as current', async () => {
    await renderFrame(undefined, { objects: OBJECTS, currentPage: 'booking_pages' });
    const current = document.querySelectorAll('nav a[aria-current="page"]');
    expect([...current].map((each) => each.textContent.trim())).toEqual(['Booking pages']);
  });

  it('draws the member’s section order and folds', async () => {
    snapshot = {
      status: 'ready',
      nav: { ...STORED, sections: { order: ['scheduling', 'records'], folded: ['records'] } },
    };
    await renderFrame(undefined, { objects: OBJECTS });
    const names = sidebarNames();
    expect(names.indexOf('Scheduling')).toBeLessThan(names.indexOf('Records'));
    expect(button('Records')?.getAttribute('aria-expanded')).toBe('false');
    expect(button('Scheduling')?.getAttribute('aria-expanded')).toBe('true');
  });

  it('folds a section from its label through the data layer, and opens it again (AC-931)', async () => {
    await renderFrame(undefined, { objects: OBJECTS });
    await act(async () => {
      button('Scheduling')?.click();
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
    expect(sent).toEqual([{ op: 'fold', section: 'scheduling', folded: true }]);
    expect(button('Scheduling')?.getAttribute('aria-expanded')).toBe('false');
    await act(async () => {
      button('Scheduling')?.click();
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
    expect(sent.at(-1)).toEqual({ op: 'fold', section: 'scheduling', folded: false });
    expect(button('Scheduling')?.getAttribute('aria-expanded')).toBe('true');
  });

  it('folds the whole sidebar to its rail with [ and back, never from a text field (AC-935)', async () => {
    await renderFrame(undefined, { objects: OBJECTS });
    const draft = document.querySelector('input[aria-label="Draft"]');
    if (draft === null) throw new Error('No draft field.');
    await press(draft, '[');
    expect(sent).toEqual([]);
    await press(document.body, '[');
    expect(sent).toEqual([{ op: 'rail', on: true }]);
    expect(document.querySelector('nav[aria-label="Main navigation"]')?.hasAttribute('data-collapsed')).toBe(true);
    await press(document.body, '[');
    expect(sent.at(-1)).toEqual({ op: 'rail', on: false });
  });

  it('lists [ among the shortcuts that Help and shortcuts opens', async () => {
    await renderFrame(undefined, { objects: OBJECTS });
    await act(async () => {
      button('Help and shortcuts')?.click();
      await new Promise((resolve) => setTimeout(resolve, 50));
    });
    const dialog = document.querySelector('[role="dialog"]');
    expect(dialog?.textContent).toContain('Fold the sidebar to icons, or open it');
  });

  it('while the member’s sidebar loads, shows Records loading and guesses at nothing else (AC-936)', async () => {
    snapshot = { status: 'loading' };
    await renderFrame(undefined, { objects: OBJECTS });
    const names = sidebarNames();
    expect(names).toContain('Records');
    expect(names).not.toContain('Scheduling');
    expect(names).not.toContain('Tasks');
    expect(names).toContain('Trash');
    // No collapse button while the member's choice is unknown, so a press never lands on a guess.
    expect(document.querySelector('nav button[aria-label="Collapse the sidebar"]')).toBeNull();
    show({ status: 'ready', nav: STORED });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
    expect(sidebarNames()).toContain('Scheduling');
  });

  it('draws the rail this browser last saw while the member’s sidebar loads, so the page doesn’t jump', async () => {
    localStorage.setItem('crm.sidebar.rail.acme', '1');
    snapshot = { status: 'loading' };
    await renderFrame(undefined, { objects: OBJECTS });
    expect(document.querySelector('nav[aria-label="Main navigation"]')?.hasAttribute('data-collapsed')).toBe(true);
  });

  it('draws the defaults when the member’s sidebar couldn’t be read', async () => {
    snapshot = { status: 'error', error: { code: 'INTERNAL', message: 'Down.' } as never };
    await renderFrame(undefined, { objects: OBJECTS });
    const names = sidebarNames();
    for (const name of ['Tasks', 'Records', 'Scheduling', 'Bookings', 'Availability', 'Booking pages', 'Forms']) {
      expect(names).toContain(name);
    }
  });

  it('on a workspace that isn’t there, holds no sidebar and offers only Settings and Help', async () => {
    await renderFrame(undefined, { isMissing: true });
    expect(held).toBe(0);
    const names = sidebarNames();
    expect(names).toContain('Settings');
    expect(names).toContain('Help and shortcuts');
    for (const name of ['Tasks', 'Records', 'Scheduling', 'Trash']) expect(names).not.toContain(name);
  });

  /** Opens a menu by its button's name and picks one of its items, letting React settle. */
  async function pick(menuButton: string, item: string) {
    await act(async () => {
      button(menuButton)?.click();
      await new Promise((resolve) => setTimeout(resolve, 80));
    });
    const choice = [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')].find(
      (each) => each.textContent.trim() === item,
    );
    if (choice === undefined) throw new Error(`No ${item} in ${menuButton}.`);
    await act(async () => {
      choice.click();
      await new Promise((resolve) => setTimeout(resolve, 80));
    });
  }

  it('hides an object from its menu (AC-933)', async () => {
    await renderFrame(undefined, { objects: OBJECTS });
    await pick('More for Companies', 'Hide from sidebar');
    expect(sent).toEqual([{ op: 'hide', kind: 'object', id: COMPANIES }]);
  });

  it('moves a section from its menu, counting the sections it doesn’t draw (AC-932)', async () => {
    await renderFrame(undefined, { objects: OBJECTS });
    await pick('Scheduling options', 'Move up');
    // Drawn: Records, Scheduling; stored: Favourites, Records, Lists, Scheduling. Up lands before Records.
    expect(sent).toEqual([{ op: 'moveSection', section: 'scheduling', toIndex: 1 }]);
  });

  it('reorders an item from the keyboard on its grip, announcing the move (AC-932)', async () => {
    await renderFrame(undefined, { objects: OBJECTS });
    const grip = button('Move Companies');
    if (grip === undefined) throw new Error('No grip.');
    await act(async () => {
      grip.focus();
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
    await press(grip, ' ');
    await press(grip, 'ArrowUp');
    await press(grip, ' ');
    expect(sent).toEqual([{ op: 'move', kind: 'object', id: COMPANIES, toIndex: 0 }]);
    const said = [...document.querySelectorAll('[role="status"]')].map((each) => each.textContent).join(' ');
    expect(said).toContain('Companies, moved to position 1 of 2.');
  });

  it('opens Customise sidebar from a section’s menu, listing Your work and each section’s items', async () => {
    await renderFrame(undefined, { objects: OBJECTS });
    await pick('Records options', 'Customise sidebar');
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 300));
    });
    const dialog = document.querySelector('[role="dialog"]');
    expect(dialog?.textContent).toContain('Customise sidebar');
    expect(dialog?.textContent).toContain('Your work');
    // Tasks, People, Companies and the four Scheduling pages, each with its switch.
    expect(dialog?.querySelectorAll('[role="switch"]')).toHaveLength(7);
  });
});
