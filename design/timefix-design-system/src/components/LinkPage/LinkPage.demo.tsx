import { useState } from 'react';
import { getLocalTimeZone, today as todayIn, type CalendarDate } from '@internationalized/date';
import { AccentPicker } from '../ColorPicker/ColorPicker.tsx';
import { SegmentedControl } from '../SegmentedControl/SegmentedControl.tsx';
import type { SocialLink } from '../SocialLinks/SocialLinks.tsx';
import { LinkPage, LINK_PAGE_LOOKS, type LinkBlock, type LinkPageBooking, type LinkPageLook, type LinkPageProfile } from './LinkPage.tsx';

/** Priya's page, shared with the LinkEditor demo. */
export const demoProfile: LinkPageProfile = { name: 'Priya Raman', bio: 'Product designer at Northwind. I help small teams ship calm software.' };

/** Priya's social links. */
export const demoSocials: ReadonlyArray<SocialLink> = [
  { id: 's1', network: 'instagram', url: 'https://instagram.com/priya.raman' },
  { id: 's2', network: 'x', url: 'https://x.com/priyaraman' },
  { id: 's3', network: 'linkedin', url: 'https://linkedin.com/in/priyaraman' },
  { id: 's4', network: 'youtube', url: 'https://youtube.com/@priyadesigns' },
  { id: 's5', network: 'email', url: 'mailto:priya@northwind.com' },
];

/** Priya's blocks, in her order. */
export const demoBlocks: ReadonlyArray<LinkBlock> = [
  { kind: 'link', id: 'b1', title: 'Design systems, a field guide', subtitle: 'My talk at Config, 24 min', href: 'https://youtube.com/watch?v=calm', style: 'featured', hue: 'sky', icon: 'video', clicks: 1284 },
  { kind: 'booking', id: 'b2', title: 'Discovery call', durationMinutes: 30, location: { kind: 'video', label: 'Google Meet' } },
  { kind: 'link', id: 'b3', title: 'Portfolio', href: 'https://priyaraman.design', icon: 'globe', clicks: 842 },
  { kind: 'link', id: 'b4', title: 'Calm Software newsletter', subtitle: 'Every other Friday', href: 'https://calmsoftware.substack.com', icon: 'news', clicks: 377 },
  { kind: 'link', id: 'b5', title: 'Follow on Instagram', href: 'https://instagram.com/priya.raman', clicks: 95 },
  { kind: 'header', id: 'b6', title: 'Shop' },
  { kind: 'link', id: 'b7', title: 'UI kit', subtitle: '$49', href: 'https://gumroad.com/priya/ui-kit', style: 'tile', icon: 'shop', hue: 'purple', clicks: 211 },
  { kind: 'link', id: 'b8', title: 'Icon set', subtitle: '$19', href: 'https://gumroad.com/priya/icons', style: 'tile', icon: 'book', hue: 'lime', clicks: 64 },
  { kind: 'divider', id: 'b9' },
  { kind: 'link', id: 'b10', title: 'Old portfolio', href: 'https://old.priyaraman.design', icon: 'globe', hidden: true, clicks: 3 },
];

const seed = (d: CalendarDate) => d.year * 400 + d.month * 31 + d.day;
const weekday = (d: CalendarDate) => new Date(d.year, d.month - 1, d.day).getDay();
const isDayOpen = (d: CalendarDate) => weekday(d) !== 0 && weekday(d) !== 6 && seed(d) % 4 !== 0;

/** A booking calendar for the demos: weekdays open, a few times taken. */
export const demoBooking: LinkPageBooking = {
  today: todayIn(getLocalTimeZone()),
  isDayOpen,
  slotsFor: (d) => (isDayOpen(d) ? [9, 9.5, 10, 11, 14, 14.5, 15.5, 16].map((h) => h * 60).filter((m) => (seed(d) + m / 30) % 5 !== 0) : []),
  timeZones: [{ id: 'Asia/Kolkata', label: 'India Standard Time' }, { id: 'Europe/London', label: 'London (GMT)' }, { id: 'America/New_York', label: 'Eastern Time (US)' }],
  defaultTimeZone: 'Asia/Kolkata',
  onBook: () => new Promise((resolve) => { window.setTimeout(resolve, 900); }),
};

export function LinkPageDemo() {
  const [look, setLook] = useState<LinkPageLook>('calm');
  const [accent, setAccent] = useState('#0F766E');
  return (
    <div className="tf-demo tf-demo--canvas tf-linkpage-demo">
      <div className="tf-linkpage-demo__controls">
        <SegmentedControl aria-label="Look" items={LINK_PAGE_LOOKS.map((l) => ({ id: l.id, label: l.label }))} selectedKey={look} onSelectionChange={(k) => setLook(k as LinkPageLook)} />
        {look === 'custom' && <AccentPicker label="Button colour" value={accent} onChange={setAccent} />}
      </div>
      <div className="tf-linkpage-demo__frame">
        <LinkPage profile={demoProfile} socials={demoSocials} blocks={demoBlocks} look={look} accent={accent} booking={demoBooking} />
      </div>
    </div>
  );
}
