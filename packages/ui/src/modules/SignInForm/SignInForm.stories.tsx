import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, fn, waitFor } from 'storybook/test';
import { AuthLayout } from '../AuthLayout/AuthLayout.tsx';
import { SignInForm } from './SignInForm.tsx';

const meta = {
  title: 'Modules/SignInForm',
  component: SignInForm,
  args: { onContinue: fn(), onGoogle: fn() },
  render: (args) => (
    <AuthLayout productName="CRM" title="Sign in">
      <SignInForm {...args} />
    </AuthLayout>
  ),
} satisfies Meta<typeof SignInForm>;

export default meta;
type Story = StoryObj<typeof meta>;

/** The email field, Continue, and Continue with Google. Enter sends the code to the trimmed address. */
export const Default: Story = {
  parameters: { crm: { preview: true } },
  play: async ({ args, canvas, userEvent }) => {
    await userEvent.type(canvas.getByRole('textbox', { name: 'Email' }), ' maya@halcyonlabs.io {Enter}');
    await expect(args.onContinue).toHaveBeenCalledWith('maya@halcyonlabs.io');
    await userEvent.click(canvas.getByRole('button', { name: 'Continue with Google' }));
    await expect(args.onGoogle).toHaveBeenCalled();
  },
};

/** Sending the code: Continue spins as "Sending code", and Google waits. */
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
    await userEvent.click(canvas.getByRole('button', { name: 'Continue' }));
    await waitFor(() => expect(email).toHaveFocus());
    await expect(email).toHaveAccessibleDescription('Enter your email address.');
    await userEvent.type(email, 'maya{Enter}');
    await waitFor(() => expect(email).toHaveAccessibleDescription(/like name@company.com/));
    await expect(args.onContinue).not.toHaveBeenCalled();
  },
};

/** Opening Google: its button spins, and Continue waits. */
export const OpeningGoogle: Story = {
  args: { status: 'google' },
  play: async ({ canvas }) => {
    await expect(canvas.getByRole('button', { name: /Opening Google/ })).toBeInTheDocument();
    await expect(canvas.getByRole('button', { name: 'Continue' })).toBeDisabled();
  },
};

/** Without Google: only the code. */
export const WithoutGoogle: Story = {
  args: { onGoogle: undefined },
  render: ({ onContinue }) => (
    <AuthLayout productName="CRM" title="Sign in">
      <SignInForm onContinue={onContinue} />
    </AuthLayout>
  ),
  play: async ({ canvas }) => {
    await expect(canvas.queryByRole('button', { name: 'Continue with Google' })).toBeNull();
  },
};

/** Sign up is closed: a quiet line under the buttons. */
export const SignUpClosed: Story = {
  args: { isSignUpClosed: true },
  play: async ({ canvas }) => {
    await expect(canvas.getByText(/Sign up isn.t open yet/)).toBeInTheDocument();
  },
};

/** Signing in is off for now: the field says why, and nothing can be pressed. */
export const Disabled: Story = {
  args: { isDisabled: true, disabledReason: 'Signing in is paused for a few minutes. Try again soon.' },
  play: async ({ canvas }) => {
    await expect(canvas.getByRole('textbox', { name: 'Email' })).toBeDisabled();
    await expect(canvas.getByRole('button', { name: 'Continue' })).toBeDisabled();
    await expect(canvas.getByRole('button', { name: 'Continue with Google' })).toBeDisabled();
  },
};
