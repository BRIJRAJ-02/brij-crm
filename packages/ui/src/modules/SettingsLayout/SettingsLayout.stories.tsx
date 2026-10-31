import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, screen } from 'storybook/test';
import { Avatar } from '../../atoms/Avatar/Avatar.tsx';
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
import { Disclosure } from '../../molecules/Disclosure/Disclosure.tsx';
import { Table } from '../../molecules/Table/Table.tsx';
import { Stage } from '../../workbench/Stage/Stage.tsx';
import { SaveBar } from '../SaveBar/SaveBar.tsx';
import { TopBar } from '../Toolbar/Toolbar.tsx';
import { Select } from '../../molecules/Select/SelectWithFaces.tsx';
import { Field } from '../../molecules/Field/Field.tsx';
import { Form } from '../../molecules/Form/Form.tsx';
import { Switch } from '../../atoms/Switch/Switch.tsx';
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

/**
 * Input rows (`control="field"`): every Field, Select and plain value in one column at the row's end, so a
 * page's inputs line up; a picture row (`leadingAlign="center"`) with no control; a Button keeps its own width.
 */
export const InputRows: Story = {
  render: () => (
    <Stage>
      <SettingsLayout title="Profile">
        <Card>
          <SettingsRow
            title="Ada Lovelace"
            description="From Google"
            leadingAlign="center"
            leading={<Avatar name="Ada Lovelace" id="ada" size="xl" isDecorative />}
          />
          <SettingsRow title="Your name" control="field">
            <Field label="Your name" isLabelHidden defaultValue="Ada Lovelace" />
          </SettingsRow>
          <SettingsRow title="Email" description="Used to sign in" control="field">
            ada.lovelace+a.very.long.address.for.wrapping@analytical-engine.example.com
          </SettingsRow>
          <SettingsRow title="Week starts on" control="field">
            <Select
              label="Week starts on"
              isLabelHidden
              items={[{ id: 'monday', label: 'Monday' }]}
              defaultValue="monday"
            />
          </SettingsRow>
          <SettingsRow title="Items in your sidebar">
            <Button>Customise sidebar</Button>
          </SettingsRow>
        </Card>
      </SettingsLayout>
    </Stage>
  ),
  play: async ({ canvas }) => {
    await expect(canvas.getByRole('textbox', { name: 'Your name' })).toHaveValue('Ada Lovelace');
    await expect(canvas.getByText(/analytical-engine\.example\.com/)).toBeVisible();
    await expect(canvas.getByRole('button', { name: /Week starts on/ })).toBeInTheDocument();
  },
};

/** A row whose title needs a word of help: an InfoTip beside it. */
export const RowInfo: Story = {
  render: () => (
    <Stage>
      <Card>
        <SettingsRow
          title="Most uses"
          meta={<InfoTip label="Most uses">How many people can join with the link before it stops working.</InfoTip>}
        >
          <Select label="Most uses" isLabelHidden items={[{ id: 'none', label: 'No limit' }]} defaultValue="none" />
        </SettingsRow>
      </Card>
    </Stage>
  ),
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(canvas.getByRole('button', { name: 'About Most uses' }));
    // The help opens in a popover, outside the story's canvas.
    await expect(await screen.findByRole('dialog', { name: 'About Most uses' })).toBeInTheDocument();
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

/** A section whose one action works on all of it: Sign out of all other devices over the devices list. */
export const SectionActions: Story = {
  render: () => (
    <Stage>
      <SettingsLayout titleLevel={1} title="Security">
        <SettingsSection
          title="Signed in devices"
          description="Each browser signed in to your account."
          actions={<Button variant="danger">Sign out of all other devices</Button>}
        >
          <Table
            label="Signed in devices"
            columns={[
              { id: 'device', label: 'Device', isRowHeader: true },
              { id: 'when', label: 'Last active' },
            ]}
            rows={[
              { id: 'mac', device: 'Chrome on macOS', when: 'now' },
              { id: 'phone', device: 'Safari on iPhone', when: '2 days ago' },
            ]}
            getRowId={(row) => row.id}
            renderCell={(row, column) => (column === 'device' ? row.device : row.when)}
          />
        </SettingsSection>
      </SettingsLayout>
    </Stage>
  ),
  play: async ({ canvas }) => {
    const section = canvas.getByRole('region', { name: 'Signed in devices' });
    await expect(section).toContainElement(canvas.getByRole('button', { name: 'Sign out of all other devices' }));
  },
};

/** On a phone the section's action wraps under its heading. */
export const SectionActionsNarrow: Story = {
  render: () => (
    <Stage width="narrow">
      <SettingsLayout titleLevel={1} title="Security">
        <SettingsSection
          title="Signed in devices"
          description="Each browser signed in to your account."
          actions={<Button variant="danger">Sign out of all other devices</Button>}
        >
          <Card>
            <SettingsRow title="Chrome on macOS" description="now" />
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
 * Unsaved changes (Profile, General): the SaveBar in the `footer`, at the view's foot under a short body, not under
 * the last card; on a long page it sticks there and follows the last section once scrolled to the end.
 */
export const WithSaveBar: Story = {
  parameters: { crm: { screenshot: false } },
  render: () => (
    <Stage width="fill" height="page" direction="column">
      <TopBar title="Profile" crumbs={[{ id: 'settings', label: 'Settings' }]} />
      <SettingsLayout
        header="bar"
        title="Profile"
        footer={<SaveBar status="unsaved" onSave={() => undefined} onDiscard={() => undefined} />}
      >
        <Card>
          <SettingsRow title="Your name" control="field">
            <Field label="Your name" isLabelHidden defaultValue="Ada King" />
          </SettingsRow>
        </Card>
      </SettingsLayout>
    </Stage>
  ),
  play: async ({ canvas }) => {
    await expect(canvas.getByText('Unsaved changes')).toBeInTheDocument();
    await expect(canvas.getByRole('button', { name: /^Save/ })).toBeInTheDocument();
    await expect(canvas.getByRole('button', { name: 'Discard' })).toBeInTheDocument();
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

/** A row whose title needs a word of help: its InfoTip as the title's meta, in place of a description. */
export const RowWithInfo: Story = {
  parameters: { crm: { screenshot: false } },
  render: () => (
    <Stage>
      <SettingsLayout titleLevel={1} title="Notifications">
        <Card title="Email">
          <SettingsRow
            title="Daily digest"
            meta={
              <InfoTip label="Daily digest">One email at 8 in the morning, your time, of what is still unread.</InfoTip>
            }
          >
            <Switch label="Daily digest" isLabelHidden />
          </SettingsRow>
        </Card>
      </SettingsLayout>
    </Stage>
  ),
  play: async ({ canvas }) => {
    await expect(canvas.getByRole('button', { name: 'About Daily digest' })).toBeInTheDocument();
    await expect(canvas.getByRole('switch', { name: 'Daily digest' })).toBeInTheDocument();
  },
};

const EDGE_ROWS = [
  { id: 'people', name: 'People', count: '17 attributes' },
  { id: 'companies', name: 'Companies', count: '22 attributes' },
  { id: 'deals', name: 'Deals', count: '13 attributes' },
] as const;
const EDGE_COLUMNS = [
  { id: 'name', label: 'Object', isRowHeader: true },
  { id: 'count', label: 'Attributes', align: 'end' as const },
];

/** Where an element's text starts: its box's start plus its own start padding. */
function textStart(element: Element): number {
  return element.getBoundingClientRect().left + Number.parseFloat(getComputedStyle(element).paddingInlineStart);
}

/**
 * One content edge under the bar (22 Oct 2026): the tabs sit right under the TopBar as the page's second bar,
 * and the first tab's label, the Meter, a reorderable Table's first column (its handles in the gutter before
 * it), a plain Table's and the Disclosure's title row all start on the same line; the rows run out to the
 * page's edges.
 */
export const ContentEdge: Story = {
  render: () => (
    <Stage width="fill" direction="column">
      <TopBar
        title="Objects"
        crumbs={[
          { id: 'settings', label: 'Settings' },
          { id: 'workspace', label: 'Workspace' },
        ]}
      >
        <Button variant="primary" icon="plus">
          New object
        </Button>
      </TopBar>
      <SettingsLayout header="bar" title="Objects" hasTabs>
        <Tabs
          label="Objects"
          tabs={[
            { id: 'live', label: 'Objects', count: 3 },
            { id: 'about', label: 'About' },
          ]}
        >
          <TabPanel id="live">
            <SettingsStack>
              <Meter label="Custom objects" value={0} maxValue={50} />
              <Table
                label="Objects"
                columns={EDGE_COLUMNS}
                rows={EDGE_ROWS}
                getRowId={(row) => row.id}
                getRowLabel={(row) => row.name}
                renderCell={(row, column) => (column === 'name' ? row.name : row.count)}
                onReorder={() => undefined}
              />
              <Disclosure title="Archived" count={1} defaultExpanded>
                <Table
                  label="Archived objects"
                  columns={EDGE_COLUMNS}
                  rows={[{ id: 'projects', name: 'Projects', count: '4 attributes' }]}
                  getRowId={(row) => row.id}
                  renderCell={(row, column) => (column === 'name' ? row.name : row.count)}
                />
              </Disclosure>
            </SettingsStack>
          </TabPanel>
          <TabPanel id="about">{null}</TabPanel>
        </Tabs>
      </SettingsLayout>
    </Stage>
  ),
  play: async ({ canvas }) => {
    const edge = canvas.getByText('Custom objects').getBoundingClientRect().left;
    const tab = canvas.getByRole('tab', { name: /Objects/ });
    const [liveHeader] = canvas.getAllByRole('columnheader', { name: 'Object' });
    const archived = canvas.getByRole('rowheader', { name: 'Projects' });
    const trigger = canvas.getByRole('button', { name: /Archived/ });
    if (liveHeader === undefined) throw new Error('no header');
    await expect(textStart(tab)).toBeCloseTo(edge, 0);
    await expect(textStart(liveHeader)).toBeCloseTo(edge, 0);
    await expect(textStart(canvas.getByRole('rowheader', { name: /People/ }))).toBeCloseTo(edge, 0);
    await expect(textStart(archived)).toBeCloseTo(edge, 0);
    await expect(textStart(trigger)).toBeCloseTo(edge, 0);
    // The handle sits before the content edge, in the gutter, not in a column of its own.
    const handle = canvas.getByRole('button', { name: 'Move People' }).getBoundingClientRect();
    await expect(handle.right).toBeLessThanOrEqual(edge + 1);
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
          <SettingsRow title="Meetings a day">
            <Select
              label="Meetings a day"
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
