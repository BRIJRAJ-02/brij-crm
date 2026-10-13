import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState } from 'react';
import { expect, fn } from 'storybook/test';
import { Stage } from '../../workbench/Stage/Stage.tsx';
import { Rating } from './Rating.tsx';

const meta = {
  title: 'Atoms/Rating',
  component: Rating,
  args: { label: 'Fit', onChange: fn() },
} satisfies Meta<typeof Rating>;

export default meta;
type Story = StoryObj<typeof meta>;

function Editable({ onChange }: { readonly onChange?: (value: number | null) => void }) {
  const [value, setValue] = useState<number | null>(3);
  return (
    <Rating
      label="Fit"
      value={value}
      onChange={(next) => {
        setValue(next);
        onChange?.(next);
      }}
    />
  );
}

/** Arrow keys change it; Delete clears it. */
export const Default: Story = {
  render: (args) => (
    <Stage>
      <Editable {...(args.onChange === undefined ? {} : { onChange: args.onChange })} />
    </Stage>
  ),
  play: async ({ canvas, args, userEvent }) => {
    await userEvent.tab();
    await expect(canvas.getByRole('radio', { name: '3 stars' })).toHaveFocus();
    await userEvent.keyboard('{ArrowRight}');
    await expect(args.onChange).toHaveBeenLastCalledWith(4);
    await userEvent.keyboard('{Delete}');
    await expect(args.onChange).toHaveBeenLastCalledWith(null);
  },
};

/** Choosing the chosen star again clears it. */
export const ClearByChoosingAgain: Story = {
  parameters: { crm: { screenshot: false } },
  render: (args) => (
    <Stage>
      <Editable {...(args.onChange === undefined ? {} : { onChange: args.onChange })} />
    </Stage>
  ),
  play: async ({ canvas, args, userEvent }) => {
    await userEvent.click(canvas.getByRole('radio', { name: '3 stars' }));
    await expect(args.onChange).toHaveBeenLastCalledWith(null);
  },
};

/** The display: read only stars, one image with the rating in words. */
export const ReadOnly: Story = {
  parameters: { crm: { preview: true } },
  render: () => (
    <Stage direction="column">
      <Rating label="Fit" value={4} isReadOnly />
      <Rating label="Fit" value={1} isReadOnly />
      <Rating label="Fit" value={null} isReadOnly />
    </Stage>
  ),
  play: async ({ canvas }) => {
    await expect(canvas.getByRole('img', { name: 'Fit: 4 out of 5 stars' })).toBeInTheDocument();
    await expect(canvas.getByRole('img', { name: 'Fit: no rating' })).toBeInTheDocument();
  },
};

/** Disabled. */
export const Disabled: Story = {
  args: { value: 2, isDisabled: true },
};

/** Under a pointer the stars preview the hovered rating: hovering the fifth lights all five, the first lights one. */
export const HoverPreview: Story = {
  render: (args) => (
    <Stage>
      <Editable {...(args.onChange === undefined ? {} : { onChange: args.onChange })} />
    </Stage>
  ),
  play: async ({ canvas, canvasElement, userEvent }) => {
    const star = (count: number) =>
      canvas.getByRole('radio', { name: count === 1 ? '1 star' : `${String(count)} stars` }).closest('label');
    const lit = () => canvasElement.querySelectorAll('[data-on]').length;
    await expect(lit()).toBe(3);
    await userEvent.hover(star(5) ?? canvasElement);
    await expect(lit()).toBe(5);
    await userEvent.hover(star(1) ?? canvasElement);
    await expect(lit()).toBe(1);
    await userEvent.unhover(star(1) ?? canvasElement);
    await expect(lit()).toBe(3);
  },
};
