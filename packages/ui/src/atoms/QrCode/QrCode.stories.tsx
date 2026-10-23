import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect } from 'storybook/test';
import { Stage } from '../../workbench/Stage/Stage.tsx';
import { CodeInput } from '../../molecules/CodeInput/CodeInput.tsx';
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

/** Two factor setup's column: three steps, then the code's boxes under step 3. */
function SetupSteps() {
  return (
    <>
      <p>1. Open an authenticator app, like Google Authenticator, 1Password or Authy.</p>
      <p>2. Scan the code, or type the key.</p>
      <p>3. Enter the 6 digit code it shows.</p>
      <CodeInput label="Code from your authenticator app" isLabelHidden size="lg" />
    </>
  );
}

/** Where the column's pieces draw, against the code's. */
function placesOf(canvasElement: HTMLElement) {
  const code = canvasElement.querySelector('svg[role="img"]');
  const first = [...canvasElement.querySelectorAll('p')].at(0);
  if (code === null || first === undefined) throw new Error('The code and its steps render');
  return { code: code.getBoundingClientRect(), first: first.getBoundingClientRect() };
}

/** With steps, in a dialog's width: the column sits beside the code, at size-column. */
export const WithSteps: Story = {
  render: (args) => (
    <Stage width="dialog">
      <QrCode {...args}>
        <SetupSteps />
      </QrCode>
    </Stage>
  ),
  play: async ({ canvasElement }) => {
    const { code, first } = placesOf(canvasElement);
    await expect(first.left).toBeGreaterThanOrEqual(code.right);
    await expect(Math.round(first.top)).toBe(Math.round(code.top));
  },
};

/** Narrow, as a dialog on a phone: the column goes under the code, at the slot's full width. */
export const Narrow: Story = {
  render: (args) => (
    <Stage width="narrow-fill">
      <QrCode {...args}>
        <SetupSteps />
      </QrCode>
    </Stage>
  ),
  play: async ({ canvasElement }) => {
    const { code, first } = placesOf(canvasElement);
    await expect(first.top).toBeGreaterThanOrEqual(code.bottom);
    await expect(Math.round(first.left)).toBe(Math.round(code.left));
  },
};
