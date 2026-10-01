import type { Meta, StoryObj } from '@storybook/react-vite';
import { Menu, MenuItem } from '../../molecules/Menu/Menu.tsx';
import { expect, fn, waitFor } from 'storybook/test';
import { hoverUntilHovered } from '../../workbench/pointer.ts';
import { Stage } from '../../workbench/Stage/Stage.tsx';
import { Button, SplitButton, ToggleButton } from './Button.tsx';

const meta = {
  title: 'Atoms/Button',
  component: Button,
  args: { children: 'View settings', icon: 'settings', onPress: fn() },
} satisfies Meta<typeof Button>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Secondary, the default: view controls, Import / Export, Cancel. */
export const Default: Story = {};

/** The four variants. One primary per surface, on the action that commits. */
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
      <Button variant="danger" icon="trash">
        Delete record
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
