import type { PublicForm } from '@crm/contracts/forms';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { useEffect, useState } from 'react';
import { expect, userEvent, waitFor, within } from 'storybook/test';
import { Button } from '../../atoms/Button/Button.tsx';
import { Callout } from '../../molecules/Callout/Callout.tsx';
import { Card } from '../../molecules/Card/Card.tsx';
import { Field } from '../../molecules/Field/Field.tsx';
import { Select } from '../../molecules/Select/Select.tsx';
import { TabPanel, Tabs } from '../../molecules/Tabs/Tabs.tsx';
import { Stage } from '../../workbench/Stage/Stage.tsx';
import { HostedFormPreview } from '../HostedFormPreview/HostedFormPreview.tsx';
import { EditorStatus, PreviewFrame, PreviewLayout } from './PreviewLayout.tsx';

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

/**
 * A stand in wordmark, as HostedFormPreview's own stories use: the default
 * logo is a file the web app serves, which Storybook doesn't, so it drew as a
 * broken image with its alt text showing.
 */
const wordmark = (fill: string) =>
  `data:image/svg+xml,${encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 860 210"><rect x="0" y="40" width="130" height="130" rx="65" fill="${fill}"/><rect x="170" y="70" width="660" height="70" rx="12" fill="${fill}"/></svg>`,
  )}`;
const LOGO = { light: wordmark('black'), dark: wordmark('white') };

const meta = {
  title: 'Modules/PreviewLayout',
  component: PreviewLayout,
  args: { children: null },
} satisfies Meta<typeof PreviewLayout>;

export default meta;
type Story = StoryObj<typeof meta>;

/** The booking page editor: its sections across the first two thirds, beside the page in a phone. */
function PageEditorExample({ hasFooter = false }: { readonly hasFooter?: boolean }) {
  return (
    <Stage height="page" width="fill">
      <PreviewLayout
        preview={<PreviewFrame src="about:blank" title="Intro call" />}
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
        <Card title="Details">
          <Field label="Description" value="" placeholder="What the meeting is for" isMultiline />
        </Card>
        <Card title="Sharing">
          <Field label="Address" value="intro-call" prefix="timefix.com/ada/" />
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
      preview={<HostedFormPreview form={FORM} logo={LOGO} />}
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

/** The booking page editor: its sections in the first two thirds, the page in a phone centred in the last. */
export const Default: Story = {
  parameters: { crm: { preview: true } },
  render: () => <PageEditorExample />,
  play: async ({ canvas }) => {
    await expect(canvas.getByRole('complementary', { name: 'Preview' })).toBeInTheDocument();
    await expect(canvas.getByTitle('Preview of Intro call')).toBeInTheDocument();
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

/** Narrow: the phone waits behind a Preview button over the body, and opens in a sheet. */
export const Narrow: Story = {
  render: () => (
    <Stage width="narrow">
      <PreviewLayout preview={<HostedFormPreview form={FORM} logo={LOGO} />}>
        <Card title="The basics">
          <Field label="Name" value="Contact us" />
        </Card>
      </PreviewLayout>
    </Stage>
  ),
  play: async ({ canvas }) => {
    await expect(canvas.queryByRole('complementary', { name: 'Preview' })).not.toBeInTheDocument();
    await userEvent.click(canvas.getByRole('button', { name: 'Preview' }));
    const sheet = within(document.body).getByRole('dialog', { name: 'Preview' });
    await expect(
      within(sheet).getByRole('heading', { name: 'Fill this in and we will come back to you' }),
    ).toBeInTheDocument();
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
        preview={<HostedFormPreview form={FORM} logo={LOGO} />}
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

/** No preview, a tab of fields in a readable column centred in the width (the `form` width, which no screen uses now). */
export const FormWidth: Story = {
  render: () => (
    <Stage height="page" width="fill">
      <PreviewLayout bodyWidth="form">
        <Card title="Meeting">
          <Field label="Title" value="Intro call" />
        </Card>
        <Card title="Profile">
          <Field label="Section" value="Sales" />
        </Card>
      </PreviewLayout>
    </Stage>
  ),
};

/** Groups in as many columns as fit (a settings tab), the preview beside them. */
export const Grid: Story = {
  render: () => (
    <Stage height="page" width="fill">
      <PreviewLayout bodyLayout="grid" preview={<HostedFormPreview form={FORM} logo={LOGO} />}>
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

/** A long form: it runs past the phone's foot, so the screen scrolls and takes focus to be scrolled by keyboard. */
export const LongPreview: Story = {
  render: function Render() {
    const long: PublicForm = {
      ...FORM,
      questions: Array.from({ length: 12 }, (_, at) => ({
        id: `q${String(at)}`,
        key: `answer${String(at)}`,
        label: `Question ${String(at + 1)}`,
        answerType: 'short_text' as const,
        required: false,
      })),
    };
    return (
      <Stage height="page" width="fill">
        <PreviewLayout preview={<HostedFormPreview form={long} logo={LOGO} />}>
          <Card title="Questions" description="12 questions">
            <Field label="Headline" value="Fill this in and we will come back to you" />
          </Card>
        </PreviewLayout>
      </Stage>
    );
  },
  play: async ({ canvas }) => {
    const screen = await waitFor(() => canvas.getByRole('region', { name: 'Phone preview' }));
    await expect(screen).toHaveAttribute('tabindex', '0');
  },
};

/**
 * A stand in for a booking page in the frame: lines of text down to a "Powered by" foot, taller than the phone,
 * written into the frame's own empty page (a story has no booking page to serve). As on a booking page, they arrive
 * a moment after the frame loads (its data), inside a root the window's height (the app's mount point) that they
 * spill out of, so the document's own size never changes.
 */
function writeLongPage(frame: HTMLIFrameElement) {
  const page = frame.contentDocument;
  if (page === null || page.getElementById('foot') !== null) return;
  const root = page.createElement('div');
  root.style.blockSize = '100dvb';
  page.body.style.margin = '0';
  page.body.append(root);
  setTimeout(() => {
    const lines = Array.from({ length: 60 }, (_, at) => {
      const line = page.createElement('p');
      line.textContent = `Line ${String(at + 1)} of the page`;
      return line;
    });
    const foot = page.createElement('p');
    foot.id = 'foot';
    foot.textContent = 'Powered by Timefix';
    root.append(...lines, foot);
  }, 100);
}

/** The booking page editor with a page longer than the phone in its frame, written again whenever it loads. */
function LongPageExample() {
  useEffect(() => {
    const frame = document.querySelector('iframe[title="Preview of Intro call"]');
    if (!(frame instanceof HTMLIFrameElement)) return;
    const write = () => {
      writeLongPage(frame);
    };
    write();
    frame.addEventListener('load', write);
    return () => {
      frame.removeEventListener('load', write);
    };
  }, []);
  return <PageEditorExample />;
}

/** A wheel turned over `target`, in pixels; false when it was taken (its default prevented). */
function wheel(target: Element, deltaY: number) {
  return target.dispatchEvent(new WheelEvent('wheel', { deltaY, bubbles: true, cancelable: true }));
}

/** A finger dragged over `target`, from `from` to `to` down the screen. */
function drag(target: Element, from: number, to: number) {
  const box = target.getBoundingClientRect();
  const at = (clientY: number) => ({
    pointerId: 7,
    pointerType: 'touch',
    isPrimary: true,
    clientX: box.x + 20,
    clientY,
    bubbles: true,
  });
  target.dispatchEvent(new PointerEvent('pointerdown', at(from)));
  target.dispatchEvent(new PointerEvent('pointermove', at(to)));
  target.dispatchEvent(new PointerEvent('pointerup', at(to)));
}

/** The page in the frame: its window, and how far its foot sits under the phone's screen (none once in view). */
function pageOf(frame: HTMLIFrameElement) {
  const view = frame.contentWindow;
  const foot = frame.contentDocument?.getElementById('foot');
  if (view === null || foot === null || foot === undefined) throw new Error('the frame has no long page');
  return { view, footBelow: () => foot.getBoundingClientRect().bottom - view.innerHeight };
}

/**
 * A page longer than the phone (a booking page and its "Powered by" foot): the frame is inert, so a wheel over the
 * phone scrolls the page for it, and the screen becomes a "Phone preview" region whose keys scroll it to its foot.
 */
export const LongPage: Story = {
  render: () => <LongPageExample />,
  parameters: { crm: { screenshot: false } },
  play: async ({ canvas, step }) => {
    const region = await waitFor(() => canvas.getByRole('region', { name: 'Phone preview' }));
    await expect(region).toHaveAttribute('tabindex', '0');
    const frame = canvas.getByTitle('Preview of Intro call');
    if (!(frame instanceof HTMLIFrameElement)) throw new Error('no frame');
    // The lines arrive a moment after the frame loads, as a booking page's data does; Firefox loads the frame's
    // own page later than Chromium, so the play waits for them rather than reading the page at once.
    const { view, footBelow } = await waitFor(() => pageOf(frame));
    await expect(footBelow()).toBeGreaterThan(0);

    await step('a wheel over the phone scrolls the page, not the editor', async () => {
      // Taken by the page, so the editor behind stays put.
      await expect(wheel(region, 200)).toBe(false);
      await expect(view.scrollY).toBeGreaterThan(0);
      await expect(wheel(region, -400)).toBe(false);
      await expect(view.scrollY).toBe(0);
    });

    await step('a finger dragged up the phone scrolls the page, not the sheet around it', async () => {
      await expect(getComputedStyle(region).touchAction).toBe('none');
      const box = region.getBoundingClientRect();
      drag(region, box.y + 300, box.y + 100);
      await expect(view.scrollY).toBeGreaterThan(100);
      drag(region, box.y + 100, box.y + 500);
      await expect(view.scrollY).toBe(0);
    });

    await step('the keys scroll it, down to its foot', async () => {
      region.focus();
      await userEvent.keyboard('{ArrowDown}');
      await expect(view.scrollY).toBe(40);
      await userEvent.keyboard('{PageDown}');
      await waitFor(() => expect(view.scrollY).toBeGreaterThan(40));
      await userEvent.keyboard('{End}');
      await waitFor(() => expect(footBelow()).toBeLessThanOrEqual(0));
      await userEvent.keyboard('{Home}');
      await waitFor(() => expect(view.scrollY).toBe(0));
    });

    await step('at its top, a new wheel upward goes on to the editor', async () => {
      // A new gesture: past the gap that joins wheel events into one.
      await new Promise((resolve) => setTimeout(resolve, 200));
      await expect(wheel(region, -100)).toBe(true);
    });
  },
};
