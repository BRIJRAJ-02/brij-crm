import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect } from 'storybook/test';
import { Stage } from '../../workbench/Stage/Stage.tsx';
import { Code } from '../Code/Code.tsx';
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

/** Two factor setup's column: three steps, with the setup key after the second. The code's boxes go under it all. */
function SetupSteps() {
  return (
    <>
      <p>1. Open an authenticator app, like Google Authenticator, 1Password or Authy.</p>
      <p>2. Scan the code, or type the key.</p>
      <Code variant="block" isCopyable copyLabel="Copy the setup key">
        JBSW Y3DP EHPK 3PXP
      </Code>
      <p>3. Enter the 6 digit code it shows.</p>
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

/** `size="fill"`: the code takes its slot's whole width, as the link page's QR Modal draws it to be scanned or saved. */
export const Fill: Story = {
  args: { value: 'https://timefix.com/anish', label: 'QR code for your link page', size: 'fill' },
  render: (args) => (
    <Stage width="narrow-fill">
      <QrCode {...args} />
    </Stage>
  ),
  play: async ({ canvasElement, canvas }) => {
    const code = canvas.getByRole('img', { name: 'QR code for your link page' });
    const slot = code.parentElement;
    const room = slot === null ? 0 : slot.clientWidth - parseFloat(getComputedStyle(slot).paddingInline || '0') * 2;
    // Its slot's whole width (inside the slot's padding), past the default size-menu.
    await expect(Math.abs(code.getBoundingClientRect().width - room)).toBeLessThan(1);
    await expect(code.getBoundingClientRect().width).toBeGreaterThan(240);
    await expect(canvasElement.querySelector('svg[data-size="fill"]')).not.toBeNull();
  },
};

/** `size="sm"` with a column: a code in a card among others (Home's link page card), the words beside it. */
export const Small: Story = {
  args: { value: 'https://timefix.com/anish', label: 'QR code for your link page', size: 'sm' },
  render: (args) => (
    <Stage width="narrow-fill">
      <QrCode {...args}>
        <p>timefix.com/anish</p>
      </QrCode>
    </Stage>
  ),
  play: async ({ canvas }) => {
    const code = canvas.getByRole('img', { name: 'QR code for your link page' });
    await expect(Math.round(code.getBoundingClientRect().width)).toBe(120);
  },
};

/** A small square picture on our origin, as a `data:` image: the person's own picture in the code's centre. */
const CENTRE =
  'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 4 4"%3E%3Crect width="4" height="4" fill="%23e8590c"/%3E%3Ccircle cx="2" cy="2" r="1.2" fill="%23fff8e7"/%3E%3C/svg%3E';

const SHARE = {
  value: 'https://timefix.com/anish?utm_source=qr&utm_medium=print',
  label: 'QR code for your link page',
};

/** The owner's colour (spec 0061, AC-6124): a dark purple that keeps 4.5 to 1 on white. */
export const Coloured: Story = {
  parameters: { crm: { screenshot: false } },
  args: { ...SHARE, colour: '#5b21b6' },
  play: async ({ canvasElement }) => {
    const code = canvasElement.querySelector('svg');
    await expect(code?.style.getPropertyValue('--qr-modules')).toBe('#5b21b6');
  },
};

/** A colour too light to scan: the code stays the plain dark one. */
export const ColourRefused: Story = {
  parameters: { crm: { screenshot: false } },
  args: { ...SHARE, colour: '#fbbf24' },
  play: async ({ canvasElement }) => {
    const code = canvasElement.querySelector('svg');
    await expect(code?.style.getPropertyValue('--qr-modules')).toBe('');
  },
};

/** The person's picture in the centre, at a fifth of the code, the code at its highest error correction. */
export const CentrePicture: Story = {
  parameters: { crm: { screenshot: false } },
  args: { ...SHARE, picture: CENTRE },
  play: async ({ canvasElement }) => {
    await expect(canvasElement.querySelector('svg image')).not.toBeNull();
  },
};

/** A frame with its label under the code: "Scan me". */
export const Framed: Story = {
  parameters: { crm: { screenshot: false } },
  args: { ...SHARE, frameLabel: 'Scan me' },
  play: async ({ canvasElement }) => {
    await expect(canvasElement.querySelector('svg text')?.textContent).toBe('Scan me');
  },
};

/** All three together, filling a dialog's width, as the share Modal draws it to be saved. */
export const Styled: Story = {
  args: { ...SHARE, colour: '#14532d', picture: CENTRE, frameLabel: 'Book a call with me', size: 'fill' },
  render: (args) => (
    <Stage width="narrow-fill">
      <QrCode {...args} />
    </Stage>
  ),
};
