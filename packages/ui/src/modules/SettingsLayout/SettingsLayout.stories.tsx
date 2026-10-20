import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect } from 'storybook/test';
import { Badge } from '../../atoms/Badge/Badge.tsx';
import { Button } from '../../atoms/Button/Button.tsx';
import { Meter } from '../../atoms/Meter/Meter.tsx';
import { Callout } from '../../molecules/Callout/Callout.tsx';
import { Card } from '../../molecules/Card/Card.tsx';
import { EmptyState } from '../../molecules/EmptyState/EmptyState.tsx';
import { TabPanel, Tabs } from '../../molecules/Tabs/Tabs.tsx';
import { Stage } from '../../workbench/Stage/Stage.tsx';
import { Select } from '../../molecules/Select/Select.tsx';
import { SettingsLayout, SettingsRow, SettingsStack, type SettingsNavEntry } from './SettingsLayout.tsx';

const NAV: readonly SettingsNavEntry[] = [
  { id: 'objects', label: 'Objects', href: '#objects', icon: 'box' },
  { id: 'members', label: 'Members', href: '#members', icon: 'users' },
];

type Page = 'objects' | 'object' | 'member' | 'failed';

interface SampleProps {
  readonly page?: Page;
  readonly isLoading?: boolean;
  readonly width?: 'auto' | 'narrow';
}

/** A settings page as the app draws it under its top bar. */
function SampleSettings({ page = 'objects', isLoading = false, width = 'auto' }: SampleProps) {
  if (page === 'object') {
    return (
      <Stage width={width}>
        <SettingsLayout
          nav={NAV}
          currentNavId="objects"
          title="Projects"
          hasTabs
          icon="folder"
          hue="orange"
          meta={<Badge text="Custom" />}
          description="The projects your team tracks."
        >
          <Tabs
            label="Projects settings"
            selectedKey="configuration"
            tabs={[
              { id: 'attributes', label: 'Attributes' },
              { id: 'configuration', label: 'Configuration' },
            ]}
          >
            <TabPanel id="attributes">{null}</TabPanel>
            <TabPanel id="configuration">
              <SettingsStack>
                <Card title="Configuration" description="Its names and look." />
                <Card
                  title="Archive Projects"
                  description="It leaves the sidebar; its records are kept."
                  actions={
                    <Button variant="danger" icon="archive">
                      Archive Projects
                    </Button>
                  }
                />
              </SettingsStack>
            </TabPanel>
          </Tabs>
        </SettingsLayout>
      </Stage>
    );
  }
  return (
    <Stage width={width}>
      <SettingsLayout
        nav={NAV}
        currentNavId="objects"
        title="Objects"
        description="Shape the records your workspace keeps."
        isLoading={isLoading}
        {...(page === 'member'
          ? {}
          : {
              actions: (
                <Button variant="primary" icon="plus">
                  New object
                </Button>
              ),
            })}
      >
        {page === 'failed' ? (
          <EmptyState tone="error" title="Couldn’t load the objects" onRetry={() => undefined}>
            Check your connection, then try again.
          </EmptyState>
        ) : page === 'member' ? (
          <Callout>Only workspace owners and admins can change objects and attributes.</Callout>
        ) : (
          <Meter label="Custom objects" value={3} maxValue={50} />
        )}
      </SettingsLayout>
    </Stage>
  );
}

const meta = {
  title: 'Modules/SettingsLayout',
  component: SampleSettings,
} satisfies Meta<typeof SampleSettings>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Settings, Objects: the navigation with Objects current, the header with its description and New object. */
export const Default: Story = {
  parameters: { crm: { preview: true } },
  play: async ({ canvas }) => {
    await expect(canvas.getByRole('navigation', { name: 'Settings' })).toBeInTheDocument();
    await expect(canvas.getByRole('link', { name: 'Objects' })).toHaveAttribute('aria-current', 'page');
    await expect(canvas.getByRole('heading', { level: 2, name: 'Objects' })).toBeInTheDocument();
    await expect(canvas.getByRole('button', { name: 'New object' })).toBeInTheDocument();
  },
};

/** An object's page: its tile, the Custom badge, and its tabs in the body. */
export const ObjectPage: Story = {
  args: { page: 'object' },
  play: async ({ canvas }) => {
    await expect(canvas.getByRole('heading', { level: 2, name: 'Projects' })).toBeInTheDocument();
    await expect(canvas.getByRole('tab', { name: 'Configuration' })).toHaveAttribute('aria-selected', 'true');
  },
};

/** The title takes focus by script, for when the control in use went away with its change; it is no tab stop. */
export const TitleFocus: Story = {
  parameters: { crm: { screenshot: false } },
  play: async ({ canvas }) => {
    const title = canvas.getByRole('heading', { level: 2, name: 'Objects' });
    await expect(title).toHaveAttribute('tabindex', '-1');
    title.focus();
    await expect(title).toHaveFocus();
  },
};

/** A member reads the page: no actions, and a quiet note in the body. */
export const ReadOnly: Story = {
  args: { page: 'member' },
  play: async ({ canvas }) => {
    await expect(canvas.queryByRole('button', { name: 'New object' })).not.toBeInTheDocument();
  },
};

/** The page's head is still coming: skeletons after the loading delay; the navigation stays usable. */
export const Loading: Story = {
  args: { isLoading: true },
  play: async ({ canvas }) => {
    await expect(canvas.getByText('Loading settings')).toBeInTheDocument();
    await expect(canvas.getByRole('link', { name: 'Members' })).toBeInTheDocument();
  },
};

/** The page's read failed: the body says so with Try again, and the navigation stays. */
export const Failed: Story = {
  args: { page: 'failed' },
  play: async ({ canvas }) => {
    await expect(canvas.getByRole('button', { name: 'Try again' })).toBeInTheDocument();
  },
};

/** In a narrow slot the navigation sits above the page. */
export const Narrow: Story = {
  args: { width: 'narrow' },
  parameters: { crm: { screenshot: false } },
};

const THEMES = [
  { id: 'system', label: 'System preference', icon: 'monitor' as const },
  { id: 'light', label: 'Light', icon: 'sun' as const },
  { id: 'dark', label: 'Dark', icon: 'moon' as const },
];

/**
 * A page beside the app's settings sidebar (spec 0026): no navigation column,
 * the trail over its h1, a hairline, then a Card of setting rows.
 */
export const Rows: Story = {
  parameters: { crm: { preview: true } },
  render: () => (
    <Stage>
      <SettingsLayout
        titleLevel={1}
        trail={[
          { id: 'account', label: 'Account' },
          { id: 'preferences', label: 'Preferences' },
        ]}
        title="Preferences"
        description="How Timefix looks for you. Saved in this browser."
      >
        <Card title="Appearance">
          <SettingsRow title="Interface theme" description="Choose a look, or follow your device’s setting.">
            <Select label="Interface theme" isLabelHidden items={THEMES} defaultValue="system" />
          </SettingsRow>
          <SettingsRow title="Density" description="A second row, a hairline above it.">
            <Select
              label="Density"
              isLabelHidden
              items={[{ id: 'compact', label: 'Compact' }]}
              defaultValue="compact"
            />
          </SettingsRow>
        </Card>
      </SettingsLayout>
    </Stage>
  ),
  play: async ({ canvas }) => {
    await expect(canvas.queryByRole('navigation', { name: 'Settings' })).toBeNull();
    await expect(canvas.getByRole('heading', { level: 1, name: 'Preferences' })).toHaveAttribute('tabindex', '-1');
    await expect(canvas.getByRole('heading', { level: 2, name: 'Appearance' })).toBeInTheDocument();
    await expect(canvas.queryByRole('link', { name: 'Account' })).toBeNull();
    await expect(canvas.getByRole('button', { name: /Interface theme/ })).toBeInTheDocument();
  },
};

/** The same page loading: the trail stays, skeletons for the rest, and the h1 kept for screen readers and focus. */
export const RowsLoading: Story = {
  parameters: { crm: { screenshot: false } },
  render: () => (
    <Stage>
      <SettingsLayout
        titleLevel={1}
        trail={[
          { id: 'account', label: 'Account' },
          { id: 'preferences', label: 'Preferences' },
        ]}
        title="Preferences"
        isLoading
      >
        {null}
      </SettingsLayout>
    </Stage>
  ),
  play: async ({ canvas }) => {
    await expect(canvas.getByRole('heading', { level: 1, name: 'Preferences' })).toBeInTheDocument();
    await expect(canvas.getByText('Account')).toBeInTheDocument();
  },
};

/** On a phone the control drops under its title and description. */
export const RowsNarrow: Story = {
  render: () => (
    <Stage width="narrow">
      <SettingsLayout titleLevel={1} title="Preferences">
        <Card title="Appearance">
          <SettingsRow title="Interface theme" description="Choose a look, or follow your device’s setting.">
            <Select label="Interface theme" isLabelHidden items={THEMES} defaultValue="system" />
          </SettingsRow>
        </Card>
      </SettingsLayout>
    </Stage>
  ),
};

/** A row's other states: no description, and a control that is disabled or read only (the control's own states). */
export const RowStates: Story = {
  render: () => (
    <Stage>
      <SettingsLayout titleLevel={1} title="Preferences">
        <Card title="Appearance">
          <SettingsRow title="Interface theme">
            <Select label="Interface theme" isLabelHidden items={THEMES} defaultValue="system" />
          </SettingsRow>
          <SettingsRow title="Density" description="Coming with a later release.">
            <Select
              label="Density"
              isLabelHidden
              items={[{ id: 'compact', label: 'Compact' }]}
              defaultValue="compact"
              isDisabled
            />
          </SettingsRow>
          <SettingsRow title="Language" description="Set by your workspace.">
            <Select
              label="Language"
              isLabelHidden
              items={[{ id: 'en', label: 'English' }]}
              defaultValue="en"
              isReadOnly
              readOnlyReason="Set by your workspace."
            />
          </SettingsRow>
        </Card>
      </SettingsLayout>
    </Stage>
  ),
  play: async ({ canvas }) => {
    await expect(canvas.getByText('Interface theme')).toBeInTheDocument();
    await expect(canvas.getByRole('button', { name: /Density/ })).toBeDisabled();
  },
};
