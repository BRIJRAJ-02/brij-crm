import { useState } from 'react';
import { CodeInput } from './CodeInput.tsx';
import { Button } from '../Button/Button.tsx';

type Check = 'idle' | 'checking' | 'wrong' | 'right';

/** Checks a code the way the server would: 700ms, then right only for 123456. */
function useVerify() {
  const [state, setState] = useState<Check>('idle');
  const [value, setValue] = useState('');
  return {
    reset: () => { setState('idle'); setValue(''); },
    props: {
      value,
      isPending: state === 'checking',
      isInvalid: state === 'wrong',
      isSuccess: state === 'right',
      onChange: (v: string) => { setValue(v); if (v && state === 'wrong') setState('idle'); },
      onComplete: (code: string) => {
        setState('checking');
        window.setTimeout(() => setState(code === '123456' ? 'right' : 'wrong'), 700);
      },
    },
  };
}

export function CodeInputDemo() {
  const email = useVerify();
  const signIn = useVerify();
  return (
    <div className="tf-demo" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(340px, 1fr))', gap: 'var(--space-32)' }}>
      <div className="tf-stack">
        <CodeInput
          label="Code from your email"
          description="Sent to priya@acme.com. Try 123456; any other code shakes."
          errorMessage="That code didn’t work. Check the newest email and try again."
          {...email.props}
        />
        <div className="tf-row">
          <Button size="sm" variant="ghost" onPress={email.reset}>Resend code</Button>
        </div>
      </div>
      <div className="tf-stack">
        <CodeInput
          size="lg"
          label="Sign in code"
          description="Paste “Your Timefix code is 123456” to fill every box."
          errorMessage="Wrong code. A new one is on its way."
          {...signIn.props}
        />
      </div>
    </div>
  );
}
