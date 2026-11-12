import { useState } from 'react';
import { BookOpen, Globe, Newspaper, ShoppingBag, Video } from 'lucide-react';
import { Switch } from '../Checkbox/Checkbox.tsx';
import { SocialMark } from '../SocialLinks/SocialLinks.tsx';
import { LinkCard, LinkGrid, LinkList, type LinkItem } from './LinkList.tsx';

const i = { size: 20, strokeWidth: 1.75 } as const;
const buttons: ReadonlyArray<LinkItem> = [
  { id: 'l1', title: 'Portfolio', href: 'https://priyaraman.design', icon: <Globe {...i} />, clicks: 842 },
  { id: 'l2', title: 'Calm Software newsletter', subtitle: 'Every other Friday', href: 'https://calmsoftware.substack.com', icon: <Newspaper {...i} />, clicks: 377 },
  { id: 'l3', title: 'Follow on Instagram', href: 'https://instagram.com/priya.raman', icon: <SocialMark network="instagram" />, clicks: 95 },
  { id: 'l4', title: 'Read the case study', href: 'https://priyaraman.design/northwind' },
];
const tiles: ReadonlyArray<LinkItem> = [
  { id: 't1', title: 'UI kit', subtitle: '$49', href: 'https://gumroad.com/priya/ui-kit', icon: <ShoppingBag {...i} />, hue: 'purple', clicks: 211 },
  { id: 't2', title: 'Icon set', subtitle: '$19', href: 'https://gumroad.com/priya/icons', icon: <BookOpen {...i} />, hue: 'lime', clicks: 64 },
  { id: 't3', title: 'Design systems, a field guide', subtitle: 'Talk, 24 min', href: 'https://youtube.com/watch?v=calm', icon: <Video {...i} />, hue: 'sky', clicks: 1284 },
  { id: 't4', title: 'Office hours recording', subtitle: 'Members only', href: 'https://youtube.com/watch?v=office', icon: <Video {...i} />, hue: 'orange' },
];
const featured: LinkItem = { id: 'f1', title: 'Design systems, a field guide', subtitle: 'My talk at Config, 24 min', href: 'https://youtube.com/watch?v=calm', icon: <Video {...i} />, hue: 'sky', clicks: 1284 };

export function LinkListDemo() {
  const [editor, setEditor] = useState(false);
  return (
    <div className="tf-demo tf-demo--canvas">
      <div className="tf-row" style={{ marginBottom: 'var(--space-16)' }}><Switch isSelected={editor} onChange={setEditor}>Editor mode: show click counts</Switch></div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(18rem, 1fr))', gap: 'var(--space-24)', alignItems: 'start' }}>
        <div className="tf-stack">
          <p className="tf-demo-label">LinkList: full width buttons</p>
          <LinkList items={buttons} label="Priya's links" isPreview showClicks={editor} />
        </div>
        <div className="tf-stack">
          <p className="tf-demo-label">LinkGrid: two tiles to a row</p>
          <LinkGrid items={tiles} label="Shop" isPreview showClicks={editor} />
        </div>
        <div className="tf-stack">
          <p className="tf-demo-label">LinkCard: the featured link</p>
          <LinkCard item={featured} isPreview showClicks={editor} />
        </div>
      </div>
    </div>
  );
}
