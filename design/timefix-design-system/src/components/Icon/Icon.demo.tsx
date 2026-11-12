import { Calendar, Inbox, Sparkles, CircleCheck, CircleAlert, Users } from 'lucide-react';
import { Icon, ProviderMark, PROVIDER_NAMES, type ProviderName } from './Icon.tsx';
import { Button } from '../Button/Button.tsx';
import './Icon.demo.css';

const BRANDS: ReadonlyArray<ProviderName> = ['google', 'google-calendar', 'google-meet', 'outlook', 'microsoft', 'apple-calendar', 'zoom', 'slack', 'whatsapp', 'timefix'];
const SOCIAL: ReadonlyArray<ProviderName> = ['linkedin', 'x', 'instagram', 'github', 'facebook', 'youtube', 'tiktok', 'threads', 'angellist'];

export function IconDemo() {
  return (
    <div className="tf-demo tf-stack" style={{ gap: 'var(--space-20)' }}>
      <div>
        <p className="tf-demo-label">Lucide at 12, 14, 16, 20 · stroke 1.75</p>
        <div className="tf-row" style={{ gap: 'var(--space-16)' }}>
          {([12, 14, 16, 20] as const).map((s) => <span key={s} className="tf-icon-demo__size"><Icon icon={Calendar} size={s} /><span className="tf-faint tf-num">{s}</span></span>)}
          <span className="tf-icon-demo__rule" aria-hidden="true" />
          <Icon icon={Inbox} tone="muted" label="Inbox" />
          <Icon icon={Users} tone="faint" />
          <Icon icon={Sparkles} tone="ai" label="AI" />
          <Icon icon={CircleCheck} tone="success" label="Valid" />
          <Icon icon={CircleAlert} tone="danger" label="Needs attention" />
        </div>
      </div>
      <div>
        <p className="tf-demo-label">Provider marks · brand artwork, never recoloured</p>
        <div className="tf-icon-demo__grid">
          {BRANDS.map((p) => <span key={p} className="tf-icon-demo__cell"><ProviderMark provider={p} size={24} /><span>{PROVIDER_NAMES[p]}</span></span>)}
        </div>
      </div>
      <div className="tf-row" style={{ justifyContent: 'space-between' }}>
        <div className="tf-row" style={{ gap: 'var(--space-12)' }}>
          {SOCIAL.map((p) => <ProviderMark key={p} provider={p} size={20} isLabelled />)}
        </div>
        <div className="tf-row tf-muted" style={{ gap: 'var(--space-12)' }}>
          {SOCIAL.slice(0, 6).map((p) => <ProviderMark key={p} provider={p} tone="mono" size={16} isLabelled />)}
        </div>
      </div>
      <div className="tf-row">
        <Button variant="secondary" icon={<ProviderMark provider="google" />}>Continue with Google</Button>
        <Button variant="secondary" icon={<ProviderMark provider="outlook" />}>Connect Outlook</Button>
        <Button variant="secondary" size="sm" icon={<ProviderMark provider="zoom" size={14} />}>Add Zoom link</Button>
      </div>
    </div>
  );
}
