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

/** Code, then the amount, with the currency's two minor units. */
export const Default: Story = {
  play: async ({ canvas }) => {
    await expect(canvas.getByText('1,234.50')).toBeInTheDocument();
    await expect(canvas.getByText('USD')).toBeInTheDocument();
  },
};

/** Several currencies: yen has no minor units, and four decimals stay exact. */
export const Currencies: Story = {
  parameters: { crm: { preview: true } },
  render: () => (
    <Stage direction="column">
      <Currency value={{ amount: '48000', currency: 'EUR' }} />
      <Currency value={{ amount: '1250000', currency: 'JPY' }} />
      <Currency value={{ amount: '0.1234', currency: 'GBP' }} />
      <Currency value={{ amount: '-320.5', currency: 'CHF' }} />
    </Stage>
  ),
  play: async ({ canvas }) => {
    await expect(canvas.getByText('1,250,000')).toBeInTheDocument();
    await expect(canvas.getByText('0.1234')).toBeInTheDocument();
  },
};
