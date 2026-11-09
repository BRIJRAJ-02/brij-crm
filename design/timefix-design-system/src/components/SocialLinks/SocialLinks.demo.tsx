import { useState } from 'react';
import { SocialLinks, SocialLinksEditor, type SocialLink } from './SocialLinks.tsx';

const start: ReadonlyArray<SocialLink> = [
  { id: 's1', network: 'instagram', url: 'https://instagram.com/priya.raman' },
  { id: 's2', network: 'x', url: 'https://x.com/priyaraman' },
  { id: 's3', network: 'linkedin', url: 'https://linkedin.com/in/priyaraman' },
  { id: 's4', network: 'youtube', url: 'https://youtube.com/@priyadesigns' },
  { id: 's5', network: 'website', url: 'https://priyaraman.design' },
];

export function SocialLinksDemo() {
  const [links, setLinks] = useState(start);
  return (
    <div className="tf-demo" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(20rem, 1fr))', gap: 'var(--space-32)', alignItems: 'start' }}>
      <div className="tf-stack">
        <p className="tf-demo-label">SocialLinksEditor: paste github.com/priya or @priya, then drag the grips</p>
        <SocialLinksEditor links={links} onChange={setLinks} />
      </div>
      <div className="tf-stack">
        <p className="tf-demo-label">SocialLinks on the page: hover a mark</p>
        <div style={{ padding: 'var(--space-24) var(--space-16)', borderRadius: 'var(--radius-lg)', background: 'var(--canvas)' }}>
          <SocialLinks links={links} label="Priya Raman's social links" isPreview />
        </div>
        <p className="tf-demo-label">Empty: draws nothing</p>
        <SocialLinks links={[]} label="No links" />
      </div>
    </div>
  );
}
