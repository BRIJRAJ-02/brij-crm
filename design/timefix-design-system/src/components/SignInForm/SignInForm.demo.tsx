import { useState } from 'react';
import { RotateCcw } from 'lucide-react';
import { Button } from '../Button/Button.tsx';
import { Kbd } from '../Kbd/Kbd.tsx';
import { AuthLayout, AuthFooterLink, AuthPreview } from '../AuthLayout/AuthLayout.tsx';
import { SignInForm } from './SignInForm.tsx';

const wait = (ms: number) => new Promise<void>((r) => window.setTimeout(r, ms));

export function SignInFormDemo() {
  const [run, setRun] = useState(0);
  const [log, setLog] = useState('Try a wrong code first, then 246810.');
  const [notice, setNotice] = useState<string | undefined>(undefined);
  return (
    <div className="tf-demo tf-stack">
      <div className="tf-row" style={{ justifyContent: 'space-between' }}>
        <p className="tf-faint" style={{ margin: 0, fontSize: 13 }} aria-live="polite">{log} <span className="tf-num">blocked@globex.com</span> is refused.</p>
        <Button size="sm" variant="ghost" icon={<RotateCcw size={14} strokeWidth={1.75} />} onPress={() => { setRun(run + 1); setNotice(undefined); setLog('Started again.'); }}>Start again</Button>
      </div>
      <div style={{ height: 600, borderRadius: 'var(--radius-lg)', border: '1px solid var(--border-subtle)', overflow: 'hidden' }}>
        <AuthLayout preview={<AuthPreview />} footer={<><AuthFooterLink href="#terms">Terms</AuthFooterLink><AuthFooterLink href="#privacy">Privacy</AuthFooterLink></>}>
          <SignInForm key={run} workspace="Northwind" resendAfter={20} notice={notice}
            onGoogle={() => setNotice("Google sign in was cancelled. Try again, or use your email.")}
            onSendCode={async (email) => { await wait(700); if (email === 'blocked@globex.com') return "That address can't sign in to this workspace. Ask an admin for an invite."; setLog(`Code sent to ${email}.`); return undefined; }}
            onVerify={async (_email, code) => { await wait(600); return code === '246810' ? undefined : "That code isn't right. Check the latest email and try again."; }}
            onSignedIn={(email) => setLog(`Signed in as ${email}.`)} />
        </AuthLayout>
      </div>
      <p className="tf-faint" style={{ margin: 0, fontSize: 13 }}><Kbd>Enter</Kbd> sends the code; paste a code and every box fills.</p>
    </div>
  );
}
