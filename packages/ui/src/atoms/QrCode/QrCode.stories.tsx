import type { Meta, StoryObj } from '@storybook/react-vite';
import { QrCode } from './QrCode.tsx';

const meta = {
  title: 'Atoms/QrCode',
  component: QrCode,
  args: {
    value: 'otpauth://totp/Timefix:ada%40example.com?secret=JBSWY3DPEHPK3PXP&issuer=Timefix&digits=6&period=30',
    label: 'QR code for your authenticator app',
  },
} satisfies Meta<typeof QrCode>;

export default meta;
type Story = StoryObj<typeof meta>;

/** A setup address, as two factor shows it. */
export const Default: Story = {};

/** A longer value makes a denser code in the same space. */
export const Dense: Story = {
  args: { value: `otpauth://totp/Timefix:${'a'.repeat(60)}%40example.com?secret=${'J'.repeat(52)}&issuer=Timefix` },
};
