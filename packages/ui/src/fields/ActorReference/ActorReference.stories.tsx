import type { Meta, StoryObj } from '@storybook/react-vite';
import { arraySource } from '../../lib/list-source.ts';
import { FieldSurfaces } from '../../workbench/FieldSurfaces/FieldSurfaces.tsx';
import { Stage } from '../../workbench/Stage/Stage.tsx';
import { FIELD_SAMPLES, SAMPLE_MEMBERS } from '../../workbench/field-samples.ts';
import { SAMPLE_IDS } from '../../workbench/sample-ids.ts';
import { AttributeEditor } from '../AttributeEditor.tsx';
import { expect, fn, waitFor } from 'storybook/test';

const sample = FIELD_SAMPLES.actor_reference;

const meta = {
  title: 'Fields/Actor reference field',
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
  args: {
    me: SAMPLE_MEMBERS[0],
    onSearch: ((query: string) =>
      arraySource(
        SAMPLE_MEMBERS.filter((member) => member.name.toLowerCase().includes(query.toLowerCase())),
        (member) => member.id ?? member.name,
      )) as never,
  },
  render: (args) => (
    <Stage width="narrow">
      <AttributeEditor {...args} />
    </Stage>
  ),
  play: async ({ canvas, args, userEvent }) => {
    await userEvent.click(canvas.getByRole('button', { name: /Choose Owner/ }));
    const menu = await waitFor(() => {
      const found = document.querySelector('[role="menu"]');
      if (found === null) throw new Error('the menu did not open');
      return found;
    });
    const me = await waitFor(() => {
      const item = [...menu.querySelectorAll('[role="menuitem"]')].find((node) => node.textContent.includes('Me'));
      if (item === undefined) throw new Error('no Me');
      return item;
    });
    await userEvent.click(me);
    await expect(args.onCommit).toHaveBeenCalledWith({ type: 'member', id: SAMPLE_IDS.member.ada });
    // The menu fades out; let it finish before the accessibility check reads colours.
    await waitFor(() => expect(document.querySelector('[role="menu"]')).toBeNull());
  },
};
