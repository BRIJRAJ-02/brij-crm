// The workspace frame's sidebar in Chromium (spec 0026, AC-681, AC-685; spec 0034, milestone 1): the theme switch
// left its footer for Settings, which sits there with ⌘, and opens on that shortcut (but not from a text field);
// inside Settings the settings sidebar takes its place. The app's sidebar draws Home, then the member's sections in
// their order and folds (Bookings and Captures with no label, as round 6 had them), then Tasks, and Settings and Help
// at the foot (AC-921, AC-928, AC-930; owner, 21 and 22 October 2026); a fold or the rail goes
// through the data layer (AC-931, AC-935), and [ toggles the rail outside a text field; while the member's sidebar
// loads nothing guesses at their order, and one that couldn't be read draws the defaults. Tasks and the Inbox carry
// their counts as badges. Sign out asks first (the owner, 21 October 2026).
import type { DataLayer, DueTasksSnapshot, NavOperation, NavSnapshot, NavState } from '@crm/data';
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
  scheduling: ['bookings', 'captures'],
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
/** The Tasks badge's count (AC-924): none due unless a test says otherwise. */
let dueSnapshot: DueTasksSnapshot = { status: 'ready', count: 0, atLeast: false };
const dueSource = {
  retain: () => () => undefined,
  subscribe: () => () => undefined,
  getSnapshot: () => dueSnapshot,
};
/** The Inbox badge's count (spec 0038, AC-1174): nothing unread unless a test says otherwise. */
let unreadSnapshot: number | undefined = 0;
const unreadSource = {
  retain: () => () => undefined,
  subscribe: () => () => undefined,
  getSnapshot: () => unreadSnapshot,
};
const data = {
  calendar: { view: () => calendarView },
  tasks: { due: () => dueSource },
  inbox: { unread: () => unreadSource },
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
  dueSnapshot = { status: 'ready', count: 0, atLeast: false };
  unreadSnapshot = 0;
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
  more: Partial<Pick<WorkspaceFrameProps, 'objects' | 'currentPage' | 'isMissing' | 'roleLabel' | 'workspaces'>> & {
    readonly layer?: DataLayer;
    readonly roleLabel?: string;
  } = {},
): Promise<AnyRouter> {
  const layer = more.layer ?? data;
  const toasts = createToasts();
  const rootRoute = createRootRoute();
  const frame = () => (
    <WorkspaceFrame
      data={layer}
      toasts={toasts}
      slug="acme"
      workspaceName="Acme"
      objects={more.objects ?? []}
      {...(more.currentPage === undefined ? {} : { currentPage: more.currentPage })}
      {...(more.isMissing === undefined ? {} : { isMissing: more.isMissing })}
      {...(more.roleLabel === undefined ? {} : { roleLabel: more.roleLabel })}
      {...(more.workspaces === undefined ? {} : { workspaces: more.workspaces })}
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
  const signIn = createRoute({ getParentRoute: () => rootRoute, path: '/sign-in', component: () => <p>Sign in</p> });
  const home = createRoute({ getParentRoute: () => rootRoute, path: '/', component: () => <p>Home</p> });
  const router = createRouter({
    routeTree: rootRoute.addChildren([start, preferences, signIn, home]),
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
    // Scheduling left Settings on 25 October 2026: Calendars and Round robin are tabs of Bookings.
    expect(groups).toEqual(['Account', 'Workspace']);
    // Every entry is a page in Settings: no link out to Captures.
    expect(nav?.textContent).not.toContain('In Captures');
    expect(nav?.querySelector('a[aria-current="page"]')?.textContent).toBe('Preferences');
    // Nothing of the app's sidebar: no records, no Settings entry at the foot.
    expect(nav?.textContent).not.toContain('Records');
    expect(nav?.querySelector('kbd')).toBeNull();
  });
});

describe('signing out from the workspace menu', () => {
  /** A data layer whose sign out is counted, and answers when `release` is called. */
  function signOutLayer() {
    let calls = 0;
    let release: () => void = () => undefined;
    const layer = {
      ...data,
      auth: {
        signOut: () => {
          calls += 1;
          return new Promise<void>((resolve) => {
            release = resolve;
          });
        },
      },
    } as unknown as DataLayer;
    return { layer, calls: () => calls, release: () => release() };
  }

  /** Opens the workspace menu and picks Sign out. */
  async function pickSignOut(): Promise<void> {
    await page.getByRole('button', { name: /workspace menu/ }).click();
    await page.getByRole('menuitem', { name: 'Sign out' }).click();
  }

  it('holds the workspaces with the role under the open one and Sign out, and no trash or shortcuts', async () => {
    await renderFrame(undefined, {
      roleLabel: 'Owner',
      workspaces: [
        { id: '01900000-0000-7000-8000-0000000000a1', slug: 'acme', name: 'Acme' },
        { id: '01900000-0000-7000-8000-0000000000a2', slug: 'globex', name: 'Globex' },
      ] as unknown as NonNullable<WorkspaceFrameProps['workspaces']>,
    });
    await page.getByRole('button', { name: /workspace menu/ }).click();
    const items = [
      ...document.querySelectorAll<HTMLElement>('[role="menuitem"], [role="menuitemcheckbox"], [role="menuitemradio"]'),
    ];
    const names = items.map((each) => each.textContent.trim());
    expect(names.some((name) => name.includes('Acme') && name.includes('Owner'))).toBe(true);
    expect(names.some((name) => name.includes('Globex') && name.includes('Owner'))).toBe(false);
    // The shortcuts live in the foot's Help (and on ?), not here.
    expect(names.some((name) => name.startsWith('Keyboard shortcuts'))).toBe(false);
    expect(names).toContain('Sign out');
    // The trash lives in Settings (the owner, 22 October 2026), and no section is headed by the role.
    expect(names.some((name) => name.startsWith('Trash'))).toBe(false);
    const headings = [...document.querySelectorAll('[role="menu"] header, [role="menu"] [role="presentation"]')].map(
      (each) => each.textContent.trim(),
    );
    expect(headings).not.toContain('Owner');
  });

  it('asks first: Cancel signs nobody out and puts focus back on the menu’s button', async () => {
    const counted = signOutLayer();
    await renderFrame(undefined, { layer: counted.layer });
    await pickSignOut();
    const dialog = page.getByRole('dialog', { name: 'Sign out?' });
    await expect.element(dialog).toBeVisible();
    expect(dialog.element().textContent).toContain('You’ll need to sign in again on this device.');
    await dialog.getByRole('button', { name: 'Cancel' }).click();
    await expect.element(dialog).not.toBeInTheDocument();
    expect(counted.calls()).toBe(0);
    await expect.element(page.getByRole('button', { name: /workspace menu/ })).toHaveFocus();
  });

  it('signs out once on Sign out, busy while it runs, then opens sign in', async () => {
    const counted = signOutLayer();
    const router = await renderFrame(undefined, { layer: counted.layer });
    await pickSignOut();
    const dialog = page.getByRole('dialog', { name: 'Sign out?' });
    const commit = dialog.getByRole('button', { name: /Sign(ing)? out/ });
    await commit.click();
    // Busy: the commit spins, and a second press does nothing.
    await expect.element(dialog.getByRole('button', { name: 'Signing out' })).toBeVisible();
    await commit.click({ force: true });
    expect(counted.calls()).toBe(1);
    await act(async () => {
      counted.release();
      await new Promise((resolve) => setTimeout(resolve, 50));
    });
    expect(router.state.location.pathname).toBe('/sign-in');
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
  it('draws Home, Records, Bookings and Captures with no label over them, then Tasks, and Settings and Help at the foot', async () => {
    await renderFrame(undefined, { objects: OBJECTS });
    const names = sidebarNames();
    const expected = [
      'Home',
      'Records',
      'People',
      'Companies',
      'Bookings',
      'Captures',
      'Tasks',
      'Settings',
      'Help and shortcuts',
    ];
    expect(names.filter((name) => expected.includes(name))).toEqual(expected);
    // Availability, Booking pages and Forms are tabs inside Bookings and Captures, never rows (the owner, 22 October 2026).
    for (const tab of ['Availability', 'Booking pages', 'Forms']) expect(names).not.toContain(tab);
    // No Scheduling label, fold or menu on screen; the group is named for screen readers.
    expect(names).not.toContain('Scheduling');
    expect(document.querySelector('nav [role="group"][aria-label="Scheduling"]')).not.toBeNull();
    const link = (name: string) =>
      [...document.querySelectorAll<HTMLAnchorElement>('nav a')].find((each) => each.textContent.trim() === name);
    expect(link('Home')?.getAttribute('href')).toBe('/w/acme/home');
    expect(link('Tasks')?.getAttribute('href')).toBe('/w/acme/tasks');
    expect(link('Bookings')?.getAttribute('href')).toBe('/w/acme/bookings/calendar');
    expect(link('Captures')?.getAttribute('href')).toBe('/w/acme/captures/links');
    // The trash left the sidebar for Settings, under Workspace (the owner, 22 October 2026).
    expect(names.some((name) => name.startsWith('Trash'))).toBe(false);
  });

  it('marks the page that is open as current', async () => {
    await renderFrame(undefined, { objects: OBJECTS, currentPage: 'captures' });
    const current = document.querySelectorAll('nav a[aria-current="page"]');
    expect([...current].map((each) => each.textContent.trim())).toEqual(['Captures']);
  });

  it('draws the member’s section order and folds', async () => {
    snapshot = {
      status: 'ready',
      nav: { ...STORED, sections: { order: ['scheduling', 'records'], folded: ['records'] } },
    };
    await renderFrame(undefined, { objects: OBJECTS });
    const names = sidebarNames();
    expect(names.indexOf('Bookings')).toBeLessThan(names.indexOf('Records'));
    expect(button('Records')?.getAttribute('aria-expanded')).toBe('false');
  });

  it('folds a section from its label through the data layer, and opens it again (AC-931)', async () => {
    await renderFrame(undefined, { objects: OBJECTS });
    await act(async () => {
      button('Records')?.click();
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
    expect(sent).toEqual([{ op: 'fold', section: 'records', folded: true }]);
    expect(button('Records')?.getAttribute('aria-expanded')).toBe('false');
    await act(async () => {
      button('Records')?.click();
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
    expect(sent.at(-1)).toEqual({ op: 'fold', section: 'records', folded: false });
    expect(button('Records')?.getAttribute('aria-expanded')).toBe('true');
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
    expect(names).not.toContain('Bookings');
    expect(names).not.toContain('Tasks');
    expect(names).toContain('Home');
    // No collapse button while the member's choice is unknown, so a press never lands on a guess.
    expect(document.querySelector('nav button[aria-label="Collapse the sidebar"]')).toBeNull();
    show({ status: 'ready', nav: STORED });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
    expect(sidebarNames()).toContain('Bookings');
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
    for (const name of ['Tasks', 'Records', 'Bookings', 'Captures', 'Settings']) {
      expect(names).toContain(name);
    }
  });

  it('on a workspace that isn’t there, holds no sidebar and offers only Settings and Help', async () => {
    await renderFrame(undefined, { isMissing: true });
    expect(held).toBe(0);
    const names = sidebarNames();
    expect(names).toContain('Settings');
    expect(names).toContain('Help and shortcuts');
    for (const name of ['Home', 'Tasks', 'Records', 'Scheduling']) expect(names).not.toContain(name);
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
    await pick('Records options', 'Move down');
    // Drawn: Records, Scheduling; stored: Favourites, Records, Lists, Scheduling. Down lands after Scheduling.
    expect(sent).toEqual([{ op: 'moveSection', section: 'records', toIndex: 3 }]);
  });

  it('reorders an item from the keyboard on its grip, announcing the move (AC-932)', async () => {
    await renderFrame(undefined, { objects: OBJECTS });
    const grip = button('Move Companies');
    if (grip === undefined) throw new Error('No grip.');
    await act(async () => {
      grip.focus();
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
    // The library's drag wrapper (dnd-kit) reads the key's code, and moves focus off the grip once it lifts.
    const key = async (key: string, code: string) => {
      await act(async () => {
        (document.activeElement ?? grip).dispatchEvent(
          new KeyboardEvent('keydown', { key, code, bubbles: true, cancelable: true }),
        );
        await new Promise((resolve) => setTimeout(resolve, 50));
      });
    };
    await key(' ', 'Space');
    await key('ArrowUp', 'ArrowUp');
    await key(' ', 'Space');
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
    // Tasks, People, Companies, Bookings and Captures, each with its switch.
    expect(dialog?.querySelectorAll('[role="switch"]')).toHaveLength(5);
  });

  it('badges Tasks with my open tasks overdue or due today, and draws none at zero (AC-924)', async () => {
    dueSnapshot = { status: 'ready', count: 4, atLeast: false };
    await renderFrame(undefined, { objects: OBJECTS });
    const tasks = [...document.querySelectorAll<HTMLAnchorElement>('nav a')].find(
      (each) => each.getAttribute('href') === '/w/acme/tasks',
    );
    expect(tasks?.textContent).toContain('4');
  });

  it('badges Inbox with my unread notifications once the server offers it (spec 0038, AC-1174)', async () => {
    snapshot = { status: 'ready', nav: { ...STORED, top: ['inbox', 'tasks'] } };
    unreadSnapshot = 3;
    await renderFrame(undefined, { objects: OBJECTS });
    const inbox = [...document.querySelectorAll<HTMLAnchorElement>('nav a')].find(
      (each) => each.getAttribute('href') === '/w/acme/inbox',
    );
    expect(inbox?.textContent).toContain('3');
  });
});

describe('leaving the workspace from its menu', () => {
  /** A data layer whose leave is counted, answering with `answer`. */
  function leaveLayer(answer: () => Promise<void>) {
    let calls = 0;
    const layer = {
      ...data,
      members: {
        leave: () => {
          calls += 1;
          return answer();
        },
      },
    } as unknown as DataLayer;
    return { layer, calls: () => calls };
  }

  /** Opens the workspace menu and picks Leave workspace. */
  async function pickLeave(): Promise<void> {
    await page.getByRole('button', { name: /workspace menu/ }).click();
    await page.getByRole('menuitem', { name: 'Leave workspace' }).click();
  }

  it('asks first, naming the workspace; Cancel leaves nothing', async () => {
    const counted = leaveLayer(() => Promise.resolve());
    await renderFrame(undefined, { layer: counted.layer, roleLabel: 'Member' });
    await pickLeave();
    const dialog = page.getByRole('alertdialog', { name: 'Leave Acme?' });
    await expect.element(dialog).toBeVisible();
    await dialog.getByRole('button', { name: 'Cancel' }).click();
    await expect.element(dialog).not.toBeInTheDocument();
    expect(counted.calls()).toBe(0);
  });

  it('leaves once, then opens the next workspace from /', async () => {
    const counted = leaveLayer(() => Promise.resolve());
    const router = await renderFrame(undefined, { layer: counted.layer, roleLabel: 'Member' });
    await pickLeave();
    const dialog = page.getByRole('alertdialog', { name: 'Leave Acme?' });
    await dialog.getByRole('button', { name: 'Leave workspace' }).click();
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 50));
    });
    expect(counted.calls()).toBe(1);
    expect(router.state.location.pathname).toBe('/');
  });

  it('shows the only owner LAST_OWNER’s sentence inside the dialog, which stays open', async () => {
    const counted = leaveLayer(() =>
      Promise.reject(
        Object.assign(new Error('A workspace needs an owner. Make someone else an owner first.'), {
          name: 'DataError',
          code: 'LAST_OWNER',
        }),
      ),
    );
    await renderFrame(undefined, { layer: counted.layer, roleLabel: 'Owner' });
    await pickLeave();
    const dialog = page.getByRole('alertdialog', { name: 'Leave Acme?' });
    await dialog.getByRole('button', { name: 'Leave workspace' }).click();
    await expect.element(dialog.getByRole('alert')).toBeVisible();
    expect(dialog.element().textContent).toContain('A workspace needs an owner.');
    expect(counted.calls()).toBe(1);
  });

  it('isn’t offered before the person’s role is known', async () => {
    await renderFrame();
    await page.getByRole('button', { name: /workspace menu/ }).click();
    await expect.element(page.getByRole('menuitem', { name: 'Sign out' })).toBeVisible();
    expect(page.getByRole('menuitem', { name: 'Leave workspace' }).elements()).toHaveLength(0);
  });
});
