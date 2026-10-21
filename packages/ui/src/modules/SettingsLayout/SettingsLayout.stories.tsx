import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect } from 'storybook/test';
import { Badge } from '../../atoms/Badge/Badge.tsx';
import { Button } from '../../atoms/Button/Button.tsx';
import { Meter } from '../../atoms/Meter/Meter.tsx';
import { Skeleton } from '../../atoms/Skeleton/Skeleton.tsx';
import { ProviderMark } from '../../atoms/ProviderMark/ProviderMark.tsx';
import { InfoTip } from '../../molecules/InfoTip/InfoTip.tsx';
import { Callout } from '../../molecules/Callout/Callout.tsx';
import { Card } from '../../molecules/Card/Card.tsx';
import { EmptyState } from '../../molecules/EmptyState/EmptyState.tsx';
import { TabPanel, Tabs } from '../../molecules/Tabs/Tabs.tsx';
import { Stage } from '../../workbench/Stage/Stage.tsx';
import { TopBar } from '../Toolbar/Toolbar.tsx';
import { Select } from '../../molecules/Select/Select.tsx';
import { Field } from '../../molecules/Field/Field.tsx';
import { Form } from '../../molecules/Form/Form.tsx';
import {
  SettingsGrid,
  SettingsLayout,
  SettingsRow,
  SettingsRowGroup,
  SettingsSection,
  SettingsStack,
  type SettingsNavEntry,
} from './SettingsLayout.tsx';

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
                <SettingsSection title="Names and look" description="What it’s called, and its icon and colour.">
                  <Card>Project, Projects</Card>
                </SettingsSection>
                <SettingsSection title="Danger zone">
                  <Card
                    title="Archive Projects"
                    description="It leaves the sidebar; its records are kept."
                    actions={
                      <Button variant="danger" icon="archive">
                        Archive Projects
                      </Button>
                    }
                  />
                </SettingsSection>
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
    // Under a TopBar: the page's h2, a section's h3, and its card's h4.
    await expect(canvas.getByRole('heading', { level: 3, name: 'Danger zone' })).toBeInTheDocument();
    await expect(canvas.getByRole('heading', { level: 4, name: 'Archive Projects' })).toBeInTheDocument();
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
 * the trail over its h1, a hairline, then a section: its title at the start,
 * a Card of setting rows across the rest of the width.
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
        <SettingsSection title="Appearance" description="How the app looks on this browser.">
          <Card>
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
        </SettingsSection>
      </SettingsLayout>
    </Stage>
  ),
  play: async ({ canvas }) => {
    await expect(canvas.queryByRole('navigation', { name: 'Settings' })).toBeNull();
    await expect(canvas.getByRole('heading', { level: 1, name: 'Preferences' })).toHaveAttribute('tabindex', '-1');
    await expect(canvas.getByRole('heading', { level: 2, name: 'Appearance' })).toBeInTheDocument();
    await expect(canvas.getByRole('region', { name: 'Appearance' })).toBeInTheDocument();
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

/** On a phone the control drops under the row's title and description. */
export const RowsNarrow: Story = {
  render: () => (
    <Stage width="narrow">
      <SettingsLayout titleLevel={1} title="Preferences">
        <SettingsSection title="Appearance">
          <Card>
            <SettingsRow title="Interface theme" description="Choose a look, or follow your device’s setting.">
              <Select label="Interface theme" isLabelHidden items={THEMES} defaultValue="system" />
            </SettingsRow>
          </Card>
        </SettingsSection>
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

/**
 * Rows that stand for things of one kind (a connected calendar each): the
 * provider's mark before the text, a Default badge and an InfoTip beside the
 * title, the state as the description, the controls at the end.
 */
export const ThingRows: Story = {
  render: () => (
    <Stage width="fill">
      <SettingsLayout titleLevel={1} title="Calendars">
        <Card>
          <SettingsRow
            title="grace@timefix.dev"
            leading={<ProviderMark provider="google-calendar" />}
            meta={<Badge text="Default" />}
            description={<Badge text="Connected" dot="green" />}
          >
            <Button variant="ghost" icon="ellipsis" label="Actions for grace@timefix.dev" />
          </SettingsRow>
          <SettingsRow
            title="grace@gmail.com"
            leading={<ProviderMark provider="google-calendar" />}
            meta={<InfoTip label="Expired">Google stopped letting us read it. Connect it again.</InfoTip>}
            description={<Badge text="Expired" dot="orange" />}
          >
            <Button variant="ghost" icon="ellipsis" label="Actions for grace@gmail.com" />
          </SettingsRow>
        </Card>
      </SettingsLayout>
    </Stage>
  ),
  play: async ({ canvas }) => {
    await expect(canvas.getByText('Default')).toBeVisible();
    await expect(canvas.getByRole('button', { name: 'About Expired' })).toBeVisible();
  },
};

/**
 * The pattern every settings page follows (21 Oct 2026): sections across the
 * page's width, each with its heading above its cards; a form
 * section whose fields sit two to a row (Form's `columns={2}`); cards of one
 * kind side by side in a SettingsGrid; and a danger section last.
 */
export const Sections: Story = {
  parameters: { crm: { preview: true } },
  render: () => (
    <Stage width="fill">
      <SettingsLayout
        titleLevel={1}
        trail={[
          { id: 'workspace', label: 'Workspace' },
          { id: 'general', label: 'General' },
        ]}
        title="General"
        description="Your workspace’s name and address."
      >
        <SettingsSection title="Workspace" description="What members see in the sidebar and in emails.">
          <Card footer={<Button variant="primary">Save</Button>}>
            <Form id="workspace" label="Workspace" columns={2} onSubmit={() => undefined}>
              <Field label="Name" name="name" defaultValue="Acme" />
              <Field label="Web address" name="slug" defaultValue="acme" />
              <Field
                label="Workspace ID"
                name="id"
                defaultValue="01a159c4-5ab4"
                isReadOnly
                readOnlyReason="Set by the system."
              />
            </Form>
          </Card>
        </SettingsSection>
        <SettingsSection title="Calendars" description="One card for each connected calendar.">
          <SettingsGrid>
            <Card title="ada@acme.com" description="Google · Default" />
            <Card title="ada@personal.com" description="Google" />
          </SettingsGrid>
        </SettingsSection>
        <SettingsSection title="Danger zone">
          <Card
            title="Delete workspace"
            description="Everything in it goes, for every member."
            actions={<Button variant="danger">Delete workspace</Button>}
          />
        </SettingsSection>
      </SettingsLayout>
    </Stage>
  ),
  play: async ({ canvas }) => {
    await expect(canvas.getByRole('heading', { level: 2, name: 'Workspace' })).toBeInTheDocument();
    await expect(canvas.getByRole('region', { name: 'Danger zone' })).toBeInTheDocument();
    // Cards in a section take the level under the section's heading.
    await expect(canvas.getByRole('heading', { level: 3, name: 'Delete workspace' })).toBeInTheDocument();
    await expect(canvas.getByLabelText('Web address')).toHaveValue('acme');
  },
};

/**
 * Under the app's TopBar (`header="bar"`, 21 October 2026): the bar carries the trail, an object's tile and badge
 * and the page's one primary action at its end; the layout draws no title block, and the sections follow at once,
 * their headings h2 under the bar's h1.
 */
export const UnderTheBar: Story = {
  render: () => (
    <Stage width="fill" direction="column">
      <TopBar
        title="Calendars"
        crumbs={[
          { id: 'settings', label: 'Settings' },
          { id: 'account', label: 'Account' },
        ]}
      >
        <Button provider="google-calendar">Connect Google calendar</Button>
      </TopBar>
      <SettingsLayout header="bar" title="Calendars">
        <SettingsSection title="Connected calendars">
          <Card>
            <SettingsRow
              title="ada@acme.com"
              leading={<ProviderMark provider="google-calendar" />}
              meta={<Badge text="Default" />}
              description={<Badge text="Connected" dot="green" />}
            >
              <Button variant="ghost" icon="ellipsis" label="Actions for ada@acme.com" />
            </SettingsRow>
          </Card>
        </SettingsSection>
      </SettingsLayout>
    </Stage>
  ),
  play: async ({ canvas }) => {
    await expect(canvas.getByRole('heading', { level: 2, name: 'Connected calendars' })).toBeInTheDocument();
    await expect(canvas.queryByRole('heading', { level: 2, name: 'Calendars' })).toBeNull();
    await expect(canvas.getByRole('button', { name: 'Connect Google calendar' })).toBeInTheDocument();
  },
};

/**
 * Under the bar while the page loads: the TopBar keeps its trail, the body is marked busy with "Loading settings"
 * for screen readers, and the page's own skeleton (a busy card in its first section) holds the place.
 */
export const UnderTheBarLoading: Story = {
  render: () => (
    <Stage width="fill" direction="column">
      <TopBar
        title="Calendars"
        crumbs={[
          { id: 'settings', label: 'Settings' },
          { id: 'account', label: 'Account' },
        ]}
      />
      <SettingsLayout header="bar" title="Calendars" isLoading>
        <SettingsSection title="Connected calendars">
          <Card isBusy>
            <Skeleton width="long" />
            <Skeleton width="medium" />
          </Card>
        </SettingsSection>
      </SettingsLayout>
    </Stage>
  ),
  play: async ({ canvasElement }) => {
    await expect(canvasElement.querySelector('[aria-busy="true"]')).not.toBeNull();
  },
};

/** The same sections in a narrow slot: each heading above its cards, the fields one to a row, the cards stacked. */
export const SectionsNarrow: Story = {
  render: () => (
    <Stage width="narrow">
      <SettingsLayout titleLevel={1} title="General">
        <SettingsSection title="Workspace" description="What members see in the sidebar and in emails.">
          <Card>
            <Form id="workspace-narrow" label="Workspace" columns={2} onSubmit={() => undefined}>
              <Field label="Name" name="name" defaultValue="Acme" />
              <Field label="Web address" name="slug" defaultValue="acme" />
            </Form>
          </Card>
        </SettingsSection>
        <SettingsSection title="Calendars">
          <SettingsGrid>
            <Card title="ada@acme.com" description="Google · Default" />
            <Card title="ada@personal.com" description="Google" />
          </SettingsGrid>
        </SettingsSection>
      </SettingsLayout>
    </Stage>
  ),
  play: async ({ canvas }) => {
    // Narrow slot on a wide window: the container query stacks the title above its card.
    const heading = canvas.getByRole('heading', { level: 2, name: 'Workspace' }).getBoundingClientRect();
    const name = canvas.getByRole('textbox', { name: 'Name' }).getBoundingClientRect();
    const slug = canvas.getByRole('textbox', { name: 'Web address' }).getBoundingClientRect();
    await expect(name.top).toBeGreaterThan(heading.bottom);
    await expect(name.width).toBeGreaterThan(100);
    await expect(slug.top).toBeGreaterThan(name.top);
  },
};

/** Rows in groups inside one Card, one with an InfoTip beside its title (a booking page's Limits). */
export const RowGroups: Story = {
  parameters: { crm: { screenshot: false } },
  render: () => (
    <Stage>
      <Card title="Limits">
        <SettingsRowGroup title="Buffers">
          <SettingsRow
            title="Before"
            meta={<InfoTip label="Buffer before">Free time kept before each meeting.</InfoTip>}
          >
            <Select label="Before" isLabelHidden items={[{ id: '0', label: 'None' }]} defaultValue="0" />
          </SettingsRow>
          <SettingsRow title="After">
            <Select label="After" isLabelHidden items={[{ id: '0', label: 'None' }]} defaultValue="0" />
          </SettingsRow>
        </SettingsRowGroup>
        <SettingsRowGroup title="Pace">
          <SettingsRow title="Bookings a day">
            <Select
              label="Bookings a day"
              isLabelHidden
              items={[{ id: 'none', label: 'No limit' }]}
              defaultValue="none"
            />
          </SettingsRow>
        </SettingsRowGroup>
      </Card>
    </Stage>
  ),
  play: async ({ canvas }) => {
    await expect(canvas.getByRole('group', { name: 'Buffers' })).toBeInTheDocument();
    await expect(canvas.getByRole('button', { name: 'About Buffer before' })).toBeInTheDocument();
  },
};
