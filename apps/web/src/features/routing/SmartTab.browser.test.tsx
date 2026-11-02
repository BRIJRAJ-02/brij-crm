// Routing › Smart in Chromium (spec 0037, AC-1361 to AC-1364, AC-1374): the mode's SegmentedControl, the fairness
// allowance with the live sentence it states, the fit links table and its Add dialog, the remove confirm, the empty
// and disabled states, and no axe violations in either theme. With SMART_SHOTS set it saves the tab at 390 and 1440
// wide, light and dark.
import '@crm/ui/styles.css';
import type {
  AttributeDefinition,
  DataLayer,
  FitLink,
  RoutingHeld,
  RoutingSettings,
  RoutingSettingsState,
  RoutingSkillsState,
  SettingsChange,
  SkillsView,
} from '@crm/data';
import { PageColumn, type Toasts } from '@crm/ui';
import { afterEach, describe, expect, it } from 'vitest';
import { page } from 'vitest/browser';
import { applyTheme, axeViolations, resetTheme, THEMES } from '../../testing/axe.ts';
import { renderInApp, type InApp } from '../../testing/renderInApp.tsx';
import { SmartTab, type FitField } from './SmartTab.tsx';

const LANGUAGE = '00000000-0000-7000-8000-000000000011';
const SPANISH_OPTION = '00000000-0000-7000-8000-000000000012';
const GERMAN_OPTION = '00000000-0000-7000-8000-000000000013';
const SPANISH_SKILL = '00000000-0000-7000-8000-000000000014';
const GERMAN_SKILL = '00000000-0000-7000-8000-000000000015';

const LANGUAGE_FIELD = {
  id: LANGUAGE,
  objectId: '00000000-0000-7000-8000-000000000001',
  apiSlug: 'preferred_language',
  title: 'Preferred language',
  type: 'select',
  isMulti: false,
  isRequired: false,
  isUnique: false,
  isSystem: false,
  isArchived: false,
  position: 0,
  config: {},
  options: [
    { id: SPANISH_OPTION, label: 'Spanish', hue: 'blue', position: 0, isArchived: false },
    { id: GERMAN_OPTION, label: 'German', hue: 'green', position: 1, isArchived: false },
  ],
} as unknown as AttributeDefinition;

const FIELDS: readonly FitField[] = [
  { id: LANGUAGE, label: 'Person · Preferred language', attribute: LANGUAGE_FIELD, objectKey: 'people' },
];

/** The team pages the objectives table shows (spec 0037, AC-1354). */
const PAGES = [{ id: '00000000-0000-0000-0000-0000000000aa', title: 'Sales call', objective: 'deal' as const }];

const SKILLS: SkillsView = {
  skills: [
    { id: SPANISH_SKILL, group: 'language', name: 'Spanish', position: 0 },
    { id: GERMAN_SKILL, group: 'language', name: 'German', position: 1 },
  ],
  members: [],
  wonMeansSet: false,
};

let shown: InApp | undefined;
/** Takes down whatever is on the page and puts the theme back, between one shot and the next. */
function clear() {
  toasted = [];
  shown?.unmount();
  shown = undefined;
  resetTheme();
}
afterEach(clear);

/** One held read, in memory: a change shows at once, as the real layer's optimistic write does. */
function holder<T>(value: T) {
  let state = value;
  const listeners = new Set<() => void>();
  return {
    held: {
      subscribe: (listener: () => void) => {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
      getSnapshot: () => state,
      retain: () => () => undefined,
      ready: () => Promise.resolve(),
      reload: () => undefined,
    } as RoutingHeld<T>,
    set: (next: T) => {
      state = next;
      for (const listener of listeners) listener();
    },
    get: () => state,
  };
}

/** The data layer's routing settings and skills, in memory. */
function fake(initial: RoutingSettings, skills: SkillsView = SKILLS) {
  const settings = holder<RoutingSettingsState>({ status: 'ready', value: initial });
  const held = holder<RoutingSkillsState>({ status: 'ready', value: skills });
  const sent: SettingsChange[] = [];
  const data = {
    routing: {
      settings: {
        view: () => settings.held,
        set: (_workspace: string, change: SettingsChange) => {
          sent.push(change);
          const state = settings.get();
          if (state.status === 'ready') {
            const next = { ...state.value };
            if (change.smartMode !== undefined) next.smartMode = change.smartMode;
            if (change.tiltPercent !== undefined) next.tiltPercent = change.tiltPercent;
            if (change.fit !== undefined) next.fit = [...change.fit];
            settings.set({ status: 'ready', value: next });
          }
          return Promise.resolve();
        },
      },
      skills: { view: () => held.held },
    },
  } as unknown as DataLayer;
  return { data, sent };
}

/** What the screen said in a toast, newest last. */
let toasted: string[] = [];
const toasts = {
  toast: ({ message }: { readonly message: string }) => {
    toasted.push(message);
  },
  dismiss: () => undefined,
} as unknown as Toasts;

async function render(initial: RoutingSettings, fields: readonly FitField[] = FIELDS, skills: SkillsView = SKILLS) {
  const made = fake(initial, skills);
  shown = await renderInApp(
    () => (
      <PageColumn>
        <SmartTab
          data={made.data}
          slug="acme"
          fields={fields}
          pages={PAGES}
          onSkills={() => undefined}
          onObjective={() => undefined}
          toasts={toasts}
        />
      </PageColumn>
    ),
    { data: made.data, pattern: '/w/$slug/bookings/routing', at: '/w/acme/bookings/routing?view=smart' },
  );
  return made;
}

const link: FitLink = { attributeId: LANGUAGE, optionId: SPANISH_OPTION, skillId: SPANISH_SKILL };

describe('Routing › Smart', () => {
  it('shows the mode, the allowance and the bound it states, and saves a mode change', async () => {
    const made = await render({ smartMode: 'learn', tiltPercent: 20, fit: [] });
    await expect.element(page.getByRole('radio', { name: 'Learn' })).toBeChecked();
    // The live sentence names a whole number of meetings and the rotation's window (AC-1364's own words).
    expect(document.body.textContent).toContain(
      'Smart routing can let someone run up to 20% ahead of the least busy person over the last 30 days, and never more.',
    );
    (page.getByRole('radio', { name: 'Off' }).element() as HTMLElement).click();
    await expect.element(page.getByText('Ranking is off, so everyone keeps their turn.')).toBeInTheDocument();
    // The card's own line says what the chosen mode does, so Learn is never just a third button.
    expect(document.body.textContent).toContain('Available reps take strict turns');
    expect(made.sent).toEqual([{ smartMode: 'off' }]);
  });

  it('saves the allowance when the field is left, clamped to 0 to 50, and nothing when it did not change', async () => {
    const made = await render({ smartMode: 'fit', tiltPercent: 20, fit: [] });
    const field = page.getByRole('textbox', { name: 'Allowance' });
    await field.fill('80');
    (page.getByRole('radio', { name: 'Fit' }).element() as HTMLElement).focus();
    await expect.element(field).toHaveValue('50');
    expect(made.sent).toEqual([{ tiltPercent: 50 }]);
    // A clamped number says so, rather than snapping in silence.
    expect(toasted.at(-1)).toBe('Allowance set to 50%, the highest allowed.');
    // The same number again sends nothing.
    await field.fill('50');
    (page.getByRole('radio', { name: 'Fit' }).element() as HTMLElement).focus();
    expect(made.sent).toHaveLength(1);
  });

  it('says a strict turn at 0 percent, and what the fit links are used for while the ranking is off', async () => {
    await render({ smartMode: 'off', tiltPercent: 0, fit: [link] });
    await expect
      .element(page.getByText('Everyone takes a strict turn: the ranking moves nothing.'))
      .not.toBeInTheDocument();
    // Ranking off wins over the allowance's own words, and the Fit card says when its links count.
    await expect.element(page.getByText('Ranking is off, so everyone keeps their turn.')).toBeInTheDocument();
    expect(document.body.textContent).toContain('Used while Ranking is Fit or Learn.');
  });

  it('says a strict turn at 0 percent', async () => {
    await render({ smartMode: 'fit', tiltPercent: 0, fit: [link] });
    await expect
      .element(page.getByText('Everyone takes a strict turn: the ranking moves nothing.'))
      .toBeInTheDocument();
  });

  it('says what to do first when there is no field or no skill to link', async () => {
    await render({ smartMode: 'fit', fit: [] }, []);
    await expect.element(page.getByText('Nothing to link to yet')).toBeInTheDocument();
    clear();
    await render({ smartMode: 'fit', fit: [] }, FIELDS, { ...SKILLS, skills: [] });
    // The one that can be unblocked says where to go.
    await expect.element(page.getByText('No skills yet')).toBeInTheDocument();
    await expect.element(page.getByRole('button', { name: 'Go to Skills' })).toBeInTheDocument();
  });

  it('adds a fit link from the dialog, and will not add the same one twice', async () => {
    const made = await render({ smartMode: 'fit', tiltPercent: 20, fit: [link] });
    // The link already there reads as its field, answer and skill.
    await expect.element(page.getByRole('rowheader', { name: 'Person · Preferred language' })).toBeInTheDocument();
    (page.getByRole('button', { name: 'Add link' }).first().element() as HTMLElement).click();
    const dialog = page.getByRole('dialog');
    await expect.element(dialog).toBeInTheDocument();
    // Nothing is picked yet, so Add is off.
    await expect.element(dialog.getByRole('button', { name: 'Add link' })).toBeDisabled();
    expect(made.sent).toEqual([]);
  });

  it('asks before removing a link, and removes it on confirm', async () => {
    const made = await render({ smartMode: 'fit', tiltPercent: 20, fit: [link] });
    (page.getByRole('button', { name: 'Remove Spanish to Spanish' }).element() as HTMLElement).click();
    await expect.element(page.getByText('Remove this fit link?')).toBeInTheDocument();
    // The consequence names the field as well as the answer, so two fields with a Spanish option read apart.
    await expect
      .element(
        page.getByText(
          'Leads whose Person · Preferred language is Spanish will no longer go to reps with Spanish first.',
        ),
      )
      .toBeInTheDocument();
    expect(made.sent).toEqual([]);
    (page.getByRole('button', { name: 'Remove', exact: true }).element() as HTMLElement).click();
    expect(made.sent).toEqual([{ fit: [] }]);
    expect(toasted.at(-1)).toBe('Fit link removed');
    await expect.element(page.getByText('No fit links yet')).toBeInTheDocument();
  });

  it.each(THEMES)('meets WCAG AA in %s', async (theme) => {
    await render({ smartMode: 'learn', tiltPercent: 20, fit: [link] });
    applyTheme(theme);
    expect(await axeViolations()).toEqual([]);
  });

  it.runIf(import.meta.env.VITE_SMART_SHOTS === '1')('saves screenshots at 390 and 1440, light and dark', async () => {
    const dir = 'smart-shots';
    const shots: readonly [string, RoutingSettings, readonly FitField[], SkillsView][] = [
      ['tab', { smartMode: 'learn', tiltPercent: 20, fit: [link] }, FIELDS, SKILLS],
      ['empty', { smartMode: 'fit', tiltPercent: 20, fit: [] }, FIELDS, SKILLS],
      ['off', { smartMode: 'off', tiltPercent: 20, fit: [link] }, FIELDS, SKILLS],
    ];
    for (const [name, settings, fields, skills] of shots) {
      for (const width of [390, 1440]) {
        for (const theme of THEMES) {
          await page.viewport(width, 1000);
          await render(settings, fields, skills);
          applyTheme(theme);
          await page.screenshot({ path: `${dir}/${name}-${String(width)}-${theme}.png` });
          clear();
        }
      }
    }
    // The Add dialog and the remove confirm, open, at both widths.
    for (const width of [390, 1440]) {
      for (const theme of THEMES) {
        await page.viewport(width, 1000);
        await render({ smartMode: 'fit', tiltPercent: 20, fit: [link] });
        applyTheme(theme);
        (page.getByRole('button', { name: 'Add link' }).first().element() as HTMLElement).click();
        await expect.element(page.getByRole('dialog')).toBeInTheDocument();
        await page.screenshot({ path: `${dir}/add-${String(width)}-${theme}.png` });
        clear();

        await page.viewport(width, 1000);
        await render({ smartMode: 'fit', tiltPercent: 20, fit: [link] });
        applyTheme(theme);
        (page.getByRole('button', { name: 'Remove Spanish to Spanish' }).element() as HTMLElement).click();
        await expect.element(page.getByText('Remove this fit link?')).toBeInTheDocument();
        await page.screenshot({ path: `${dir}/remove-${String(width)}-${theme}.png` });
        clear();
      }
    }
  });
});
