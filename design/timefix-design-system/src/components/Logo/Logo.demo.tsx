import { Logo, LogoMark } from './Logo.tsx';

export function LogoDemo() {
  return (
    <div className="tf-demo tf-stack" style={{ gap: 'var(--space-24)' }}>
      <div className="tf-row" style={{ gap: 'var(--space-32)', alignItems: 'flex-end' }}>
        <Logo size={40} />
        <Logo size={28} />
        <Logo size={20} />
      </div>
      <div className="tf-row" style={{ gap: 'var(--space-16)' }}>
        <LogoMark size={44} /><LogoMark size={32} /><LogoMark size={24} /><LogoMark size={16} />
      </div>
    </div>
  );
}
