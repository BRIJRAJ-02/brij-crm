import type { Meta, StoryObj } from '@storybook/react-vite';
import { Menu, MenuItem } from '../../molecules/Menu/Menu.tsx';
import { expect, fn, waitFor } from 'storybook/test';
import { hoverFresh, hoverUntilHovered, shownTooltip } from '../../workbench/pointer.ts';
import { Stage } from '../../workbench/Stage/Stage.tsx';
import { Button, ButtonGroup, ButtonLink, ToggleButton } from './Button.tsx';
import { SplitButton } from './SplitButton.tsx';

const meta = {
  title: 'Atoms/Button',
  component: Button,
  args: { children: 'View settings', icon: 'settings', onPress: fn() },
} satisfies Meta<typeof Button>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Secondary, the default: view controls, Import / Export, Cancel. */
export const Default: Story = {};

/** Links drawn as buttons: an action that goes somewhere, in a new tab or as a download. */
export const Links: Story = {
  render: () => (
    <Stage>
      <ButtonLink variant="primary" icon="video" href="https://meet.google.com/abc-defg-hij" isExternal>
        Join the call
      </ButtonLink>
      <ButtonLink provider="google" href="https://calendar.google.com/calendar/render" isExternal>
        Google
      </ButtonLink>
      <ButtonLink icon="download" href="/booking.ics" download="booking.ics">
        Apple / .ics
      </ButtonLink>
      <ButtonLink href="javascript:alert(1)">Unsafe</ButtonLink>
    </Stage>
  ),
  play: async ({ canvas }) => {
    const join = canvas.getByRole('link', { name: 'Join the call' });
    await expect(join).toHaveAttribute('target', '_blank');
    await expect(canvas.getByRole('link', { name: 'Apple / .ics' })).toHaveAttribute('download', 'booking.ics');
    await expect(canvas.getByRole('link', { name: 'Unsafe' })).not.toHaveAttribute('href');
  },
};

/** The variants. One primary per surface, on the action that commits; `danger-solid` takes its place in a destructive confirm. */
export const Variants: Story = {
  parameters: { crm: { preview: true } },
  render: () => (
    <Stage>
      <Button icon="settings">View settings</Button>
      <Button icon="download" iconRight="chevron-down">
        Import / Export
      </Button>
      <Button variant="dashed" icon="list-filter">
        Filter
      </Button>
      <Button variant="ghost">Discard changes</Button>
      <Button variant="link">Sign out</Button>
      <Button variant="ghost-danger" icon="trash" label="Delete" />
      <Button variant="danger" icon="trash">
        Delete record
      </Button>
      <Button variant="danger-solid" icon="trash">
        Delete 3 records
      </Button>
      <Button variant="primary" kbd="⌘↵">
        Add to list
      </Button>
    </Stage>
  ),
};

/** Keycaps after the label: soft on secondary buttons, edged on the primary. Screen readers hear the label, and the shortcut as a shortcut. */
export const WithShortcut: Story = {
  render: () => (
    <Stage>
      <Button kbd="ESC">Cancel</Button>
      <Button variant="primary" kbd="⌘↵">
        Add to list
      </Button>
    </Stage>
  ),
  play: async ({ canvas }) => {
    const cancel = canvas.getByRole('button', { name: 'Cancel' });
    await expect(cancel).toHaveAttribute('aria-keyshortcuts', 'Escape');
    await expect(canvas.getByRole('button', { name: 'Add to list' })).toHaveAttribute(
      'aria-keyshortcuts',
      'Meta+Enter',
    );
  },
};

/** An icon only button: `label` gives its accessible name. */
export const IconOnly: Story = {
  args: { children: undefined, icon: 'ellipsis', label: 'More actions' },
  play: async ({ canvas }) => {
    await expect(canvas.getByRole('button', { name: 'More actions' })).toHaveAttribute('data-icon-only', 'true');
  },
};

/**
 * `isLabelCollapsible`: the words show in a wide bar, and in a narrow one (a phone) the icon stands alone, square,
 * its `label` still its name.
 */
export const LabelCollapsible: Story = {
  render: () => (
    <Stage direction="column">
      <Button icon="settings" label="View settings" isLabelCollapsible>
        View settings
      </Button>
      <Stage width="phone">
        <Button icon="settings" label="View settings" isLabelCollapsible>
          View settings
        </Button>
      </Stage>
    </Stage>
  ),
  play: async ({ canvas }) => {
    const [wide, narrow] = canvas.getAllByRole('button', { name: 'View settings' });
    await expect(wide).toHaveTextContent('View settings');
    await expect(narrow?.getBoundingClientRect().width).toBeLessThan(40);
  },
};

/** `lg` matches a 30px input beside it. */
export const Large: Story = {
  render: () => (
    <Stage>
      <Button size="lg" icon="plus">
        New record
      </Button>
      <Button size="lg" icon="ellipsis" label="More actions" />
    </Stage>
  ),
};

/** `xl` is a page's own call to action outside the app: the marketing site's hero and footer (36px). */
export const ExtraLarge: Story = {
  render: () => (
    <Stage>
      <ButtonLink size="xl" variant="primary" href="https://app.timefix.ai/sign-in" iconRight="arrow-right">
        Get started
      </ButtonLink>
      <ButtonLink size="xl" href="https://app.timefix.ai/">
        Open dashboard
      </ButtonLink>
    </Stage>
  ),
  play: async ({ canvas }) => {
    const link = canvas.getByRole('link', { name: 'Get started' });
    await expect(Math.round(link.getBoundingClientRect().height)).toBe(36);
  },
};

/** `lg` is drawn at 30px and pressed at 32: an invisible pixel past its border all round. */
export const LargeHitArea: Story = {
  parameters: { crm: { screenshot: false } },
  render: () => (
    <Stage>
      <Button size="lg" variant="ghost" icon="ellipsis" label="More for Intro call" />
    </Stage>
  ),
  play: async ({ canvas }) => {
    const button = canvas.getByRole('button', { name: 'More for Intro call' });
    const box = button.getBoundingClientRect();
    await expect(Math.round(box.height)).toBe(30);
    const middle = { x: box.left + box.width / 2, y: box.top + box.height / 2 };
    // Half a pixel outside what is drawn, on each side, still lands on the button.
    for (const [x, y] of [
      [middle.x, box.top - 0.5],
      [middle.x, box.bottom + 0.5],
      [box.left - 0.5, middle.y],
      [box.right + 0.5, middle.y],
    ] as const) {
      await expect(button.contains(document.elementFromPoint(x, y))).toBe(true);
    }
    // Past 32px it doesn't.
    await expect(button.contains(document.elementFromPoint(middle.x, box.top - 2))).toBe(false);
  },
};

/** `sm` is a chip's 20px: an icon only Remove beside a chip inside a field's box. */
export const Small: Story = {
  render: () => (
    <Stage>
      <Button size="sm" variant="ghost" icon="x" label="Remove Ada Lovelace" />
    </Stage>
  ),
  play: async ({ canvas }) => {
    const button = canvas.getByRole('button', { name: 'Remove Ada Lovelace' });
    await expect(Math.round(button.getBoundingClientRect().height)).toBe(20);
  },
};

/**
 * Filling the row. `isFullWidth` puts the label at the start and the keycaps
 * at the end (the sidebar's Quick actions); `isFullWidth="center"` keeps the
 * label in the middle, for a form's submit and the ways to go on under it.
 */
export const FullWidth: Story = {
  render: () => (
    <Stage direction="column" width="narrow">
      <Button size="lg" icon="search" isFullWidth kbd="⌘K">
        Quick actions
      </Button>
      <Button variant="primary" size="lg" isFullWidth="center">
        Continue
      </Button>
      <Button size="lg" isFullWidth="center">
        Continue with Google
      </Button>
    </Stage>
  ),
  play: async ({ canvas }) => {
    const quick = canvas.getByRole('button', { name: 'Quick actions' });
    const submit = canvas.getByRole('button', { name: 'Continue' });
    await expect(quick).toHaveAttribute('data-full-width', 'start');
    await expect(submit).toHaveAttribute('data-full-width', 'center');
    await expect(getComputedStyle(submit).justifyContent).toBe('center');
    await expect(submit.getBoundingClientRect().width).toBe(quick.getBoundingClientRect().width);
  },
};

/** Disabled: at half opacity, skipped by Tab, and never pressed. */
export const Disabled: Story = {
  parameters: { crm: { preview: true } },
  render: (args) => (
    <Stage>
      <Button isDisabled onPress={args.onPress}>
        Cancel
      </Button>
      <Button variant="primary" isDisabled onPress={args.onPress}>
        Add to list
      </Button>
    </Stage>
  ),
  play: async ({ canvas, args, userEvent }) => {
    const button = canvas.getByRole('button', { name: 'Cancel' });
    await expect(button).toBeDisabled();
    await userEvent.tab();
    await expect(button).not.toHaveFocus();
    await userEvent.keyboard('{Enter}');
    await expect(args.onPress).not.toHaveBeenCalled();
  },
};

/** Disabled, with the line under it that says when it turns on: the button is described by that line, so a screen reader reads the two together. */
export const DisabledWithReason: Story = {
  render: () => (
    <Stage direction="column">
      <Button isDisabled aria-describedby="button-story-wait">
        Send a new code
      </Button>
      <span id="button-story-wait">You can send another in 42 seconds.</span>
    </Stage>
  ),
  play: async ({ canvas }) => {
    const button = canvas.getByRole('button', { name: 'Send a new code' });
    await expect(button).toBeDisabled();
    await expect(button).toHaveAccessibleDescription('You can send another in 42 seconds.');
  },
};

/** A short label with a fuller name: it reads "New" and is named "New form" (label in name holds). */
export const ShortLabel: Story = {
  parameters: { crm: { screenshot: false } },
  args: { children: 'New', icon: 'plus', variant: 'primary', label: 'New form' },
  play: async ({ canvas }) => {
    const button = canvas.getByRole('button', { name: 'New form' });
    await expect(button).toHaveTextContent('New');
    await expect(button).toHaveAccessibleName('New form');
  },
};

/** Pending keeps the width: the spinner takes the icon's place and the label stays, so nothing beside it moves. */
export const PendingKeepsWidth: Story = {
  parameters: { crm: { screenshot: false } },
  render: () => (
    <Stage>
      <Button variant="primary" icon="plus" label="New form">
        New
      </Button>
      <Button variant="primary" icon="plus" label="New form" isPending>
        New
      </Button>
    </Stage>
  ),
  play: async ({ canvas }) => {
    // Pending, React Aria adds the spinner's "In progress" to the name, so the change is heard.
    const [idle, pending] = canvas.getAllByRole('button', { name: /^New form/ });
    await expect(idle).toHaveAccessibleName('New form');
    await expect(pending).toHaveAccessibleName('New form In progress');
    await expect(pending).toHaveAttribute('aria-disabled', 'true');
    // Within half a pixel, which no one sees: Firefox lays out in sixtieths of a pixel, so the two widths can
    // differ in the fifth decimal (66.03334 against 66.03333 on CI).
    const widths = [idle, pending].map((button) => button?.getBoundingClientRect().width ?? 0);
    await expect(Math.abs((widths[0] ?? 0) - (widths[1] ?? 0))).toBeLessThan(0.5);
    await expect(widths[0]).toBeGreaterThan(0);
  },
};

/** Pending: a spinner in place of the icon, presses ignored, still focusable. The label says what is happening. */
export const Pending: Story = {
  parameters: { crm: { preview: true } },
  args: { children: 'Saving', icon: undefined, variant: 'primary', isPending: true },
  play: async ({ canvas, args, userEvent }) => {
    const button = canvas.getByRole('button', { name: /Saving/ });
    await expect(button).toHaveAttribute('aria-disabled', 'true');
    await expect(canvas.getByRole('progressbar')).toBeInTheDocument();
    await userEvent.tab();
    await expect(button).toHaveFocus();
    await userEvent.keyboard('{Enter}');
    await expect(args.onPress).not.toHaveBeenCalled();
  },
};

/** Hovered, on devices that can hover. */
export const Hovered: Story = {
  render: (args) => (
    <Stage>
      <Button icon="settings" onPress={args.onPress}>
        View settings
      </Button>
    </Stage>
  ),
  play: async ({ canvas, userEvent }) => {
    await hoverUntilHovered(userEvent, canvas.getByRole('button', { name: 'View settings' }));
  },
};

/** Focused from the keyboard: the accent border and the focus ring. A mouse press shows no ring. */
export const Focused: Story = {
  play: async ({ canvas, userEvent }) => {
    await userEvent.tab();
    const button = canvas.getByRole('button', { name: 'View settings' });
    await expect(button).toHaveFocus();
    await expect(button).toHaveAttribute('data-focus-visible', 'true');
  },
};

/**
 * A primary focused from the keyboard: its edge is already blue, so the 1px
 * accent ring sits just outside it, past a 1px gap (danger does the same).
 */
export const FocusedPrimary: Story = {
  args: { variant: 'primary', children: 'Create', icon: undefined, kbd: '⌘↵' },
  play: async ({ canvas, userEvent }) => {
    await userEvent.tab();
    const button = canvas.getByRole('button', { name: 'Create' });
    await expect(button).toHaveFocus();
    await expect(getComputedStyle(button).outlineStyle).toBe('solid');
    await expect(getComputedStyle(button).outlineOffset).not.toBe('0px');
  },
};

/** A danger button focused from the keyboard: its edge stays red, so the 1px accent ring sits just outside it. */
export const FocusedDanger: Story = {
  args: { variant: 'danger', children: 'Delete record', icon: 'trash' },
  play: async ({ canvas, userEvent }) => {
    await userEvent.tab();
    const button = canvas.getByRole('button', { name: 'Delete record' });
    await expect(button).toHaveFocus();
    await expect(getComputedStyle(button).outlineStyle).toBe('solid');
  },
};

/** A filled danger button focused from the keyboard: the 1px accent ring sits just outside its red fill. */
export const FocusedDangerSolid: Story = {
  args: { variant: 'danger-solid', children: 'Delete 3 records', icon: 'trash' },
  play: async ({ canvas, userEvent }) => {
    await userEvent.tab();
    const button = canvas.getByRole('button', { name: 'Delete 3 records' });
    await expect(button).toHaveFocus();
    await expect(getComputedStyle(button).outlineStyle).toBe('solid');
  },
};

/** By keyboard alone: Tab moves between buttons and skips a disabled one, Enter and Space press. */
export const Keyboard: Story = {
  parameters: { crm: { screenshot: false } },
  render: (args) => (
    <Stage>
      <Button onPress={args.onPress}>Cancel</Button>
      <Button isDisabled>Archive</Button>
      <Button variant="primary" onPress={args.onPress}>
        Save
      </Button>
    </Stage>
  ),
  play: async ({ canvas, args, userEvent }) => {
    await userEvent.tab();
    await expect(canvas.getByRole('button', { name: 'Cancel' })).toHaveFocus();
    await userEvent.keyboard('{Enter}');
    await expect(args.onPress).toHaveBeenCalledTimes(1);
    await userEvent.keyboard(' ');
    await expect(args.onPress).toHaveBeenCalledTimes(2);
    await userEvent.tab();
    await expect(canvas.getByRole('button', { name: 'Save' })).toHaveFocus();
  },
};

/** ToggleButton stays pressed until pressed again, for toggles such as Bold. */
export const Toggle: Story = {
  parameters: { crm: { preview: true } },
  render: () => (
    <Stage>
      <ToggleButton defaultSelected>Show archived</ToggleButton>
      <ToggleButton>Show archived</ToggleButton>
      <ToggleButton icon="star" label="Favourite" defaultSelected />
      <ToggleButton isDisabled defaultSelected>
        Locked
      </ToggleButton>
    </Stage>
  ),
  play: async ({ canvas, userEvent }) => {
    const [on, off] = canvas.getAllByRole('button', { name: 'Show archived' });
    await expect(on).toHaveAttribute('aria-pressed', 'true');
    await expect(off).toHaveAttribute('aria-pressed', 'false');
    await userEvent.tab();
    await userEvent.tab();
    await expect(off).toHaveFocus();
    await userEvent.keyboard(' ');
    await expect(off).toHaveAttribute('aria-pressed', 'true');
    await userEvent.keyboard(' ');
    await expect(off).toHaveAttribute('aria-pressed', 'false');
    await expect(canvas.getByRole('button', { name: 'Locked' })).toBeDisabled();
  },
};

/** A selected toggle keeps its selected look while hovered. */
export const ToggleHovered: Story = {
  render: () => (
    <Stage>
      <ToggleButton defaultSelected>Show archived</ToggleButton>
    </Stage>
  ),
  play: async ({ canvas, userEvent }) => {
    const toggle = canvas.getByRole('button', { name: 'Show archived' });
    const selected = getComputedStyle(toggle).backgroundColor;
    await hoverUntilHovered(userEvent, toggle);
    await expect(getComputedStyle(toggle).backgroundColor).toBe(selected);
  },
};

function SaveOptions() {
  return (
    <Menu label="Save options">
      <MenuItem icon="plus">Save as new view</MenuItem>
      <MenuItem icon="send">Save and share</MenuItem>
    </Menu>
  );
}

/** SplitButton: the main action, and a menu of its variants from the chevron. */
export const Split: Story = {
  render: (args) => (
    <Stage>
      <SplitButton onPress={args.onPress} menu={<SaveOptions />}>
        Save
      </SplitButton>
      <SplitButton variant="secondary" menu={<SaveOptions />}>
        Export
      </SplitButton>
    </Stage>
  ),
  play: async ({ canvas, args, userEvent }) => {
    await userEvent.tab();
    await expect(canvas.getByRole('button', { name: 'Save' })).toHaveFocus();
    await userEvent.keyboard('{Enter}');
    await expect(args.onPress).toHaveBeenCalledTimes(1);

    await userEvent.tab();
    const chevron = canvas.getAllByRole('button', { name: 'More options' })[0];
    await expect(chevron).toHaveFocus();
    await userEvent.keyboard('{Enter}');
    const menu = await waitFor(() => {
      const found = document.querySelector('[role="menu"]');
      if (found === null) throw new Error('the menu did not open');
      return found;
    });
    await waitFor(() => expect(menu.contains(document.activeElement)).toBe(true));
    await userEvent.keyboard('{ArrowDown}');
    await expect(document.activeElement).toHaveTextContent('Save and share');
    await userEvent.keyboard('{Escape}');
    await waitFor(() => expect(document.querySelector('[role="menu"]')).toBeNull());
    // Focus comes back once the menu has gone, a frame later in some engines.
    await waitFor(() => expect(chevron).toHaveFocus());
  },
};

/** SplitButton disabled, and pending: both halves wait together. */
export const SplitStates: Story = {
  render: () => (
    <Stage>
      <SplitButton isDisabled menu={<SaveOptions />}>
        Save
      </SplitButton>
      <SplitButton isPending menu={<SaveOptions />}>
        Saving
      </SplitButton>
    </Stage>
  ),
  play: async ({ canvas }) => {
    const [disabled, pending] = canvas.getAllByRole('button', { name: 'More options' });
    await expect(disabled).toBeDisabled();
    await expect(pending).toHaveAttribute('aria-disabled', 'true');
    await expect(pending).toHaveAttribute('data-pending', 'true');
  },
};

/** Held narrower than its label: the label is cut and shows whole in a tooltip; one that fits shows none. */
export const TooltipWhenCut: Story = {
  parameters: { crm: { screenshot: false } },
  // The cut label's tooltip loads on demand (it keeps Tooltip out of the first load); load it before the story.
  loaders: [
    async () => {
      await import('./CutButton.tsx');
      return {};
    },
  ],
  render: () => (
    <Stage width="narrow" direction="column">
      <Button icon="calendar" iconRight="chevron-down" isFullWidth tooltipWhenCut>
        Last email interaction with the account owner
      </Button>
      <Button icon="tag" tooltipWhenCut>
        Stage
      </Button>
    </Stage>
  ),
  play: async ({ canvas, userEvent }) => {
    // Until the tooltip's code has loaded the plain button stands in; React swaps in the wrapped one a render
    // later, which took over 50 ms on a busy machine, so give it half a second.
    await new Promise((resolve) => setTimeout(resolve, 500));
    await hoverFresh(userEvent, canvas.getByRole('button', { name: 'Last email interaction with the account owner' }));
    await expect(await shownTooltip()).toHaveTextContent('Last email interaction with the account owner');
  },
};

/** A group: Open, Copy link and More joined into one control, as a list row's actions. */
export const Group: Story = {
  render: () => (
    <Stage>
      <ButtonGroup label="Intro call">
        <Button icon="external-link" label="Open Intro call in a new tab" />
        <Button icon="copy" label="Copy link to Intro call" />
        <Button icon="ellipsis" label="More for Intro call" />
      </ButtonGroup>
    </Stage>
  ),
  play: async ({ canvas }) => {
    await expect(canvas.getByRole('group', { name: 'Intro call' })).toBeInTheDocument();
    await expect(canvas.getAllByRole('button')).toHaveLength(3);
  },
};

/** A row: a card's few labelled actions, each its own button, spaced and wrapping. */
export const GroupRow: Story = {
  render: () => (
    <Stage>
      <ButtonGroup label="Change booking" layout="row">
        <Button icon="calendar-clock">Reschedule</Button>
        <Button icon="link">Copy guest link</Button>
        <Button variant="danger" icon="circle-x">
          Cancel booking
        </Button>
      </ButtonGroup>
    </Stage>
  ),
  play: async ({ canvas }) => {
    await expect(canvas.getByRole('group', { name: 'Change booking' })).toHaveAttribute('data-layout', 'row');
  },
};

/** A disclosure: open, it reads as expanded and draws held down; a danger one keeps its red. */
export const Disclosure: Story = {
  render: () => (
    <Stage>
      <Button icon="user-plus" isExpanded controls="guests-panel">
        Guests (2)
      </Button>
      <Button icon="calendar-clock" isExpanded={false}>
        Move to another time
      </Button>
      <Button variant="danger" icon="circle-x" isExpanded controls="cancel-panel">
        Cancel booking
      </Button>
      <div id="guests-panel" role="region" aria-label="Guests" />
      <div id="cancel-panel" role="region" aria-label="Cancel" />
    </Stage>
  ),
  play: async ({ canvas }) => {
    await expect(canvas.getByRole('button', { name: 'Guests (2)' })).toHaveAttribute('aria-expanded', 'true');
    await expect(canvas.getByRole('button', { name: 'Move to another time' })).toHaveAttribute(
      'aria-expanded',
      'false',
    );
  },
};
