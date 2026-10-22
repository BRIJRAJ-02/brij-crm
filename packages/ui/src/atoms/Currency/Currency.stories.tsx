import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect } from 'storybook/test';
import { Stage } from '../../workbench/Stage/Stage.tsx';
import { Currency } from './Currency.tsx';

const meta = {
  title: 'Atoms/Currency',
  component: Currency,
  args: { value: { amount: '1234.5', currency: 'USD' } },
} satisfies Meta<typeof Currency>;

export default meta;
type Story = StoryObj<typeof meta>;

/** The symbol and the amount; a fraction shows the currency's two minor units. */
export const Default: Story = {
  play: async ({ canvas }) => {
    await expect(canvas.getByText('$1,234.50')).toBeInTheDocument();
  },
};

/** A whole amount shows no decimals, as CRMs write deal values. */
export const Whole: Story = {
  args: { value: { amount: '58500', currency: 'USD' } },
  play: async ({ canvas }) => {
    await expect(canvas.getByText('$58,500')).toBeInTheDocument();
  },
};

/** Several currencies: each its own symbol (Canadian dollars say CA$), and four decimals stay exact. */
export const Currencies: Story = {
  parameters: { crm: { preview: true } },
  render: () => (
    <Stage direction="column">
      <Currency value={{ amount: '48000', currency: 'EUR' }} />
      <Currency value={{ amount: '1250000', currency: 'JPY' }} />
      <Currency value={{ amount: '0.1234', currency: 'GBP' }} />
      <Currency value={{ amount: '-320.5', currency: 'CHF' }} />
      <Currency value={{ amount: '12', currency: 'CAD' }} />
    </Stage>
  ),
  play: async ({ canvas }) => {
    await expect(canvas.getByText('¥1,250,000')).toBeInTheDocument();
    await expect(canvas.getByText('£0.1234')).toBeInTheDocument();
    await expect(canvas.getByText('CA$12')).toBeInTheDocument();
  },
};
