import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState } from 'react';
import { expect, userEvent, waitFor } from 'storybook/test';
import { Stage } from '../../workbench/Stage/Stage.tsx';
import { Slider, type SliderProps } from './Slider.tsx';

/** A Slider holding its own value, as a screen does. */
function Held(props: Omit<SliderProps, 'value' | 'onChange'> & { readonly start: number }) {
  const { start, ...rest } = props;
  const [value, setValue] = useState(start);
  return <Slider {...rest} value={value} onChange={setValue} />;
}

const meta = {
  title: 'Atoms/Slider',
  component: Slider,
  args: { label: 'Zoom', value: 1, onChange: () => undefined },
} satisfies Meta<typeof Slider>;

export default meta;
type Story = StoryObj<typeof meta>;

/** A photo's zoom, its value as a percentage beside the label. The arrows step it. */
export const Default: Story = {
  parameters: { crm: { preview: true } },
  render: () => (
    <Stage width="narrow">
      <Held
        label="Zoom"
        start={1.5}
        minValue={1}
        maxValue={4}
        step={0.01}
        formatOptions={{ style: 'percent' }}
        showsValue
      />
    </Stage>
  ),
  play: async ({ canvas }) => {
    const slider = canvas.getByRole('slider', { name: 'Zoom' });
    await expect(slider).toHaveAttribute('aria-valuetext', '150%');
    slider.focus();
    await userEvent.keyboard('{ArrowRight}');
    await expect(slider).toHaveAttribute('aria-valuetext', '151%');
    await userEvent.keyboard('{End}');
    await expect(slider).toHaveAttribute('aria-valuetext', '400%');
  },
};

/** The value bubble over the thumb (the prototype's), shown while the thumb has keyboard focus, hidden from screen
 * readers since the thumb's input already says the value. */
export const ValueBubble: Story = {
  render: () => (
    <Stage width="narrow">
      <Held label="Notice" start={24} minValue={0} maxValue={48} />
    </Stage>
  ),
  play: async ({ canvas, canvasElement }) => {
    await userEvent.tab();
    await expect(canvas.getByRole('slider', { name: 'Notice' })).toHaveFocus();
    const bubble = canvasElement.querySelector('output[aria-hidden="true"]');
    await expect(bubble).toHaveTextContent('24');
    await waitFor(() => expect(bubble === null ? '' : getComputedStyle(bubble).opacity).toBe('1'));
  },
};

/** The label for screen readers only, where the slider's place names it. */
export const LabelHidden: Story = {
  render: () => (
    <Stage width="narrow">
      <Held label="Zoom" isLabelHidden start={40} />
    </Stage>
  ),
  play: async ({ canvas }) => {
    await expect(canvas.getByRole('slider', { name: 'Zoom' })).toHaveValue('40');
  },
};

/** Disabled: faded, and takes no keys. */
export const Disabled: Story = {
  render: () => (
    <Stage width="narrow">
      <Held label="Zoom" start={20} isDisabled showsValue />
    </Stage>
  ),
  play: async ({ canvas }) => {
    await expect(canvas.getByRole('slider', { name: 'Zoom' })).toBeDisabled();
  },
};
