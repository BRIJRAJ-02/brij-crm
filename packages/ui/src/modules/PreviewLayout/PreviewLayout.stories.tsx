import type { PublicForm } from '@crm/contracts/forms';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState } from 'react';
import { expect, userEvent } from 'storybook/test';
import { Button } from '../../atoms/Button/Button.tsx';
import { Callout } from '../../molecules/Callout/Callout.tsx';
import { Card } from '../../molecules/Card/Card.tsx';
import { Field } from '../../molecules/Field/Field.tsx';
import { Select } from '../../molecules/Select/Select.tsx';
import { TabPanel, Tabs } from '../../molecules/Tabs/Tabs.tsx';
import { Stage } from '../../workbench/Stage/Stage.tsx';
import { HostedFormPreview } from '../HostedFormPreview/HostedFormPreview.tsx';
import {
  EditorStatus,
  PreviewDeviceSwitch,
  PreviewFrame,
  PreviewLayout,
  type PreviewDevice,
} from './PreviewLayout.tsx';

const FORM: PublicForm = {
  key: 'contact-us',
  status: 'live',
  versionNumber: 7,
  headline: 'Fill this in and we will come back to you',
  buttonText: 'Send',
  language: 'en',
  look: { colour: 'light', corners: 'rounded' },
  offersMeeting: false,
  questions: [
    { id: 'q1', key: 'name', label: 'Your name', answerType: 'short_text', required: true },
    { id: 'q2', key: 'email', label: 'Work email', answerType: 'email', required: true },
  ],
};

const meta = {
  title: 'Modules/PreviewLayout',
  component: PreviewLayout,
  args: { children: null },
} satisfies Meta<typeof PreviewLayout>;

export default meta;
type Story = StoryObj<typeof meta>;

/** The booking page editor: its groups beside the page in a frame, with the width switch. */
function PageEditorExample({ hasFooter = false }: { readonly hasFooter?: boolean }) {
  const [device, setDevice] = useState<PreviewDevice>('phone');
  return (
    <Stage height="page" width="fill">
      <PreviewLayout
        previewControls={<PreviewDeviceSwitch value={device} onChange={setDevice} />}
        preview={<PreviewFrame src="about:blank" title="Intro call" device={device} />}
        {...(hasFooter
          ? {
              footer: (
                <Callout tone="info" actions={<Button variant="primary">Save</Button>}>
                  Unsaved changes
                </Callout>
              ),
            }
          : {})}
      >
        <Card title="Page" description="/intro-call">
          <Field label="Description" value="" isMultiline />
        </Card>
        <Card title="Meeting" description="30 min · Video">
          <Field label="Title" value="Intro call" />
        </Card>
      </PreviewLayout>
    </Stage>
  );
}

/** The form editor: the tabs, a notice, and the drawn form beside the fields with its look. */
function FormEditorExample() {
  const [tab, setTab] = useState('settings');
  const layout = (
    <PreviewLayout
      notices={<Callout tone="danger">Every question needs a label.</Callout>}
      previewControls={
        <>
          <Select
            label="Colour"
            isLabelHidden
            size="sm"
            items={[
              { id: 'light', label: 'Light form' },
              { id: 'dark', label: 'Dark form' },
            ]}
            defaultValue="light"
          />
          <Select
            label="Corners"
            isLabelHidden
            size="sm"
            items={[
              { id: 'rounded', label: 'Rounded corners' },
              { id: 'square', label: 'Square corners' },
            ]}
            defaultValue="rounded"
          />
        </>
      }
      preview={<HostedFormPreview form={FORM} />}
    >
      <Card title="The basics" description="Contact us · /f/contact-us">
        <Field label="Name" value="Contact us" />
      </Card>
    </PreviewLayout>
  );
  return (
    <Stage height="page" width="fill">
      <Tabs
        label="Form sections"
        selectedKey={tab}
        onSelectionChange={setTab}
        tabs={[
          { id: 'form', label: 'Form' },
          { id: 'settings', label: 'Settings' },
        ]}
      >
        <TabPanel id="form">{tab === 'form' && layout}</TabPanel>
        <TabPanel id="settings">{tab === 'settings' && layout}</TabPanel>
      </Tabs>
    </Stage>
  );
}

/** The booking page editor: its groups beside a phone width preview; the switch widens it. */
export const Default: Story = {
  parameters: { crm: { preview: true } },
  render: () => <PageEditorExample />,
  play: async ({ canvas }) => {
    const [tablet] = canvas.getAllByRole('radio', { name: 'Tablet' });
    if (tablet !== undefined) await userEvent.click(tablet);
    await expect(canvas.getAllByTitle('Preview of Intro call').length).toBeGreaterThan(0);
  },
};

/** The form editor: tabs, a refused publish's Callout, and the drawn form with its look. */
export const WithTabs: Story = {
  render: () => <FormEditorExample />,
  play: async ({ canvas }) => {
    // The column's header names it, with the look's Selects at its end.
    await expect(canvas.getByRole('complementary', { name: 'Preview' })).toBeInTheDocument();
    await expect(canvas.getByRole('heading', { name: 'Preview', level: 2 })).toBeInTheDocument();
    await expect(canvas.getByRole('button', { name: /Rounded corners/ })).toBeInTheDocument();
  },
};

/** Unsaved changes: the footer bar (the SaveBar's slot) pinned to the body's foot. */
export const WithFooter: Story = {
  render: () => <PageEditorExample hasFooter />,
  parameters: { crm: { screenshot: false } },
  play: async ({ canvas }) => {
    await expect(canvas.getByRole('button', { name: 'Save' })).toBeInTheDocument();
  },
};

/** Narrow: the preview waits under the body in "Show preview", drawn once opened. */
export const Narrow: Story = {
  render: () => (
    <Stage width="narrow">
      <PreviewLayout preview={<HostedFormPreview form={FORM} />}>
        <Card title="The basics">
          <Field label="Name" value="Contact us" />
        </Card>
      </PreviewLayout>
    </Stage>
  ),
  play: async ({ canvas }) => {
    await expect(canvas.queryByRole('complementary', { name: 'Preview' })).not.toBeInTheDocument();
    await userEvent.click(canvas.getByRole('button', { name: 'Show preview' }));
    await expect(canvas.getByRole('heading', { name: 'Fill this in and we will come back to you' })).toBeVisible();
  },
};

/** The TopBar's status, each tone: live green, changed orange, not published and paused gray. */
export const Status: Story = {
  render: () => (
    <Stage direction="column">
      <EditorStatus tone="live" text="Published · v7" />
      <EditorStatus tone="changed" text="Published · Unpublished changes" />
      <EditorStatus tone="draft" text="Not published" />
      <EditorStatus tone="paused" text="Not accepting" />
    </Stage>
  ),
};

/** A note over the preview: what it shows needs a word (a paused page shows its closed state). */
export const WithNote: Story = {
  render: () => (
    <Stage height="page" width="fill">
      <PreviewLayout
        previewNote={<Callout tone="info">This page is off, so visitors see it closed.</Callout>}
        preview={<HostedFormPreview form={FORM} />}
      >
        <Card title="Page" description="Anyone can book it">
          <Field label="Description" value="" isMultiline />
        </Card>
      </PreviewLayout>
    </Stage>
  ),
};

/** No preview: the body takes the whole width (a form's Install and Submissions). */
export const FullWidth: Story = {
  render: () => (
    <Stage height="page" width="fill">
      <PreviewLayout>
        <Card title="Submissions" description="No enquiries yet">
          <Field label="Search" value="" />
        </Card>
      </PreviewLayout>
    </Stage>
  ),
};

/** Groups in as many columns as fit (a settings tab), the preview beside them. */
export const Grid: Story = {
  render: () => (
    <Stage height="page" width="fill">
      <PreviewLayout bodyLayout="grid" preview={<HostedFormPreview form={FORM} />}>
        <Card title="After someone sends it" description="Shows a thank you message">
          <Field label="Thank you message" value="" isMultiline />
        </Card>
        <Card title="Where answers go" description="Each send creates or updates a Person">
          <Field label="Owner" value="" />
        </Card>
        <Card title="Name and address" description="/f/contact-us">
          <Field label="Name" value="Contact us" />
        </Card>
      </PreviewLayout>
    </Stage>
  ),
};
