import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, waitFor, within } from 'storybook/test';
import { ProviderMark } from '../../atoms/ProviderMark/ProviderMark.tsx';
import { settleAnimations } from '../../workbench/animations.ts';
import { Stage } from '../../workbench/Stage/Stage.tsx';
import { Field } from '../Field/Field.tsx';
import { Disclosure, DisclosureGroup } from './Disclosure.tsx';

const meta = {
  title: 'Molecules/Disclosure',
  component: Disclosure,
  args: { title: 'Contact', count: 4, children: 'Email, phone, and two addresses.' },
} satisfies Meta<typeof Disclosure>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Enter opens and closes it, and it says whether it is open. */
export const Default: Story = {
  render: (args) => (
    <Stage width="narrow">
      <Disclosure {...args} />
    </Stage>
  ),
  play: async ({ canvas, userEvent }) => {
    const toggle = canvas.getByRole('button', { name: /Contact/ });
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await userEvent.tab();
    await userEvent.keyboard('{Enter}');
    await expect(toggle).toHaveAttribute('aria-expanded', 'true');
  },
};

/** A group with one section open. */
export const Group: Story = {
  parameters: { crm: { preview: true } },
  render: () => (
    <Stage width="narrow">
      <DisclosureGroup defaultExpandedKeys={['contact']}>
        <Disclosure id="contact" title="Contact" count={4}>
          Email, phone, and two addresses.
        </Disclosure>
        <Disclosure id="billing" title="Billing" count={2}>
          Plan and payment method.
        </Disclosure>
        <Disclosure id="system" title="System" isDisabled>
          Created and updated.
        </Disclosure>
      </DisclosureGroup>
    </Stage>
  ),
};

/** The label variant, as the sidebar's sections draw it: a quiet title with its chevron after it. */
export const Label: Story = {
  render: () => (
    <Stage width="narrow">
      <Disclosure title="Records" variant="label" defaultExpanded>
        Companies, People and Deals.
      </Disclosure>
    </Stage>
  ),
  play: async ({ canvas }) => {
    await expect(canvas.getByRole('button', { name: 'Records' })).toHaveAttribute('aria-expanded', 'true');
  },
};

/** A count shown whole and read with its noun (`countLabel`), as a record's related section heads its side. */
export const WholeCount: Story = {
  render: () => (
    <Stage width="narrow">
      <Disclosure title="Team" variant="label" count={150_000} countLabel="people" defaultExpanded>
        The first twenty people.
      </Disclosure>
    </Stage>
  ),
  play: async ({ canvas }) => {
    await expect(canvas.getByText('150,000')).toBeInTheDocument();
    await expect(canvas.getByRole('button', { name: 'Team 150,000 people' })).toBeInTheDocument();
  },
};

/**
 * The quiet variant, as Home's setup checklist folds its done steps: a control sized to its words, its chevron
 * centred in a 16px icon's column on the content edge and its words `space-12` after it; the panel flush.
 * SetupChecklist's stories carry its screenshots.
 */
export const Quiet: Story = {
  parameters: { crm: { screenshot: false } },
  render: () => (
    <Stage width="narrow-fill">
      <Disclosure title="2 done" variant="quiet" defaultExpanded>
        Connect your calendar and create a booking page.
      </Disclosure>
    </Stage>
  ),
  play: async ({ canvas }) => {
    const toggle = canvas.getByRole('button', { name: '2 done' });
    await expect(toggle).toHaveAttribute('aria-expanded', 'true');
    const edge = canvas.getByRole('heading', { name: '2 done' }).getBoundingClientRect();
    // Sized to its words, never a full width bar.
    await expect(toggle.getBoundingClientRect().width).toBeLessThan(edge.width / 2);
    // The chevron's centre sits half an icon in (its size-icon column, 14px at the app's density, spec 0071).
    const icon = Number.parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--size-icon'));
    const chevron = toggle.querySelector('svg')?.getBoundingClientRect();
    await expect(chevron === undefined ? undefined : chevron.left + chevron.width / 2 - edge.left).toBeCloseTo(
      icon / 2,
      0,
    );
    // The words after the icon's column and space-12 (25px at the app's density, spec 0071).
    const space12 = Number.parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--space-12'));
    await expect(within(toggle).getByText('2 done').getBoundingClientRect().left - edge.left).toBeCloseTo(
      icon + space12,
      0,
    );
    // The panel is flush: what it holds starts on the content edge.
    const content = canvas.getByText('Connect your calendar and create a booking page.');
    await expect(content.getBoundingClientRect().left).toBeCloseTo(edge.left, 0);
    await expect(content.getBoundingClientRect().top).toBeCloseTo(toggle.getBoundingClientRect().bottom, 0);
  },
};

/** More fields folded inside a form: open, they stack as a form's fields do. */
export const Fields: Story = {
  args: { title: 'Add more fields', count: 2, variant: 'fields', defaultExpanded: true },
  render: (args) => (
    <Stage direction="column">
      <Disclosure {...args}>
        <Field label="Job title" />
        <Field label="Description" isMultiline />
      </Disclosure>
    </Stage>
  ),
  play: async ({ canvas }) => {
    await expect(canvas.getByRole('textbox', { name: 'Job title' })).toBeVisible();
  },
};

/** `leading` before the title, inside the toggle: an account's provider mark in the calendars list. */
export const Leading: Story = {
  parameters: { crm: { screenshot: false } },
  render: () => (
    <Stage width="narrow">
      <Disclosure
        title="ada@acme.dev"
        variant="label"
        defaultExpanded
        leading={<ProviderMark provider="google-calendar" size="sm" />}
      >
        <span>Team</span>
      </Disclosure>
    </Stage>
  ),
  play: async ({ canvas }) => {
    await expect(canvas.getByRole('button', { name: /ada@acme\.dev/ })).toHaveAttribute('aria-expanded', 'true');
  },
};

/** A default fold inside an open quiet one: the inner keeps its own look, closed and unturned (flow walks, 29 October 2026). */
export const Nested: Story = {
  render: () => (
    <Stage width="narrow-fill">
      <Disclosure title="What each role can do" variant="quiet" defaultExpanded>
        <Disclosure title="Records">Export records</Disclosure>
      </Disclosure>
    </Stage>
  ),
  play: async ({ canvas }) => {
    const outer = canvas.getByRole('button', { name: 'What each role can do' });
    const inner = canvas.getByRole('button', { name: 'Records' });
    await expect(outer).toHaveAttribute('aria-expanded', 'true');
    await expect(inner).toHaveAttribute('aria-expanded', 'false');
    // The inner title is a full width row, not a quiet pill.
    await expect(inner.getBoundingClientRect().width).toBeGreaterThan(outer.getBoundingClientRect().width);
  },
};

/** Opening flips the chevron and shows the content; closing makes the content inert again (transitions.dev 21). */
export const OpensAndCloses: Story = {
  parameters: { crm: { screenshot: false } },
  render: () => (
    <Stage width="narrow">
      <Disclosure title="Advanced">Buffer before and after each meeting.</Disclosure>
    </Stage>
  ),
  play: async ({ canvas, userEvent }) => {
    const trigger = canvas.getByRole('button', { name: 'Advanced' });
    // The words sit straight in the panel's content element, which is what turns inert while closed.
    const content = canvas.getByText('Buffer before and after each meeting.');
    await expect(trigger).toHaveAttribute('aria-expanded', 'false');
    await expect(content).toHaveAttribute('inert');
    await userEvent.click(trigger);
    await expect(trigger).toHaveAttribute('aria-expanded', 'true');
    await waitFor(() => expect(content).not.toHaveAttribute('inert'));
    await settleAnimations();
    await expect(content).toBeVisible();
    await userEvent.keyboard('{Enter}');
    await expect(trigger).toHaveAttribute('aria-expanded', 'false');
    await waitFor(() => expect(content).toHaveAttribute('inert'));
  },
};
