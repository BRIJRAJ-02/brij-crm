import type { Meta, StoryObj } from '@storybook/react-vite';
import { FieldSurfaces } from '../../workbench/FieldSurfaces/FieldSurfaces.tsx';
import { Stage } from '../../workbench/Stage/Stage.tsx';
import { FIELD_SAMPLES } from '../../workbench/field-samples.ts';
import { SiteIconsContext } from '../../provider/site-icons.ts';
import { AttributeDisplay } from '../AttributeDisplay.tsx';
import { AttributeEditor } from '../AttributeEditor.tsx';
import { expect, fn } from 'storybook/test';

const sample = FIELD_SAMPLES.domain;

const meta = {
  title: 'Fields/Domain field',
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

/** Several values: three show, then "+N" opens the rest. */
export const Several: Story = {
  render: () => (
    <FieldSurfaces
      attribute={sample.several?.attribute ?? sample.attribute}
      value={sample.several?.value}
      display={sample.several?.display}
      maxVisible={3}
    />
  ),
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
    await userEvent.click(canvas.getByRole('textbox', { name: 'Domain' }));
    await userEvent.keyboard('https://www.Northwind.com/about');
    await userEvent.tab();
    await expect(args.onCommit).toHaveBeenCalledWith('www.northwind.com');
  },
};

/** Invalid input shows how to fix it, and commits nothing. */
export const Invalid: Story = {
  parameters: { crm: { screenshot: false } },
  args: {},
  render: (args) => (
    <Stage width="narrow">
      <AttributeEditor {...args} />
    </Stage>
  ),
  play: async ({ canvas, args, userEvent }) => {
    await userEvent.click(canvas.getByRole('textbox', { name: 'Domain' }));
    await userEvent.keyboard('north wind.com');
    await userEvent.tab();
    await expect(canvas.getByText('Enter a domain, such as example.com, with no spaces.')).toBeInTheDocument();
    await expect(args.onCommit).not.toHaveBeenCalled();
  },
};

/** Empty, in a form: an example domain as the placeholder, and a hint that a pasted link is cut down to its domain. */
export const Guidance: Story = {
  parameters: { crm: { screenshot: false } },
  render: (args) => (
    <Stage width="narrow">
      <AttributeEditor {...args} />
    </Stage>
  ),
  play: async ({ canvas }) => {
    await expect(canvas.getByRole('textbox', { name: 'Domain' })).toHaveAttribute('placeholder', 'example.com');
    await expect(canvas.getByText('Just the domain. A pasted link is cut down to it.')).toBeInTheDocument();
  },
};

/**
 * On the record panel a domain has Copy after it. Where the app says where site icons come from
 * (`SiteIconsContext`, off in the web app until the api serves them), its first letter stands in while the icon
 * loads or when there is none.
 */
export const SiteIconAndCopy: Story = {
  render: () => (
    <SiteIconsContext value={() => '/missing-icon.png'}>
      <Stage>
        <AttributeDisplay attribute={sample.attribute} value={sample.value as never} surface="panel" />
      </Stage>
    </SiteIconsContext>
  ),
  play: async ({ canvas }) => {
    await expect(canvas.getByRole('button', { name: 'Copy northwind.com' })).toBeInTheDocument();
    await expect(await canvas.findByText('N')).toBeInTheDocument();
  },
};
