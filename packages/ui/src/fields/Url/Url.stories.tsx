import type { Meta, StoryObj } from '@storybook/react-vite';
import { FieldSurfaces } from '../../workbench/FieldSurfaces/FieldSurfaces.tsx';
import { Stage } from '../../workbench/Stage/Stage.tsx';
import { attributeOf } from '../../workbench/attributes.ts';
import { FIELD_SAMPLES } from '../../workbench/field-samples.ts';
import { AttributeDisplay } from '../AttributeDisplay.tsx';
import { AttributeEditor } from '../AttributeEditor.tsx';
import { expect, fn } from 'storybook/test';

const sample = FIELD_SAMPLES.url;
const linkedin = attributeOf('url', 'LinkedIn', { apiSlug: 'linkedin' });
const twitter = attributeOf('url', 'Twitter', { apiSlug: 'twitter' });

/** One profile per network the display knows, and a link it doesn't. */
const PROFILES = [
  'https://linkedin.com/in/ada-lovelace',
  'https://x.com/adalovelace',
  'https://instagram.com/ada.lovelace',
  'https://github.com/adalovelace',
  'https://facebook.com/ada.lovelace',
  'https://youtube.com/@adalovelace',
  'https://wellfound.com/u/ada-lovelace',
  'https://tiktok.com/@adalovelace',
  'https://threads.com/@ada.lovelace',
  'https://www.northwind.com/pricing',
] as const;

const meta = {
  title: 'Fields/Url field',
  component: AttributeEditor,
  args: { attribute: sample.attribute, value: null, surface: 'form', onCommit: fn() },
} satisfies Meta<typeof AttributeEditor>;

export default meta;
type Story = StoryObj<typeof meta>;

/** The one display, on every surface. */
export const Display: Story = {
  parameters: { crm: { preview: true } },
  render: () => <FieldSurfaces attribute={sample.attribute} value={sample.value} display={sample.display} />,
};

/** Empty: nothing in a cell, a dash elsewhere, and "Empty" for screen readers. */
export const Empty: Story = {
  parameters: { crm: { screenshot: false } },
  render: () => <FieldSurfaces attribute={sample.attribute} value={null} />,
};

/** The one editor, in a form: what it commits parses with the type's schema (AC-5). */
export const Editor: Story = {
  args: {},
  render: (args) => (
    <Stage width="narrow">
      <AttributeEditor {...args} />
    </Stage>
  ),
  play: async ({ canvas, args, userEvent }) => {
    await userEvent.click(canvas.getByRole('textbox', { name: 'Website' }));
    await userEvent.keyboard('Example.com/Pricing');
    await userEvent.tab();
    await expect(args.onCommit).toHaveBeenCalledWith('https://example.com/Pricing');
  },
};

/** A plain link reads as its domain and path, without the protocol or www; it opens in a new tab. */
export const DisplayDomain: Story = {
  parameters: { crm: { screenshot: false } },
  render: () => (
    <Stage>
      <AttributeDisplay attribute={sample.attribute} value="https://www.northwind.com/pricing" surface="panel" />
    </Stage>
  ),
  play: async ({ canvas }) => {
    const link = canvas.getByRole('link', { name: 'northwind.com/pricing' });
    await expect(link).toHaveAttribute('href', 'https://www.northwind.com/pricing');
    await expect(link).toHaveAttribute('target', '_blank');
  },
};

/** A social profile: the network's mark and the handle, on every surface. */
export const SocialDisplay: Story = {
  render: () => <FieldSurfaces attribute={linkedin} value="https://linkedin.com/in/ada-lovelace" />,
  play: async ({ canvas }) => {
    await expect(canvas.getAllByRole('link', { name: 'LinkedIn ada-lovelace' }).length).toBeGreaterThan(0);
  },
};

/** Every network the display knows, then a link to anywhere else, in a record's panel. */
export const Networks: Story = {
  parameters: { crm: { screenshot: false } },
  render: () => (
    <Stage direction="column">
      {PROFILES.map((url) => (
        <AttributeDisplay key={url} attribute={sample.attribute} value={url} surface="panel" />
      ))}
    </Stage>
  ),
  play: async ({ canvas }) => {
    await expect(canvas.getByRole('link', { name: 'X @adalovelace' })).toBeInTheDocument();
    await expect(canvas.getByRole('link', { name: 'GitHub adalovelace' })).toBeInTheDocument();
    await expect(canvas.getByRole('link', { name: 'YouTube @adalovelace' })).toBeInTheDocument();
    await expect(canvas.getByRole('link', { name: 'northwind.com/pricing' })).toBeInTheDocument();
  },
};

/** A network's editor takes a handle, with or without @, and keeps the profile's link. */
export const SocialEditor: Story = {
  args: { attribute: twitter },
  render: (args) => (
    <Stage width="narrow">
      <AttributeEditor {...args} />
    </Stage>
  ),
  play: async ({ canvas, args, userEvent }) => {
    const field = canvas.getByRole('textbox', { name: 'Twitter' });
    await expect(field).toHaveAttribute('placeholder', '@adalovelace');
    await expect(canvas.getByText('A handle on Twitter, or a link to the profile.')).toBeInTheDocument();
    await userEvent.click(field);
    await userEvent.keyboard('@AdaLovelace');
    await userEvent.tab();
    await expect(args.onCommit).toHaveBeenCalledWith('https://x.com/AdaLovelace');
  },
};

/** A profile link pasted from the browser loses its www, trailing slash and tracking. */
export const SocialEditorLink: Story = {
  parameters: { crm: { screenshot: false } },
  args: { attribute: linkedin },
  render: (args) => (
    <Stage width="narrow">
      <AttributeEditor {...args} />
    </Stage>
  ),
  play: async ({ canvas, args, userEvent }) => {
    await userEvent.click(canvas.getByRole('textbox', { name: 'LinkedIn' }));
    await userEvent.paste('https://www.linkedin.com/in/ada-lovelace/?utm_source=share');
    await userEvent.tab();
    await expect(args.onCommit).toHaveBeenCalledWith('https://linkedin.com/in/ada-lovelace');
  },
};

/** On a company, a bare LinkedIn handle is the company's page, and the example is a company's. */
export const CompanyHandle: Story = {
  parameters: { crm: { screenshot: false } },
  args: { attribute: attributeOf('url', 'LinkedIn', { apiSlug: 'linkedin', objectKey: 'companies' }) },
  render: (args) => (
    <Stage width="narrow">
      <AttributeEditor {...args} />
    </Stage>
  ),
  play: async ({ canvas, args, userEvent }) => {
    const field = canvas.getByRole('textbox', { name: 'LinkedIn' });
    await expect(field).toHaveAttribute('placeholder', 'northwind');
    await userEvent.click(field);
    await userEvent.keyboard('northwind');
    await userEvent.tab();
    await expect(args.onCommit).toHaveBeenCalledWith('https://linkedin.com/company/northwind');
  },
};

/** In a grid cell the label is hidden, so the field keeps "Set <Attribute>…" and the refusal names the example. */
export const InCell: Story = {
  parameters: { crm: { screenshot: false } },
  args: { attribute: twitter, surface: 'cell' },
  render: (args) => (
    <Stage width="narrow">
      <AttributeEditor {...args} />
    </Stage>
  ),
  play: async ({ canvas }) => {
    await expect(canvas.getByRole('textbox', { name: 'Twitter' })).toHaveAttribute('placeholder', 'Set Twitter…');
  },
};

/** A handle the network would not take: the field says what to type, in plain words, and commits nothing. */
export const SocialInvalid: Story = {
  args: { attribute: twitter },
  render: (args) => (
    <Stage width="narrow">
      <AttributeEditor {...args} />
    </Stage>
  ),
  play: async ({ canvas, args, userEvent }) => {
    await userEvent.click(canvas.getByRole('textbox', { name: 'Twitter' }));
    await userEvent.keyboard('ada lovelace');
    await userEvent.tab();
    await expect(
      canvas.getByText('Enter a handle on Twitter, such as @adalovelace, or a link to the profile.'),
    ).toBeInTheDocument();
    await expect(args.onCommit).not.toHaveBeenCalled();
  },
};

/** A plain link that isn't one: the field says what to type and commits nothing. */
export const Invalid: Story = {
  parameters: { crm: { screenshot: false } },
  render: (args) => (
    <Stage width="narrow">
      <AttributeEditor {...args} />
    </Stage>
  ),
  play: async ({ canvas, args, userEvent }) => {
    await userEvent.click(canvas.getByRole('textbox', { name: 'Website' }));
    await userEvent.keyboard('not a link');
    await userEvent.tab();
    await expect(
      canvas.getByText('Enter a web address, such as example.com or https://example.com/about.'),
    ).toBeInTheDocument();
    await expect(args.onCommit).not.toHaveBeenCalled();
  },
};

/** Several profiles: chips with their marks, each removable, and a field to add one more by handle. */
export const SeveralProfiles: Story = {
  parameters: { crm: { screenshot: false } },
  args: {
    attribute: attributeOf('url', 'LinkedIn', { apiSlug: 'linkedin', allowMultiple: true }),
    value: ['https://linkedin.com/in/ada-lovelace'],
  },
  render: (args) => (
    <Stage width="narrow">
      <AttributeEditor {...args} />
    </Stage>
  ),
  play: async ({ canvas, args, userEvent }) => {
    await expect(canvas.getByRole('link', { name: 'LinkedIn ada-lovelace' })).toBeInTheDocument();
    await userEvent.click(canvas.getByRole('textbox', { name: 'LinkedIn' }));
    await userEvent.keyboard('company/northwind{Enter}');
    await expect(args.onCommit).toHaveBeenCalledWith([
      'https://linkedin.com/in/ada-lovelace',
      'https://linkedin.com/company/northwind',
    ]);
  },
};

/** Read only: the chip, no editor. */
export const ReadOnly: Story = {
  parameters: { crm: { screenshot: false } },
  args: { attribute: { ...linkedin, isReadOnly: true }, value: 'https://linkedin.com/in/ada-lovelace' },
  render: (args) => (
    <Stage width="narrow">
      <AttributeEditor {...args} />
    </Stage>
  ),
};
