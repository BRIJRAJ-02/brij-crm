import type { RecordRefDisplay } from '@crm/contracts/values';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState } from 'react';
import { expect, waitFor } from 'storybook/test';
import { Button } from '../../atoms/Button/Button.tsx';
import { arraySource } from '../../lib/list-source.ts';
import { Callout } from '../../molecules/Callout/Callout.tsx';
import { SAMPLE_COMPANIES } from '../../workbench/field-samples.ts';
import { SAMPLE_ACTIVITY, SAMPLE_RECORD, sampleDetails, sampleEditorProps } from '../../workbench/record-samples.ts';
import { Stage } from '../../workbench/Stage/Stage.tsx';
import { ActivityFeed } from '../ActivityFeed/ActivityFeed.tsx';
import { AttributeList } from '../AttributeList/AttributeList.tsx';
import { RecordHeader } from '../RecordHeader/RecordHeader.tsx';
import { RecordLayout } from './RecordLayout.tsx';

const NORTHWIND = SAMPLE_COMPANIES[0] as RecordRefDisplay;
const TABS = [
  { id: 'overview', label: 'Overview', icon: 'layout-dashboard' as const },
  { id: 'activity', label: 'Activity', icon: 'activity' as const },
];

interface SampleProps {
  readonly width?: 'auto' | 'narrow';
  readonly isLoading?: boolean;
  readonly isReadOnly?: boolean;
  readonly startTab?: string;
}

/** A company's page as the record page draws it: header, Overview and Activity, and its details. */
function SamplePage({ width = 'auto', isLoading = false, isReadOnly = false, startTab = 'activity' }: SampleProps) {
  const [tab, setTab] = useState(startTab);
  const [values, setValues] = useState(SAMPLE_RECORD.values);
  const feed = arraySource(SAMPLE_ACTIVITY, (entry) => entry.id);
  return (
    <Stage width={width} height="page">
      <RecordLayout
        header={
          <RecordHeader record={NORTHWIND} objectName="Company" isLoading={isLoading}>
            <Button variant="ghost" icon="link">
              Copy link
            </Button>
          </RecordHeader>
        }
        tabs={TABS}
        selectedTab={tab}
        onTabChange={setTab}
        sidebarLabel="Details"
        isLoading={isLoading}
        {...(isReadOnly
          ? {
              notice: (
                <Callout tone="danger" placement="banner">
                  This company was deleted.
                </Callout>
              ),
            }
          : {})}
        sidebar={
          <AttributeList
            label="Details"
            sections={sampleDetails(values)}
            isLoading={isLoading}
            editorProps={sampleEditorProps}
            {...(isReadOnly
              ? {}
              : {
                  onCommit: (attributeId: string, value: unknown) => {
                    setValues((previous) => ({ ...previous, [attributeId]: value }));
                  },
                })}
          />
        }
      >
        {tab === 'activity' ? (
          <ActivityFeed label="Activity" entries={feed} status={isLoading ? 'loading' : 'ready'} />
        ) : (
          <ActivityFeed
            label="Recent activity"
            entries={arraySource(SAMPLE_ACTIVITY.slice(0, 2), (entry) => entry.id)}
            status={isLoading ? 'loading' : 'ready'}
          />
        )}
      </RecordLayout>
    </Stage>
  );
}

const meta = {
  title: 'Modules/RecordLayout',
  component: SamplePage,
} satisfies Meta<typeof SamplePage>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Wide: the header and tabs in the main column, and the details in the sidebar on the right. */
export const Wide: Story = {
  play: async ({ canvas, userEvent }) => {
    const sidebar = canvas.getByRole('complementary', { name: 'Details' });
    await expect(sidebar).toBeInTheDocument();
    await expect(canvas.getByRole('region', { name: 'Details' })).toBeInTheDocument();
    await expect(canvas.getByRole('feed', { name: 'Activity' })).toBeInTheDocument();
    // The arrows move between tabs, and the chosen tab's panel follows.
    await userEvent.click(canvas.getByRole('tab', { name: 'Activity' }));
    await userEvent.keyboard('{ArrowLeft}');
    await waitFor(() => expect(canvas.getByRole('tab', { name: 'Overview' })).toHaveAttribute('aria-selected', 'true'));
    await expect(canvas.getByRole('feed', { name: 'Recent activity' })).toBeInTheDocument();
  },
};

/** Narrow (below bp-container-md): the details fold into a closed Disclosure above the tabs. */
export const Narrow: Story = {
  args: { width: 'narrow' },
  play: async ({ canvas, userEvent }) => {
    const toggle = await canvas.findByRole('button', { name: 'Details' });
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await expect(canvas.getByRole('feed', { name: 'Activity' })).toBeInTheDocument();
    await userEvent.click(toggle);
    await expect(toggle).toHaveAttribute('aria-expanded', 'true');
    await expect(canvas.getByRole('button', { name: 'Edit Domain' })).toBeInTheDocument();
  },
};

/** The record is still coming: the page is busy, and the header, details and feed hold their places. */
export const Loading: Story = {
  args: { isLoading: true },
  play: async ({ canvasElement }) => {
    await expect(canvasElement.querySelector('[aria-busy="true"]')).not.toBeNull();
  },
};

/** Read only (a deleted record): the danger notice over the page, and details with no editors. */
export const ReadOnly: Story = {
  args: { isReadOnly: true },
  play: async ({ canvas }) => {
    await expect(canvas.getByRole('alert')).toHaveTextContent('This company was deleted.');
    await expect(canvas.queryByRole('button', { name: 'Edit Domain' })).toBeNull();
  },
};
