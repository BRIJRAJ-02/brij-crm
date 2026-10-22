// First run in Chromium (spec 0036): the steps in order with their count,
// Back keeping what was typed, the address checked as typed, Create
// workspace going on to the calendar step with the same id on every try, the
// calendar step's Skip, and Sign out asking first (the owner, 21 October
// 2026): Cancel changes nothing, and Sign out signs out once.
import type { DataLayer, SignedInUser } from '@crm/data';
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
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { page, userEvent } from 'vitest/browser';
import { shownStep, welcomeSearch } from './steps.ts';
import { WelcomeScreen, type WelcomeScreenProps } from './WelcomeScreen.tsx';

const USER: SignedInUser = { id: '0199a6f2-0000-7000-8000-000000000001', name: '', email: 'ada.lovelace@acme.com' };
const WORKSPACE_ID = '0199a6f2-0000-7000-8000-00000000000a';

/** A stand in data layer: what first run calls, counted. */
function fakeData(taken: readonly string[] = ['taken-one']) {
  const created: {
    readonly id: string;
    readonly name: string;
    readonly slug: string;
    readonly memberName: string;
  }[] = [];
  const checked: string[] = [];
  const invites: { readonly workspace: string; readonly emails: readonly string[]; readonly role: string }[] = [];
  let signOuts = 0;
  let release: () => void = () => undefined;
  const data = {
    workspaces: {
      newId: () => WORKSPACE_ID,
      slugAvailable: (slug: string) => {
        checked.push(slug);
        return Promise.resolve(!taken.includes(slug));
      },
      create: (input: (typeof created)[number]) => {
        created.push(input);
        return Promise.resolve({ workspace: { id: input.id, slug: input.slug, name: input.name } });
      },
    },
    auth: {
      // Held until the test lets it finish, so a second press can be tried while it runs.
      signOut: () => {
        signOuts += 1;
        return new Promise<void>((resolve) => {
          release = resolve;
        });
      },
    },
    invitations: {
      create: (workspace: string, emails: readonly string[], role: string) => {
        invites.push({ workspace, emails, role });
        return Promise.resolve({
          invited: emails.filter((email) => email !== 'grace@acme.com').map((email) => ({ email })),
          refused: emails
            .filter((email) => email === 'grace@acme.com')
            .map((email) => ({ email, code: 'ALREADY_MEMBER', message: 'Already a member.' })),
          unsent: [],
        });
      },
    },
    calendar: {
      connectUrl: (slug: string, then?: string) => `/api/calendar/google/start?workspace=${slug}&then=${String(then)}`,
    },
  } as unknown as DataLayer;
  return {
    data,
    created,
    checked,
    invites,
    signOuts: () => signOuts,
    release: () => {
      release();
    },
  };
}

beforeAll(async () => {
  // Wider than bp-page-compact, so the preview shows beside the step.
  await page.viewport(1280, 800);
});

let mounted: { readonly root: Root; readonly host: HTMLElement } | undefined;

afterEach(() => {
  sessionStorage.clear();
  if (mounted === undefined) return;
  const { root, host } = mounted;
  act(() => {
    root.unmount();
  });
  host.remove();
  mounted = undefined;
});

/** Renders first run at `start` inside a memory router, with sign in and a workspace page to go to. */
async function renderWelcome(
  data: DataLayer,
  start = '/welcome',
  calendarSync = true,
  inviteRoles?: WelcomeScreenProps['inviteRoles'],
): Promise<AnyRouter> {
  const toasts = createToasts();
  const rootRoute = createRootRoute();
  const welcome = createRoute({
    getParentRoute: () => rootRoute,
    path: '/welcome',
    validateSearch: welcomeSearch,
    component: function Welcome() {
      const search = welcome.useSearch();
      const workspace =
        search.workspace === undefined ? undefined : { id: WORKSPACE_ID, slug: search.workspace, name: 'Acme' };
      return (
        <WelcomeScreen
          data={data}
          user={USER}
          step={shownStep(search.step, workspace !== undefined)}
          calendarSync={calendarSync}
          workspace={workspace}
          calendarResult={search.calendar}
          inviteRoles={inviteRoles}
        />
      );
    },
  });
  const signIn = createRoute({ getParentRoute: () => rootRoute, path: '/sign-in', component: () => <p>Sign in</p> });
  const home = createRoute({ getParentRoute: () => rootRoute, path: '/w/$slug', component: () => <p>People</p> });
  const router = createRouter({
    routeTree: rootRoute.addChildren([welcome, signIn, home]),
    history: createMemoryHistory({ initialEntries: [start] }),
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

describe('first run’s steps', () => {
  it('goes Your name, then Your workspace, counting them, and Back keeps what was typed', async () => {
    const fake = fakeData();
    const router = await renderWelcome(fake.data);
    await expect.element(page.getByRole('heading', { level: 1, name: 'Your name' })).toBeVisible();
    await expect.element(page.getByText('Step 1 of 4')).toBeVisible();
    // The first step has nothing to go back to.
    expect(page.getByRole('button', { name: 'Back' }).query()).toBeNull();
    // Continue needs a name.
    await page.getByRole('button', { name: 'Continue' }).click();
    await expect
      .element(page.getByRole('textbox', { name: 'Your name' }))
      .toHaveAccessibleDescription('Enter your name, or skip this step.');
    await page.getByRole('textbox', { name: 'Your name' }).fill('Ada Lovelace');
    await page.getByRole('button', { name: 'Continue' }).click();

    // No questionnaire (taken out 22 October 2026): straight to Your workspace.
    await expect.element(page.getByRole('heading', { level: 1, name: 'Your workspace' })).toBeVisible();
    expect(router.state.location.search).toEqual({ step: 'workspace' });
    await expect.element(page.getByText('Step 2 of 4')).toBeVisible();
    // The workspace follows the name, and the address the workspace; focus is in the step's first field.
    await expect.element(page.getByRole('textbox', { name: 'Workspace name' })).toHaveValue('Ada’s workspace');
    await expect.element(page.getByRole('textbox', { name: 'Web address' })).toHaveValue('ada');
    await expect.element(page.getByRole('textbox', { name: 'Workspace name' })).toHaveFocus();

    await page.getByRole('button', { name: 'Back' }).click();
    await expect.element(page.getByRole('textbox', { name: 'Your name' })).toHaveValue('Ada Lovelace');
  });

  it('skips Your name, naming the workspace from the email, and leaves out the calendar where sync is off', async () => {
    const fake = fakeData();
    const router = await renderWelcome(fake.data, '/welcome', false);
    await expect.element(page.getByText('Step 1 of 3')).toBeVisible();
    await page.getByRole('button', { name: 'Skip' }).click();
    await expect.element(page.getByRole('textbox', { name: 'Workspace name' })).toHaveValue('Ada’s workspace');
    await expect.element(page.getByText('Available', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Create workspace' }).click();
    // Sync off: Invite your team is the last step, then the workspace, the member named from the email.
    await expect.element(page.getByRole('heading', { level: 1, name: 'Invite your team' })).toBeVisible();
    await expect.element(page.getByText('Step 3 of 3')).toBeVisible();
    await page.getByRole('button', { name: 'Skip for now' }).click();
    await expect.poll(() => router.state.location.pathname).toBe('/w/ada');
    expect(fake.created).toEqual([
      { id: WORKSPACE_ID, name: 'Ada’s workspace', slug: 'ada', memberName: 'Ada Lovelace' },
    ]);
  });

  it('checks the address as it is typed, says a taken one on its field, and won’t create with it', async () => {
    const fake = fakeData();
    await renderWelcome(fake.data, '/welcome?step=workspace');
    const address = page.getByRole('textbox', { name: 'Web address' });
    await address.fill('taken-one');
    await expect.element(address).toHaveAccessibleDescription('Taken');
    await expect.element(address).toHaveAttribute('aria-invalid', 'true');
    await page.getByRole('button', { name: 'Create workspace' }).click();
    // Refused before asking: focus goes back to the address, and nothing is made.
    await expect.element(address).toHaveFocus();
    expect(fake.created).toEqual([]);
    await address.fill('halcyon');
    await expect.element(address).toHaveAccessibleDescription('Available');
    // Each address was asked about once typing stopped, never a stale one after it.
    expect(fake.checked.at(-1)).toBe('halcyon');
  });

  it('moves a taken first choice to the next free address, and offers free ones to pick', async () => {
    const fake = fakeData(['ada', 'taken-one']);
    await renderWelcome(fake.data, '/welcome?step=workspace');
    const address = page.getByRole('textbox', { name: 'Web address' });
    // ada is taken, so the address is the company's, with two more free ones under it.
    await expect.element(address).toHaveValue('acme');
    const offered = page.getByRole('group', { name: 'Free addresses' });
    await expect.element(offered.getByRole('button', { name: 'adas-workspace' })).toBeVisible();
    await offered.getByRole('button', { name: 'ada-team' }).click();
    await expect.element(address).toHaveValue('ada-team');
    await expect.element(address).toHaveFocus();
    await expect.element(address).toHaveAccessibleDescription('Available');
    // A taken one typed offers free ones too.
    await address.fill('taken-one');
    await expect.element(address).toHaveAccessibleDescription('Taken');
    await expect.element(offered.getByRole('button', { name: 'acme' })).toBeVisible();
  });

  it('makes the workspace with no questionnaire answers, then invites a row per person and goes on', async () => {
    // A draft from before the questionnaire was taken out still opens; its answers are no longer sent.
    sessionStorage.setItem(
      'crm.welcome.draft',
      JSON.stringify({ userId: USER.id, workspaceId: WORKSPACE_ID, answers: { role: 'sales', areas: ['booking'] } }),
    );
    const fake = fakeData();
    const router = await renderWelcome(fake.data, '/welcome?step=workspace');
    await expect.element(page.getByText('Available', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Create workspace' }).click();
    await expect.element(page.getByRole('heading', { level: 1, name: 'Invite your team' })).toBeVisible();
    expect(fake.created[0]).not.toHaveProperty('onboarding');
    expect(router.state.location.search).toEqual({ step: 'invite', workspace: 'ada' });
    await expect.element(page.getByText('Step 3 of 4')).toBeVisible();
    expect(page.getByRole('button', { name: 'Back' }).query()).toBeNull();
    // No roles read: no role column, everyone joins as a member.
    expect(page.getByRole('button', { name: /^Role for/ }).query()).toBeNull();
    // Nothing typed: said above the rows, focus on the first.
    await page.getByRole('button', { name: 'Send invites' }).click();
    await expect.element(page.getByText('Add an email address, or skip this step.')).toBeVisible();
    await expect.element(page.getByRole('textbox', { name: 'Email' })).toHaveFocus();
    // A pasted list splits into rows; the plus and Enter add more.
    await page.getByRole('textbox', { name: 'Email' }).fill('ADA@acme.com, grace@acme.com');
    await expect.element(page.getByRole('textbox', { name: 'Email 2' })).toHaveValue('grace@acme.com');
    await page.getByRole('button', { name: 'Add another person' }).click();
    await expect.element(page.getByRole('textbox', { name: 'Email 3' })).toHaveFocus();
    await page.getByRole('textbox', { name: 'Email 3' }).fill('bob@acme.com');
    await page.getByRole('button', { name: 'Send invites' }).click();
    await expect.element(page.getByText('2 invites sent.')).toBeVisible();
    await expect.element(page.getByText(/Already in the workspace: grace@acme.com/)).toBeVisible();
    expect(fake.invites).toEqual([
      { workspace: 'ada', emails: ['ada@acme.com', 'grace@acme.com', 'bob@acme.com'], role: 'member' },
    ]);
    await expect.element(page.getByRole('button', { name: 'Continue' })).toHaveFocus();
    await page.getByRole('button', { name: 'Continue' }).click();

    await expect.element(page.getByRole('heading', { level: 1, name: 'Connect your calendar' })).toBeVisible();
    expect(router.state.location.search).toEqual({ step: 'calendar', workspace: 'ada' });
    await expect.element(page.getByText('Step 4 of 4')).toBeVisible();
    // The workspace exists: no going back to it.
    expect(page.getByRole('button', { name: 'Back' }).query()).toBeNull();
    await expect.element(page.getByRole('button', { name: 'Connect Google Calendar' })).toHaveFocus();
    await expect.element(page.getByRole('button', { name: 'Connect Outlook' })).toBeDisabled();
    await page.getByRole('button', { name: 'Skip for now' }).click();
    await expect.poll(() => router.state.location.pathname).toBe('/w/ada');
  });

  it('offers the roles the maker may invite as, each row starting as Member, one call per role', async () => {
    const fake = fakeData();
    const roles = [
      { id: 'r-admin', label: 'Admin', description: 'Manages people and settings.', builtIn: 'admin' as const },
      { id: 'r-member', label: 'Member', description: 'Works with records.', builtIn: 'member' as const },
    ];
    await renderWelcome(fake.data, '/welcome?step=invite&workspace=ada', true, { roles, defaultRole: 'r-member' });
    await page.getByRole('textbox', { name: 'Email' }).fill('ada@acme.com');
    await expect.element(page.getByRole('button', { name: /Role for ada@acme.com/ })).toHaveTextContent('Member');
    await page.getByRole('textbox', { name: 'Email' }).click();
    await userEvent.keyboard('{Enter}');
    await expect.element(page.getByRole('textbox', { name: 'Email 2' })).toHaveFocus();
    await page.getByRole('textbox', { name: 'Email 2' }).fill('bob@acme.com');
    await page.getByRole('button', { name: /Role for bob@acme.com/ }).click();
    await page.getByRole('option', { name: 'Admin' }).click();
    await page.getByRole('button', { name: 'Send invites' }).click();
    await expect.element(page.getByText('2 invites sent.')).toBeVisible();
    expect(fake.invites).toEqual([
      { workspace: 'ada', emails: ['bob@acme.com'], role: 'admin' },
      { workspace: 'ada', emails: ['ada@acme.com'], role: 'member' },
    ]);
  });

  it('says a connected calendar came back, and Continue opens the workspace', async () => {
    const fake = fakeData();
    const router = await renderWelcome(fake.data, '/welcome?step=calendar&workspace=acme&calendar=connected');
    await expect.element(page.getByText('Google Calendar is connected.')).toBeVisible();
    await page.getByRole('button', { name: 'Continue' }).click();
    await expect.poll(() => router.state.location.pathname).toBe('/w/acme');
  });
});

describe('Sign out on first run', () => {
  it('asks first, and Cancel signs nobody out', async () => {
    const fake = fakeData();
    await renderWelcome(fake.data);
    await expect.element(page.getByText('Signed in as ada.lovelace@acme.com')).toBeVisible();
    await page.getByRole('button', { name: 'Sign out' }).click();
    const dialog = page.getByRole('dialog', { name: 'Sign out?' });
    await expect.element(dialog).toBeVisible();
    expect(dialog.element().textContent).toContain('You’ll need to sign in again on this device.');
    await dialog.getByRole('button', { name: 'Cancel' }).click();
    await expect.element(dialog).not.toBeInTheDocument();
    expect(fake.signOuts()).toBe(0);
  });

  it('signs out once on Sign out, busy while it runs, then opens sign in', async () => {
    const fake = fakeData();
    const router = await renderWelcome(fake.data);
    await page.getByRole('button', { name: 'Sign out' }).click();
    const dialog = page.getByRole('dialog', { name: 'Sign out?' });
    const commit = dialog.getByRole('button', { name: /Sign(ing)? out/ });
    await commit.click();
    await expect.element(dialog.getByRole('button', { name: 'Signing out' })).toBeVisible();
    await commit.click({ force: true });
    expect(fake.signOuts()).toBe(1);
    await act(async () => {
      fake.release();
      await new Promise((resolve) => setTimeout(resolve, 50));
    });
    expect(router.state.location.pathname).toBe('/sign-in');
  });
});
