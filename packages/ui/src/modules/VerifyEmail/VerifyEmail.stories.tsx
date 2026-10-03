import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState } from 'react';
import { expect, fn, waitFor } from 'storybook/test';
import { AuthLayout } from '../AuthLayout/AuthLayout.tsx';
import { VerifyEmail } from './VerifyEmail.tsx';

const meta = {
  title: 'Modules/VerifyEmail',
  component: VerifyEmail,
  args: {
    email: 'maya@halcyonlabs.io',
    onVerify: fn(),
    onResend: fn(),
    onUseAnotherEmail: fn(),
  },
  render: (args) => (
    <AuthLayout productName="CRM" title="Check your email">
      <VerifyEmail {...args} />
    </AuthLayout>
  ),
} satisfies Meta<typeof VerifyEmail>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Where the code went and the six boxes. The sixth digit checks the code; both actions are ready. */
export const Default: Story = {
  parameters: { crm: { preview: true } },
  play: async ({ args, canvas, userEvent }) => {
    await expect(canvas.getByText('maya@halcyonlabs.io')).toBeInTheDocument();
    await userEvent.click(canvas.getByRole('textbox', { name: 'Code' }));
    await userEvent.keyboard('481593');
    await expect(args.onVerify).toHaveBeenCalledWith('481593');
    await userEvent.click(canvas.getByRole('button', { name: 'Send a new code' }));
    await expect(args.onResend).toHaveBeenCalled();
    await userEvent.click(canvas.getByRole('button', { name: 'Use another email' }));
    await expect(args.onUseAnotherEmail).toHaveBeenCalled();
  },
};

/** The code is being checked: said beside a spinner, and announced. */
export const Verifying: Story = {
  args: { isVerifying: true },
  play: async ({ canvas }) => {
    await expect(canvas.getByRole('status')).toHaveTextContent('Checking the code');
  },
};

/** The code was wrong or has expired: the reason shows under the empty boxes, and is announced. */
export const Refused: Story = {
  args: { error: 'That code is wrong or has expired. Check the latest email, or send a new code.' },
  play: async ({ canvas }) => {
    const code = canvas.getByRole('textbox', { name: 'Code' });
    await expect(code).toHaveAttribute('aria-invalid', 'true');
    await expect(code).toHaveValue('');
    await expect(canvas.getByRole('status')).toHaveTextContent(/wrong or has expired/);
  },
};

function Checking({ onVerify }: { readonly onVerify: (code: string) => void }) {
  const [isVerifying, setVerifying] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);
  return (
    <AuthLayout productName="CRM" title="Check your email">
      <VerifyEmail
        email="maya@halcyonlabs.io"
        isVerifying={isVerifying}
        {...(error === undefined ? {} : { error })}
        onVerify={(code) => {
          onVerify(code);
          setError(undefined);
          setVerifying(true);
          // The refusal arrives after a render, as a server's answer would.
          setTimeout(() => {
            setVerifying(false);
            setError('That code is wrong or has expired. Check the latest email, or send a new code.');
          }, 0);
        }}
        onResend={() => undefined}
        onUseAnotherEmail={() => undefined}
      />
    </AuthLayout>
  );
}

/** A refused code clears the boxes and keeps focus there; typing the next code hides the refusal. The same refusal twice clears them again. */
export const RefusedThenRetyped: Story = {
  parameters: { crm: { screenshot: false } },
  render: (args) => <Checking onVerify={args.onVerify} />,
  play: async ({ args, canvas, userEvent }) => {
    const code = canvas.getByRole('textbox', { name: 'Code' });
    await userEvent.click(code);
    await userEvent.keyboard('111111');
    await waitFor(() => expect(code).toHaveAttribute('aria-invalid', 'true'));
    await expect(code).toHaveValue('');
    await expect(code).toHaveFocus();
    await userEvent.keyboard('2');
    await waitFor(() => expect(code).not.toHaveAttribute('aria-invalid'));
    await userEvent.keyboard('22222');
    await waitFor(() => expect(code).toHaveValue(''));
    await expect(args.onVerify).toHaveBeenCalledTimes(2);
  },
};

/** A new code can't be sent yet: the button is off, and the wait is written under it. */
export const ResendWaiting: Story = {
  args: { resendWait: 42 },
  play: async ({ canvas }) => {
    await expect(canvas.getByRole('button', { name: 'Send a new code' })).toBeDisabled();
    await expect(canvas.getByText('You can send another in 42 seconds.')).toBeInTheDocument();
  },
};

/** A new code is on its way. */
export const Resending: Story = {
  args: { isResending: true },
  play: async ({ canvas }) => {
    await expect(canvas.getByRole('button', { name: /Sending a new code/ })).toBeInTheDocument();
  },
};
