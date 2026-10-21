import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState } from 'react';
import { expect, userEvent, waitFor, within } from 'storybook/test';
import { Button } from '../../atoms/Button/Button.tsx';
import { Stage } from '../../workbench/Stage/Stage.tsx';
import { CalendarList } from '../CalendarList/CalendarList.tsx';
import { AsideLayout } from './AsideLayout.tsx';

const noop = () => undefined;

function Aside() {
  return (
    <CalendarList
      accounts={[
        {
          id: 'google',
          provider: 'google-calendar',
          email: 'ada@acme.dev',
          calendars: [
            { id: 'ada', name: 'Ada Lovelace', hue: 'blue', isShown: true, isDefault: true, canBeDefault: true },
            { id: 'team', name: 'Team', hue: 'green', isShown: true, isDefault: false, canBeDefault: true },
          ],
        },
      ]}
      onShownChange={noop}
      onShowOnly={noop}
      onShowAll={noop}
    />
  );
}

/** The layout with its toggle: folds the column when wide, opens the sheet when narrow. */
function Sample({ initiallyOpen }: { readonly initiallyOpen: boolean }) {
  const [isWideOpen, setWideOpen] = useState(initiallyOpen);
  const [isSheetOpen, setSheetOpen] = useState(false);
  const [isNarrow, setNarrow] = useState(false);
  return (
    <>
      <Button
        icon={!isNarrow && isWideOpen ? 'panel-left-close' : 'panel-left-open'}
        onPress={() => (isNarrow ? setSheetOpen(true) : setWideOpen((was) => !was))}
      >
        Calendars
      </Button>
      <AsideLayout
        aside={<Aside />}
        asideLabel="Calendars"
        isAsideOpen={isNarrow ? isSheetOpen : isWideOpen}
        onAsideClose={() => setSheetOpen(false)}
        onNarrowChange={setNarrow}
      >
        <div>Main column</div>
      </AsideLayout>
    </>
  );
}

const meta = {
  title: 'Modules/AsideLayout',
  component: AsideLayout,
  args: { aside: null, asideLabel: 'Calendars', isAsideOpen: true, onAsideClose: noop, children: null },
} satisfies Meta<typeof AsideLayout>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Wide: the calendars beside the main column, folded by the toggle. */
export const Beside: Story = {
  parameters: { crm: { screenshot: false } },
  render: () => (
    <Stage width="fill">
      <Sample initiallyOpen />
    </Stage>
  ),
  play: async ({ canvas }) => {
    await expect(canvas.getByRole('complementary', { name: 'Calendars' })).toBeInTheDocument();
    await userEvent.click(canvas.getByRole('button', { name: 'Calendars' }));
    await waitFor(() => expect(canvas.queryByRole('complementary', { name: 'Calendars' })).not.toBeInTheDocument());
  },
};

/** Narrow: no column; the toggle opens the calendars as a sheet. */
export const Sheet: Story = {
  parameters: { crm: { screenshot: false } },
  render: () => (
    <Stage width="phone">
      <Sample initiallyOpen />
    </Stage>
  ),
  play: async ({ canvas, canvasElement }) => {
    await waitFor(() => expect(canvas.queryByRole('complementary', { name: 'Calendars' })).not.toBeInTheDocument());
    await userEvent.click(canvas.getByRole('button', { name: 'Calendars' }));
    const body = within(canvasElement.ownerDocument.body);
    await waitFor(() => expect(body.getByRole('checkbox', { name: 'Team' })).toBeInTheDocument());
  },
};
