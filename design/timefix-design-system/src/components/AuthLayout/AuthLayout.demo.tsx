import { useState } from 'react';
import { SegmentedControl } from '../SegmentedControl/SegmentedControl.tsx';
import { Button } from '../Button/Button.tsx';
import { TextField } from '../Field/Field.tsx';
import { AuthLayout, AuthFooterLink, AuthHeading, AuthPreview } from './AuthLayout.tsx';

type Look = 'split' | 'card' | 'busy';

function JoinTask() {
  return (
    <div className="tf-stack" style={{ gap: 'var(--space-16)' }}>
      <AuthHeading title="Join Northwind" description={<>Priya Raman invited you to book and manage meetings with the team.</>} />
      <TextField label="Your name" size="lg" defaultValue="Sam Kim" />
      <Button variant="primary" size="lg" style={{ width: '100%' }}>Join workspace</Button>
    </div>
  );
}

const links = (
  <>
    <AuthFooterLink href="#terms">Terms</AuthFooterLink>
    <AuthFooterLink href="#privacy">Privacy</AuthFooterLink>
    <AuthFooterLink href="#help">Help</AuthFooterLink>
  </>
);

export function AuthLayoutDemo() {
  const [look, setLook] = useState<Look>('split');
  return (
    <div className="tf-demo tf-stack">
      <SegmentedControl aria-label="Layout" size="sm" selectedKey={look} onSelectionChange={(k) => setLook(k as Look)}
        items={[{ id: 'split', label: 'Split with preview' }, { id: 'card', label: 'Centred card' }, { id: 'busy', label: 'Checking session' }]} />
      <div style={{ height: 560, borderRadius: 'var(--radius-lg)', border: '1px solid var(--border-subtle)', overflow: 'hidden' }}>
        {look === 'split' && <AuthLayout preview={<AuthPreview />} footer={links}><JoinTask /></AuthLayout>}
        {look === 'card' && <AuthLayout footer={links}><JoinTask /></AuthLayout>}
        {look === 'busy' && <AuthLayout preview={<AuthPreview />} footer={links} isBusy><JoinTask /></AuthLayout>}
      </div>
    </div>
  );
}
