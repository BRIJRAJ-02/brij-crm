import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState } from 'react';
import { expect, fn, waitFor } from 'storybook/test';
import { Button } from '../../atoms/Button/Button.tsx';
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
    await expect(canvas.getByText('maya@halcyonlabs.io').parentElement).toHaveTextContent(
      'Enter the code sent to maya@halcyonlabs.io.',
    );
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

/** A new code can't be sent yet: the button is off, and the wait is written under it and describes it. */
export const ResendWaiting: Story = {
  args: { resendWait: 42 },
  play: async ({ canvas }) => {
    const resend = canvas.getByRole('button', { name: 'Send a new code' });
    await expect(resend).toBeDisabled();
    await expect(canvas.getByText('You can send another in 42 seconds.')).toBeInTheDocument();
    await expect(resend).toHaveAccessibleDescription('You can send another in 42 seconds.');
  },
};

/** A new code is on its way. */
export const Resending: Story = {
  args: { isResending: true },
  play: async ({ canvas }) => {
    await expect(canvas.getByRole('button', { name: /Sending a new code/ })).toBeInTheDocument();
  },
};

function Resend({ onResend }: { readonly onResend: () => void }) {
  const [isResending, setResending] = useState(false);
  return (
    <AuthLayout productName="CRM" title="Check your email">
      <VerifyEmail
        email="maya@halcyonlabs.io"
        onVerify={() => undefined}
        error="That code is wrong or has expired. Check the latest email, or send a new code."
        isResending={isResending}
        onResend={() => {
          onResend();
          setResending(true);
          // The new code goes out after a render, as a server's answer would.
          setTimeout(() => {
            setResending(false);
          }, 0);
        }}
        onUseAnotherEmail={() => undefined}
      />
    </AuthLayout>
  );
}

/** A new code went out: the old refusal goes, focus moves to the empty boxes, and "New code sent" is announced. Typing hides it. */
export const Resent: Story = {
  parameters: { crm: { screenshot: false } },
  render: (args) => <Resend onResend={args.onResend} />,
  play: async ({ args, canvas, userEvent }) => {
    const code = canvas.getByRole('textbox', { name: 'Code' });
    await expect(code).toHaveAttribute('aria-invalid', 'true');
    await userEvent.click(canvas.getByRole('button', { name: 'Send a new code' }));
    await expect(args.onResend).toHaveBeenCalled();
    await waitFor(() => expect(code).toHaveFocus());
    await expect(code).not.toHaveAttribute('aria-invalid');
    await expect(canvas.getByRole('status')).toHaveTextContent('New code sent');
    await userEvent.keyboard('4');
    await waitFor(() => expect(canvas.getByRole('status')).toBeEmptyDOMElement());
  },
};

const LIMITED = 'Too many codes sent to this email.';

/** The resend was refused: why shows under "Send a new code" and is announced; the boxes keep their own state, and the wait counts to the server's. */
export const ResendRefused: Story = {
  args: { resendError: LIMITED, resendWait: 600 },
  play: async ({ canvas }) => {
    await expect(canvas.getByRole('alert')).toHaveTextContent(LIMITED);
    await expect(canvas.getByRole('textbox', { name: 'Code' })).not.toHaveAttribute('aria-invalid');
    await expect(canvas.getByText('You can send another in 10 minutes.')).toBeInTheDocument();
    await expect(canvas.getByRole('status')).not.toHaveTextContent('New code sent');
  },
};

function ResendWith({ refusal, onResend }: { readonly refusal?: string; readonly onResend: () => void }) {
  const [isResending, setResending] = useState(false);
  const [resendError, setResendError] = useState<string | undefined>(undefined);
  const [wait, setWait] = useState(0);
  return (
    <AuthLayout productName="CRM" title="Check your email">
      <VerifyEmail
        email="maya@halcyonlabs.io"
        onVerify={() => undefined}
        isResending={isResending}
        resendWait={wait}
        {...(resendError === undefined ? {} : { resendError })}
        onResend={() => {
          onResend();
          setResendError(undefined);
          setResending(true);
          // The answer arrives after a render, as a server's would.
          setTimeout(() => {
            setResending(false);
            setResendError(refusal);
            setWait(refusal === undefined ? 60 : 600);
          }, 0);
        }}
        onUseAnotherEmail={() => undefined}
      />
    </AuthLayout>
  );
}

/** A new code went out: "New code sent" is announced, and shown in the wait line too. */
export const ResentWaiting: Story = {
  render: (args) => <ResendWith onResend={args.onResend} />,
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(canvas.getByRole('button', { name: 'Send a new code' }));
    await waitFor(() => expect(canvas.getByRole('status')).toHaveTextContent('New code sent'));
    await expect(canvas.getByText('New code sent. You can send another in 60 seconds.')).toBeInTheDocument();
    await waitFor(() => expect(canvas.getByRole('textbox', { name: 'Code' })).toHaveFocus());
  },
};

/** A refused resend never says "New code sent", and leaves focus and the boxes alone. */
export const ResendRefusedAfterPress: Story = {
  parameters: { crm: { screenshot: false } },
  render: (args) => <ResendWith refusal={LIMITED} onResend={args.onResend} />,
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(canvas.getByRole('button', { name: 'Send a new code' }));
    await waitFor(() => expect(canvas.getByRole('alert')).toHaveTextContent(LIMITED));
    await expect(canvas.getByRole('status')).toBeEmptyDOMElement();
    await expect(canvas.getByText('You can send another in 10 minutes.')).toBeInTheDocument();
    await expect(canvas.getByRole('textbox', { name: 'Code' })).not.toHaveFocus();
  },
};

/** Too many wrong tries: the code can't be used, so the boxes are off and focus goes to "Send a new code". */
export const CodeSpent: Story = {
  args: { isCodeSpent: true, error: 'Too many wrong tries for this code. Send a new one.' },
  play: async ({ canvas }) => {
    const code = canvas.getByRole('textbox', { name: 'Code' });
    await expect(code).toBeDisabled();
    await expect(code).toHaveAccessibleDescription(/Too many wrong tries for this code/);
    await waitFor(() => expect(canvas.getByRole('button', { name: 'Send a new code' })).toHaveFocus());
  },
};

const SPENT = 'Too many wrong tries for this code. Send a new one.';

/**
 * A spent code while the resend wait still runs: the boxes are off, so focus
 * goes to the message that says why, not lost with the boxes.
 */
export const CodeSpentWaiting: Story = {
  args: { isCodeSpent: true, error: SPENT, resendWait: 42 },
  play: async ({ canvas }) => {
    await expect(canvas.getByRole('textbox', { name: 'Code' })).toBeDisabled();
    await expect(canvas.getByRole('button', { name: 'Send a new code' })).toBeDisabled();
    // The message under the boxes, not the status line that announced it.
    const message = canvas.getByText(SPENT, { selector: '[tabindex="-1"]' });
    await waitFor(() => expect(message).toHaveFocus());
    await expect(message).toHaveAttribute('tabindex', '-1');
  },
};

/** Counts a spent code's resend wait down to zero, as the screen does. */
function SpentCountdown() {
  const [wait, setWait] = useState(2);
  return (
    <AuthLayout productName="CRM" title="Check your email">
      <VerifyEmail
        email="maya@halcyonlabs.io"
        onVerify={() => undefined}
        isCodeSpent
        error={SPENT}
        resendWait={wait}
        onResend={() => undefined}
        onUseAnotherEmail={() => undefined}
      />
      <Button
        variant="ghost"
        onPress={() => {
          setWait(0);
        }}
      >
        End the wait
      </Button>
    </AuthLayout>
  );
}

/** A spent code: focus waits on the message while the wait runs, then moves to "Send a new code" when it is ready. */
export const CodeSpentThenReady: Story = {
  parameters: { crm: { screenshot: false } },
  render: () => <SpentCountdown />,
  play: async ({ canvas }) => {
    // The message under the boxes, not the status line that announced it.
    const message = canvas.getByText(SPENT, { selector: '[tabindex="-1"]' });
    await waitFor(() => expect(message).toHaveFocus());
    // Pressed from code, so focus stays on the message, as when the wait runs out by itself.
    canvas.getByRole('button', { name: 'End the wait' }).click();
    await waitFor(() => expect(canvas.getByRole('button', { name: 'Send a new code' })).toHaveFocus());
  },
};

const PAUSED = 'Signing in is paused for a few minutes. Try again soon.';

function Pausable({ onResend }: { readonly onResend: () => void }) {
  const [isResending, setResending] = useState(false);
  const [isDisabled, setDisabled] = useState(false);
  return (
    <AuthLayout productName="CRM" title="Check your email">
      <VerifyEmail
        email="maya@halcyonlabs.io"
        onVerify={() => undefined}
        isResending={isResending}
        isDisabled={isDisabled}
        {...(isDisabled ? { disabledReason: PAUSED } : {})}
        onResend={() => {
          onResend();
          setResending(true);
          setTimeout(() => {
            setResending(false);
          }, 0);
        }}
        onUseAnotherEmail={() => undefined}
      />
      <Button
        variant="ghost"
        onPress={() => {
          setDisabled((paused) => !paused);
        }}
      >
        Pause verifying
      </Button>
    </AuthLayout>
  );
}

/** A new code went out, then verifying was paused and resumed: focus moved to the boxes once, for the new code, and resuming leaves it where it is. */
export const ResentThenPaused: Story = {
  parameters: { crm: { screenshot: false } },
  render: (args) => <Pausable onResend={args.onResend} />,
  play: async ({ args, canvas, userEvent }) => {
    const code = canvas.getByRole('textbox', { name: 'Code' });
    const pause = canvas.getByRole('button', { name: 'Pause verifying' });
    await userEvent.click(canvas.getByRole('button', { name: 'Send a new code' }));
    await expect(args.onResend).toHaveBeenCalled();
    await waitFor(() => expect(code).toHaveFocus());
    await userEvent.click(pause);
    await waitFor(() => expect(code).toBeDisabled());
    await userEvent.click(pause);
    await waitFor(() => expect(code).toBeEnabled());
    // Give the effects a frame to run, then check focus stayed put.
    await new Promise((resolve) => requestAnimationFrame(resolve));
    await expect(code).not.toHaveFocus();
  },
};

/** Verifying is off for now: the boxes and both buttons are off, and a line under the boxes says why and describes the buttons. */
export const Disabled: Story = {
  args: { isDisabled: true, disabledReason: 'Signing in is paused for a few minutes. Try again soon.' },
  play: async ({ canvas }) => {
    const reason = 'Signing in is paused for a few minutes. Try again soon.';
    await expect(canvas.getByRole('textbox', { name: 'Code' })).toBeDisabled();
    const resend = canvas.getByRole('button', { name: 'Send a new code' });
    const back = canvas.getByRole('button', { name: 'Use another email' });
    await expect(resend).toBeDisabled();
    await expect(back).toBeDisabled();
    await expect(canvas.getByText(reason)).toBeVisible();
    await expect(resend).toHaveAccessibleDescription(reason);
    await expect(back).toHaveAccessibleDescription(reason);
  },
};
