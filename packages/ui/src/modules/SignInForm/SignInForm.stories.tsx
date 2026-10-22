import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, fn, waitFor } from 'storybook/test';
import { AuthLayout } from '../AuthLayout/AuthLayout.tsx';
import { SignInForm } from './SignInForm.tsx';

const meta = {
  title: 'Modules/SignInForm',
  component: SignInForm,
  args: { onContinue: fn(), onGoogle: fn() },
  render: (args) => (
    <AuthLayout productName="Timefix" title="Sign in or sign up">
      <SignInForm {...args} />
    </AuthLayout>
  ),
} satisfies Meta<typeof SignInForm>;

export default meta;
type Story = StoryObj<typeof meta>;

/**
 * Continue with Google first, "or", then the email field and Continue with email. Enter sends the code to the
 * trimmed address; the buttons come in the page's order.
 */
export const Default: Story = {
  parameters: { crm: { preview: true } },
  play: async ({ args, canvas, canvasElement, userEvent }) => {
    const google = canvas.getByRole('button', { name: 'Continue with Google' });
    const email = canvas.getByRole('textbox', { name: 'Email' });
    const submit = canvas.getByRole('button', { name: 'Continue with email' });
    await expect(canvas.getByText('or')).toBeVisible();
    await expect(email).toHaveAttribute('placeholder', 'name@company.com');
    // Google, then the email, then its submit, in the page as on screen.
    const order = [...canvasElement.querySelectorAll('button, input')].filter((node) =>
      [google, email, submit].includes(node as HTMLElement),
    );
    await expect(order).toEqual([google, email, submit]);
    await userEvent.type(email, ' maya@halcyonlabs.io {Enter}');
    await expect(args.onContinue).toHaveBeenCalledWith('maya@halcyonlabs.io');
    await userEvent.click(google);
    await expect(args.onGoogle).toHaveBeenCalled();
  },
};

/** Sending the code: Continue with email spins as "Sending code", and Google waits. */
export const Sending: Story = {
  args: { status: 'sending', defaultEmail: 'maya@halcyonlabs.io' },
  play: async ({ args, canvas, userEvent }) => {
    await expect(canvas.getByRole('button', { name: /Sending code/ })).toBeInTheDocument();
    await expect(canvas.getByRole('button', { name: 'Continue with Google' })).toBeDisabled();
    await userEvent.click(canvas.getByRole('textbox', { name: 'Email' }));
    await userEvent.keyboard('{Enter}');
    await expect(args.onContinue).not.toHaveBeenCalled();
  },
};

/** The address was refused: the reason shows on the field. */
export const Refused: Story = {
  args: {
    defaultEmail: 'maya@halcyonlabs.io',
    error: 'That address can’t sign in yet. Check it, or ask for an invite.',
  },
  play: async ({ canvas }) => {
    const email = canvas.getByRole('textbox', { name: 'Email' });
    await expect(email).toHaveAttribute('aria-invalid', 'true');
    await expect(email).toHaveAccessibleDescription(/can’t sign in yet/);
  },
};

/**
 * A refused Google sign in: the notice shows at the top, above Google, as a
 * danger Callout, and is announced. It is about the sign in, not the address,
 * so the email field stays valid.
 */
export const GoogleRefused: Story = {
  args: { notice: 'Google sign in was cancelled. Try again, or use your email.' },
  play: async ({ canvas }) => {
    const alert = canvas.getByRole('alert');
    await expect(alert).toHaveTextContent('Google sign in was cancelled.');
    const google = canvas.getByRole('button', { name: 'Continue with Google' });
    // Google comes after the notice in the page (and in neither one).
    await expect(alert.compareDocumentPosition(google)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
    const email = canvas.getByRole('textbox', { name: 'Email' });
    await expect(email).not.toHaveAttribute('aria-invalid');
    await expect(email).not.toHaveAccessibleDescription(/cancelled/);
  },
};

/** Sign up isn't open to a new email: said at the top, kindly, never on the field. */
export const SignUpRefused: Story = {
  args: {
    defaultEmail: 'maya@halcyonlabs.io',
    notice: 'There’s no account for this email, and sign up isn’t open yet. Check the address.',
  },
  play: async ({ canvas }) => {
    await expect(canvas.getByRole('alert')).toHaveTextContent(/sign up isn’t open yet/);
    await expect(canvas.getByRole('textbox', { name: 'Email' })).not.toHaveAttribute('aria-invalid');
  },
};

/**
 * The notice says how the person got here; once they submit (here an address
 * that isn't one), it steps aside, so only the field's own refusal is
 * announced.
 */
export const NoticeStepsAside: Story = {
  ...GoogleRefused,
  parameters: { crm: { screenshot: false } },
  play: async ({ canvas, userEvent }) => {
    await userEvent.type(canvas.getByRole('textbox', { name: 'Email' }), 'not an address{Enter}');
    await waitFor(() => expect(canvas.getByRole('textbox', { name: 'Email' })).toHaveAttribute('aria-invalid', 'true'));
    await expect(canvas.queryByText(/Google sign in was cancelled/)).toBeNull();
  },
};

/** Changing the address clears the refusal. */
export const RefusalClears: Story = {
  ...Refused,
  parameters: { crm: { screenshot: false } },
  play: async ({ canvas, userEvent }) => {
    const email = canvas.getByRole('textbox', { name: 'Email' });
    await userEvent.type(email, 'x');
    await waitFor(() => expect(email).not.toHaveAttribute('aria-invalid'));
  },
};

/** Continue with nothing typed, or something that isn't an address: it says what to enter, and nothing is sent. */
export const Checked: Story = {
  play: async ({ args, canvas, userEvent }) => {
    const email = canvas.getByRole('textbox', { name: 'Email' });
    await userEvent.click(canvas.getByRole('button', { name: 'Continue with email' }));
    await waitFor(() => expect(email).toHaveFocus());
    await expect(email).toHaveAccessibleDescription('Enter your email address.');
    await userEvent.type(email, 'maya{Enter}');
    await waitFor(() => expect(email).toHaveAccessibleDescription(/like name@company.com/));
    await expect(args.onContinue).not.toHaveBeenCalled();
  },
};

/** Opening Google: its button spins, and Continue with email waits. */
export const OpeningGoogle: Story = {
  args: { status: 'google' },
  play: async ({ canvas }) => {
    await expect(canvas.getByRole('button', { name: /Opening Google/ })).toBeInTheDocument();
    await expect(canvas.getByRole('button', { name: 'Continue with email' })).toBeDisabled();
  },
};

/** Without Google: no Google button and no "or", and the submit reads Continue alone. */
export const WithoutGoogle: Story = {
  args: { onGoogle: undefined },
  render: ({ onContinue }) => (
    <AuthLayout productName="Timefix" title="Sign in or sign up">
      <SignInForm onContinue={onContinue} />
    </AuthLayout>
  ),
  play: async ({ canvas }) => {
    await expect(canvas.queryByRole('button', { name: 'Continue with Google' })).toBeNull();
    await expect(canvas.queryByText('or')).toBeNull();
    await expect(canvas.getByRole('button', { name: 'Continue' })).toBeInTheDocument();
  },
};

/** Sign up is closed: a quiet line under the buttons. */
export const SignUpClosed: Story = {
  args: { isSignUpClosed: true },
  play: async ({ canvas }) => {
    await expect(canvas.getByText(/Sign up isn.t open yet/)).toBeInTheDocument();
  },
};

/** Signing in is off for now: the field says why, the reason describes both buttons, and nothing can be pressed. */
export const Disabled: Story = {
  args: { isDisabled: true, disabledReason: 'Signing in is paused for a few minutes. Try again soon.' },
  play: async ({ canvas }) => {
    const reason = 'Signing in is paused for a few minutes. Try again soon.';
    const email = canvas.getByRole('textbox', { name: 'Email' });
    const submit = canvas.getByRole('button', { name: 'Continue with email' });
    const google = canvas.getByRole('button', { name: 'Continue with Google' });
    await expect(email).toBeDisabled();
    await expect(submit).toBeDisabled();
    await expect(google).toBeDisabled();
    await expect(canvas.getByText(reason)).toBeVisible();
    await waitFor(() => expect(email).toHaveAccessibleDescription(reason));
    await expect(submit).toHaveAccessibleDescription(reason);
    await expect(google).toHaveAccessibleDescription(reason);
  },
};
