import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState } from 'react';
import { expect, fn } from 'storybook/test';
import { hoverFresh, shownTooltip } from '../../workbench/pointer.ts';
import { Stage } from '../../workbench/Stage/Stage.tsx';
import { fakeThemeController } from '../../workbench/theme.ts';
import { SegmentedControl, ThemeSwitch } from './SegmentedControl.tsx';

const meta = {
  title: 'Molecules/SegmentedControl',
  component: SegmentedControl,
  args: {
    label: 'View',
    segments: [
      { value: 'table', label: 'Table', icon: 'list-checks' },
      { value: 'board', label: 'Board', icon: 'kanban' },
    ],
    defaultValue: 'table',
    onChange: fn(),
  },
} satisfies Meta<typeof SegmentedControl>;

export default meta;
type Story = StoryObj<typeof meta>;

/** The arrow keys move the choice and tell the caller. */
export const Default: Story = {
  parameters: { crm: { preview: true } },
  render: (args) => (
    <Stage direction="column">
      <SegmentedControl {...args} />
      <SegmentedControl
        label="Period"
        defaultValue="week"
        segments={[
          { value: 'day', label: 'Day' },
          { value: 'week', label: 'Week' },
          { value: 'month', label: 'Month' },
          { value: 'year', label: 'Year' },
        ]}
      />
    </Stage>
  ),
  play: async ({ canvas, canvasElement, args, userEvent }) => {
    // The chosen segment's thumb covers the segment, so focus turns the thumb's own edge accent.
    const thumb = canvasElement.querySelector('[class*="thumb"]');
    const resting = thumb === null ? '' : getComputedStyle(thumb).borderColor;
    await userEvent.tab();
    await expect(canvas.getByRole('radio', { name: 'Table' })).toHaveFocus();
    await expect(thumb === null ? '' : getComputedStyle(thumb).borderColor).not.toBe(resting);
    await userEvent.keyboard('{ArrowRight}');
    await expect(canvas.getByRole('radio', { name: 'Board' })).toBeChecked();
    await expect(args.onChange).toHaveBeenCalledWith('board');
  },
};

function Themes() {
  const [controller] = useState(fakeThemeController);
  return (
    <Stage direction="column">
      <ThemeSwitch controller={controller} />
      <ThemeSwitch controller={controller} isCompact />
    </Stage>
  );
}

/** ThemeSwitch, full and compact, on one controller: choosing in one moves the other. */
export const Theme: Story = {
  render: () => <Themes />,
  play: async ({ canvas, userEvent }) => {
    const [full] = canvas.getAllByRole('radiogroup', { name: 'Theme' });
    await expect(full).toBeDefined();
    await userEvent.click(canvas.getAllByRole('radio', { name: 'Dark' })[0] as HTMLElement);
    for (const dark of canvas.getAllByRole('radio', { name: 'Dark' })) await expect(dark).toBeChecked();
  },
};

function VerticalTheme() {
  const [controller] = useState(fakeThemeController);
  return (
    <Stage>
      <ThemeSwitch controller={controller} isCompact orientation="vertical" />
    </Stage>
  );
}

/**
 * Vertical, icons only: the theme switch in the folded sidebar's rail, where
 * the row doesn't fit. The up and down arrows move the choice.
 */
export const ThemeVertical: Story = {
  render: () => <VerticalTheme />,
  play: async ({ canvas, userEvent }) => {
    const group = canvas.getByRole('radiogroup', { name: 'Theme' });
    await expect(group).toHaveAttribute('aria-orientation', 'vertical');
    const [light, dark, system] = ['Light', 'Dark', 'System'].map((name) => canvas.getByRole('radio', { name }));
    if (light === undefined || dark === undefined || system === undefined) throw new Error('a theme is missing');
    // Stacked, and as narrow as the rail allows.
    await expect(dark.getBoundingClientRect().top).toBeGreaterThan(light.getBoundingClientRect().top);
    await expect(group.getBoundingClientRect().width).toBeLessThanOrEqual(32);
    // Each stacked segment is still a touch sized target (WCAG 2.5.8, 24 px or more).
    for (const radio of [light, dark, system]) {
      // The radio is a hidden input; the segment is the label around it.
      const segment = radio.closest('label');
      if (segment === null) throw new Error('a segment is missing');
      const box = segment.getBoundingClientRect();
      await expect(box.width).toBeGreaterThanOrEqual(24);
      await expect(box.height).toBeGreaterThanOrEqual(24);
    }
    await userEvent.click(system);
    await expect(system).toBeChecked();
    await userEvent.keyboard('{ArrowUp}');
    await expect(dark).toBeChecked();
    // An icon alone names itself on hover.
    const icon = light.closest('label')?.querySelector('svg')?.parentElement;
    if (icon === null || icon === undefined) throw new Error('the Light icon is missing');
    await hoverFresh(userEvent, icon);
    await expect(await shownTooltip()).toHaveTextContent('Light');
  },
};

/** Disabled. */
export const Disabled: Story = {
  args: { isDisabled: true },
};

/** A saved choice a viewer can read but not change: the chosen segment stays at full contrast. */
export const ReadOnly: Story = {
  args: { isReadOnly: true },
};

/**
 * `size="compact"`: exactly a button's height, for a bar (the view bar's Table and Board). With
 * `isLabelCollapsible`, a phone shows the icons alone, each segment keeping its name.
 */
export const CompactAndCollapsible: Story = {
  render: (args) => (
    <Stage direction="column">
      <SegmentedControl {...args} size="compact" isLabelCollapsible />
      <Stage width="phone">
        <SegmentedControl {...args} label="Phone layout" size="compact" isLabelCollapsible />
      </Stage>
    </Stage>
  ),
  play: async ({ canvas, userEvent }) => {
    const wide = canvas.getByRole('radiogroup', { name: 'View' });
    const narrow = canvas.getByRole('radiogroup', { name: 'Phone layout' });
    await expect(narrow.getBoundingClientRect().width).toBeLessThan(wide.getBoundingClientRect().width);
    await expect(canvas.getAllByRole('radio', { name: 'Board' })).toHaveLength(2);
    await userEvent.click(canvas.getAllByRole('radio', { name: 'Board' })[1] ?? narrow);
    await expect(canvas.getAllByRole('radio', { name: 'Board' })[1]).toBeChecked();
  },
};

/** Colour dots (`hue`): Bookings' week picks one calendar, each in its colour; the arrow keys still choose. */
export const ColourDots: Story = {
  args: {
    label: 'Calendars',
    size: 'compact',
    defaultValue: 'all',
    segments: [
      { value: 'all', label: 'All calendars' },
      { value: 'bookings', label: 'Bookings' },
      { value: 'work', label: 'Work', hue: 'green' },
      { value: 'home', label: 'Home', hue: 'purple' },
      { value: 'long', label: 'grace.hopper@example.com', hue: 'orange' },
    ],
  },
  play: async ({ canvas, userEvent, args }) => {
    const all = canvas.getByRole('radio', { name: 'All calendars' });
    await expect(all).toBeChecked();
    await userEvent.click(all);
    await userEvent.keyboard('{ArrowRight}');
    await expect(canvas.getByRole('radio', { name: 'Bookings' })).toBeChecked();
    await expect(args.onChange).toHaveBeenLastCalledWith('bookings');
  },
};

/** Colour dots, disabled and read only: the dotted segments dim and hold like the plain ones. */
export const ColourDotsStates: Story = {
  args: { ...ColourDots.args },
  render: (args) => (
    <Stage direction="column">
      <SegmentedControl {...args} label="Disabled" isDisabled />
      <SegmentedControl {...args} label="Read only" isReadOnly />
    </Stage>
  ),
};

/**
 * `isLabelVisible` with `size="compact"`: a short value picked inside a form, its label shown above the track as a
 * Field's, and the group named by it.
 */
export const VisibleLabel: Story = {
  args: {
    label: 'Duration',
    size: 'compact',
    isLabelVisible: true,
    defaultValue: '30',
    segments: [
      { value: '15', label: '15 min' },
      { value: '30', label: '30 min' },
      { value: '45', label: '45 min' },
      { value: '60', label: '60 min' },
      { value: 'custom', label: 'Custom' },
    ],
  },
  play: async ({ canvas, args, userEvent }) => {
    const group = canvas.getByRole('radiogroup', { name: 'Duration' });
    await expect(group).toBeVisible();
    await userEvent.click(canvas.getByRole('radio', { name: 'Custom' }));
    await expect(args.onChange).toHaveBeenCalledWith('custom');
  },
};

/** `isLabelVisible`, disabled: the label dims with the track. */
export const VisibleLabelDisabled: Story = {
  args: { ...VisibleLabel.args, isDisabled: true },
};
