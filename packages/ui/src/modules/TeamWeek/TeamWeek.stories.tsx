import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, userEvent, waitFor, within } from 'storybook/test';
import { Button } from '../../atoms/Button/Button.tsx';
import { EmptyState } from '../../molecules/EmptyState/EmptyState.tsx';
import { Stage } from '../../workbench/Stage/Stage.tsx';
import { settleAnimations } from '../../workbench/animations.ts';
import { TeamWeek, type TeamWeekCell, type TeamWeekPerson } from './TeamWeek.tsx';

const DAYS = [
  { id: 'mon', label: 'Mon 2', weekday: 'Mon', date: '2', long: 'Monday 2 November' },
  { id: 'tue', label: 'Tue 3', weekday: 'Tue', date: '3', long: 'Tuesday 3 November' },
  { id: 'wed', label: 'Wed 4', weekday: 'Wed', date: '4', long: 'Wednesday 4 November', isToday: true },
  { id: 'thu', label: 'Thu 5', weekday: 'Thu', date: '5', long: 'Thursday 5 November' },
  { id: 'fri', label: 'Fri 6', weekday: 'Fri', date: '6', long: 'Friday 6 November' },
  { id: 'sat', label: 'Sat 7', weekday: 'Sat', date: '7', long: 'Saturday 7 November', isQuiet: true },
  { id: 'sun', label: 'Sun 8', weekday: 'Sun', date: '8', long: 'Sunday 8 November', isQuiet: true },
];

const legend = {
  items: [
    { tone: 'usual' as const, label: 'Usual hours' },
    { tone: 'override' as const, label: 'Changed for this date' },
    { tone: 'off' as const, label: 'Off' },
    { tone: 'away' as const, label: 'Away' },
  ],
  hint: 'Select a day to change that date only. Usual hours repeat every week.',
};

const NINE = '9:00 AM – 5:00 PM';

function cell(name: string, day: number, tone: TeamWeekCell['tone'], lines: readonly string[]): TeamWeekCell {
  const words = tone === 'override' ? `${lines.join(', ')}, this week only` : lines.join(', ');
  return { tone, lines, label: `${DAYS[day]?.long ?? ''}, ${name}: ${words}` };
}

function person(id: string, name: string, editable: boolean, cells: (day: number) => TeamWeekCell): TeamWeekPerson {
  return {
    id,
    name,
    meta: '38 h',
    cells: DAYS.map((_, day) => cells(day)),
    isEditable: editable,
  };
}

const usual = (name: string) => (day: number) =>
  day < 5 ? cell(name, day, 'usual', [NINE]) : cell(name, day, 'off', ['Off']);

/** Built in a function, so the artifact's preview carries no rows at module level. */
function people(): TeamWeekPerson[] {
  return [
    person('0193a1b2-0000-7000-8000-000000000001', 'Ada Lovelace', true, usual('Ada Lovelace')),
    {
      ...person('0193a1b2-0000-7000-8000-000000000002', 'Grace Hopper', true, (day) =>
        day === 1
          ? cell('Grace Hopper', day, 'override', ['10:00 AM – 2:00 PM'])
          : day === 3
            ? cell('Grace Hopper', day, 'override', ['9:00 AM – 12:00 PM', '1:00 PM – 6:00 PM'])
            : usual('Grace Hopper')(day),
      ),
      badge: 'UTC+5:30',
    },
    person('0193a1b2-0000-7000-8000-000000000003', 'Linus Pauling', false, (day) =>
      day === 2 || day === 3 ? cell('Linus Pauling', day, 'away', ['Away', 'Vacation']) : usual('Linus Pauling')(day),
    ),
  ];
}

const footer = {
  label: 'Working',
  totals: DAYS.map((day, index) => ({
    value: index < 5 ? '3 people' : 'Nobody',
    detail: index < 5 ? '24 h' : '0 h',
    label: `${day.long}: ${index < 5 ? '3 people, 24 hours' : 'nobody'}`,
  })),
};

const meta = {
  title: 'Modules/TeamWeek',
  component: TeamWeek,
  args: {
    label: 'Team week, 2 to 8 November',
    days: DAYS,
    people: [],
  },
} satisfies Meta<typeof TeamWeek>;

export default meta;
type Story = StoryObj<typeof meta>;

/**
 * A week: usual hours, two changes for this week only (the dot), an offset, two days away joined as one band, today
 * marked, the weekend quiet, days off, the footer and the legend.
 */
export const Default: Story = {
  parameters: { crm: { preview: true } },
  render: (args) => (
    <Stage width="fill">
      <TeamWeek
        {...args}
        people={people()}
        footer={footer}
        legend={legend}
        editorLabel={(id, day) => `Hours for ${DAYS[day]?.long ?? ''}`}
        renderEditor={(_, __, close) => (
          <Button variant="primary" onPress={close}>
            Save
          </Button>
        )}
      />
    </Stage>
  ),
  play: async ({ canvas }) => {
    const grid = canvas.getByRole('grid', { name: 'Team week, 2 to 8 November' });
    await expect(grid).toBeInTheDocument();
    // An editable cell is a button named in full; a read only one is text.
    const tuesday = canvas.getByRole('button', {
      name: 'Tuesday 3 November, Grace Hopper: 10:00 AM – 2:00 PM, this week only',
    });
    await expect(tuesday).toBeInTheDocument();
    await expect(canvas.queryByRole('button', { name: /Linus Pauling/ })).not.toBeInTheDocument();
    // Today's column is named so; the legend says what each look means.
    await expect(canvas.getByRole('columnheader', { name: 'Wed 4, today' })).toBeInTheDocument();
    await expect(canvas.getByRole('list', { name: 'Key' })).toBeInTheDocument();
  },
};

/** Enter opens a cell's editor; Esc closes it back onto the cell. */
export const OpensByKeyboard: Story = {
  parameters: { crm: { screenshot: false } },
  render: Default.render,
  play: async ({ canvas }) => {
    // Tab enters the grid on Ada's row; the arrows move to her cell, then along her days.
    await userEvent.tab();
    await userEvent.keyboard('{ArrowRight}');
    await userEvent.keyboard('{ArrowRight}');
    const monday = canvas.getByRole('button', { name: `Monday 2 November, Ada Lovelace: ${NINE}` });
    await expect(monday).toHaveFocus();
    await userEvent.keyboard('{ArrowRight}');
    const next = canvas.getByRole('button', { name: `Tuesday 3 November, Ada Lovelace: ${NINE}` });
    await expect(next).toHaveFocus();
    await userEvent.keyboard('{Enter}');
    await settleAnimations();
    const editor = within(document.body).getByRole('dialog', { name: 'Hours for Tuesday 3 November' });
    await expect(editor).toBeVisible();
    await userEvent.keyboard('{Escape}');
    // The Popover's exit runs before focus goes back (paused animations wait at their first frame).
    await settleAnimations();
    await waitFor(() => expect(next).toHaveFocus());
  },
};

/** Read only: a week before this one, or someone the reader may only see. */
export const ReadOnly: Story = {
  render: (args) => (
    <Stage width="fill">
      <TeamWeek {...args} people={people().map((each) => ({ ...each, isEditable: false }))} footer={footer} />
    </Stage>
  ),
  play: async ({ canvas }) => {
    await expect(canvas.queryAllByRole('button')).toHaveLength(0);
  },
};

/** The footer with the workspace link's coverage under each day: how many of those working it can book. */
export const LinkCoverage: Story = {
  render: (args) => (
    <Stage width="fill">
      <TeamWeek
        {...args}
        people={people().map((each) => ({ ...each, isEditable: false }))}
        footer={{
          ...footer,
          totals: footer.totals.map((total, index) => ({
            ...total,
            extra: `Link: ${index < 5 ? String(2) : String(0)}`,
            label: `${total.label}, the workspace link can book ${index < 5 ? '2' : 'nobody'}`,
          })),
        }}
      />
    </Stage>
  ),
  play: async ({ canvas }) => {
    await expect(canvas.getAllByText('Link: 2')).toHaveLength(5);
  },
};

/** While the week loads. */
export const Loading: Story = {
  parameters: { crm: { screenshot: false } },
  render: (args) => (
    <Stage width="fill">
      <TeamWeek {...args} isLoading />
    </Stage>
  ),
};

/** Nobody matches a search. */
export const Empty: Story = {
  render: (args) => (
    <Stage width="fill">
      <TeamWeek {...args} emptyState={<EmptyState title="No one matches" />} />
    </Stage>
  ),
};

/** A phone: the week scrolls sideways in its own frame. */
export const Phone: Story = {
  render: (args) => (
    <Stage width="phone">
      <TeamWeek {...args} people={people()} footer={footer} legend={legend} />
    </Stage>
  ),
};
