import { useId, useState, type CSSProperties, type ReactNode } from 'react';
import { BookOpen, CalendarDays, FileText, Globe, Mail, Mic, Newspaper, ShoppingBag, Video } from 'lucide-react';
import { Avatar } from '../Avatar/Avatar.tsx';
import { BookingFlow, type BookingFlowProps } from '../BookingFlow/BookingFlow.tsx';
import { Button } from '../Button/Button.tsx';
import { ACCENT_SWATCHES, contrastOnWhiteText } from '../ColorPicker/ColorPicker.tsx';
import { Logo } from '../Logo/Logo.tsx';
import { TextSwap } from '../Motion/Motion.tsx';
import type { Hue } from '../Tag/Tag.tsx';
import { LinkCard, LinkGrid, LinkList, type LinkItem } from '../LinkList/LinkList.tsx';
import { detectNetwork, SocialLinks, SocialMark, type SocialLink } from '../SocialLinks/SocialLinks.tsx';
import './LinkPage.css';

/** The four looks a link page comes in, plus Custom (the owner's brand colour on the buttons). */
export type LinkPageLook = 'calm' | 'bold' | 'soft' | 'night' | 'custom';

/** The looks in picker order, with the names people see. */
export const LINK_PAGE_LOOKS: ReadonlyArray<{ readonly id: LinkPageLook; readonly label: string }> = [
  { id: 'calm', label: 'Calm' }, { id: 'bold', label: 'Bold' }, { id: 'soft', label: 'Soft' }, { id: 'night', label: 'Night' }, { id: 'custom', label: 'Custom' },
];

/** Icons a link can wear when it is not a social network's own link. */
export type LinkIconName = 'globe' | 'mail' | 'file' | 'video' | 'shop' | 'mic' | 'book' | 'news';

/** Each link icon's Lucide glyph and the name the picker shows. */
export const LINK_ICONS: Readonly<Record<LinkIconName, { readonly label: string; readonly icon: (size: number) => ReactNode }>> = {
  globe: { label: 'Website', icon: (s) => <Globe size={s} strokeWidth={1.75} /> },
  mail: { label: 'Email', icon: (s) => <Mail size={s} strokeWidth={1.75} /> },
  file: { label: 'Document', icon: (s) => <FileText size={s} strokeWidth={1.75} /> },
  video: { label: 'Video', icon: (s) => <Video size={s} strokeWidth={1.75} /> },
  shop: { label: 'Shop', icon: (s) => <ShoppingBag size={s} strokeWidth={1.75} /> },
  mic: { label: 'Podcast', icon: (s) => <Mic size={s} strokeWidth={1.75} /> },
  book: { label: 'Guide', icon: (s) => <BookOpen size={s} strokeWidth={1.75} /> },
  news: { label: 'Newsletter', icon: (s) => <Newspaper size={s} strokeWidth={1.75} /> },
};

/** How a link draws: a full width button, a tile beside the next tile, or the featured card with a picture. */
export type LinkStyle = 'button' | 'tile' | 'featured';

/** One block on a link page, in the owner's order. `hidden` keeps it in the editor but off the page. */
export type LinkBlock =
  | { readonly kind: 'link'; readonly id: string; readonly title: string; readonly subtitle?: string; readonly href: string; readonly icon?: LinkIconName; readonly style?: LinkStyle; readonly hue?: Hue; readonly image?: string; readonly clicks?: number; readonly hidden?: boolean }
  | { readonly kind: 'header'; readonly id: string; readonly title: string; readonly hidden?: boolean }
  | { readonly kind: 'booking'; readonly id: string; readonly title: string; readonly durationMinutes: number; readonly location: BookingFlowProps['location']; readonly hidden?: boolean }
  | { readonly kind: 'social'; readonly id: string; readonly hidden?: boolean }
  | { readonly kind: 'divider'; readonly id: string; readonly hidden?: boolean };

/** Who the page belongs to. */
export interface LinkPageProfile { readonly name: string; readonly bio?: string; readonly avatarSrc?: string }

/** What a booking block needs to open BookingFlow; the block itself gives the title, length and place. */
export type LinkPageBooking = Pick<BookingFlowProps, 'today' | 'isDayOpen' | 'slotsFor' | 'timeZones' | 'defaultTimeZone' | 'onBook'>;

/** A link block's icon: the picked icon, else the network's own mark for a social link, else none. */
export function linkIcon(block: Extract<LinkBlock, { kind: 'link' }>, size = 20): ReactNode {
  if (block.icon) return LINK_ICONS[block.icon].icon(size);
  const net = detectNetwork(block.href);
  return net && net !== 'website' ? <SocialMark network={net} size={size} /> : undefined;
}

const asItem = (b: Extract<LinkBlock, { kind: 'link' }>): LinkItem => ({
  id: b.id, title: b.title, subtitle: b.subtitle, href: b.href, icon: linkIcon(b), image: b.image, hue: b.hue, clicks: b.clicks,
});

/** Props for PageColumn. */
export interface PageColumnProps {
  readonly children: ReactNode;
  /** `narrow` (480) for link pages, `wide` (640) for a form or a longer public page. */
  readonly width?: 'narrow' | 'wide';
}

/** The centred column every public page sits in: one measure, a 16px gutter on phones, never wider than its content needs. */
export function PageColumn({ children, width = 'narrow' }: PageColumnProps) {
  return <div className={`tf-pagecol tf-pagecol--${width}`}>{children}</div>;
}

function BookingBlock({ block, host, booking }: { readonly block: Extract<LinkBlock, { kind: 'booking' }>; readonly host: string; readonly booking?: LinkPageBooking }) {
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const panelId = useId();
  const toggle = () => { setMounted(true); setOpen((o) => !o); };
  return (
    <section className="tf-linkpage__booking" data-open={open || undefined} aria-label={block.title}>
      <div className="tf-linkpage__booking-head">
        <span className="tf-linkpage__booking-icon" aria-hidden="true"><CalendarDays size={20} strokeWidth={1.75} /></span>
        <span className="tf-linkpage__booking-text">
          <span className="tf-linkpage__booking-title">{block.title}</span>
          <span className="tf-linkpage__booking-sub tf-num">{block.durationMinutes} min · {block.location.label}</span>
        </span>
        <Button variant="primary" size="lg" onPress={toggle} isDisabled={!booking} aria-expanded={open} aria-controls={panelId} className="tf-linkpage__book">
          <TextSwap swapKey={open ? 'close' : 'book'}>{open ? 'Close' : 'Book'}</TextSwap>
        </Button>
      </div>
      {/* 21 accordion: the booking card opens in place under the block (0fr to 1fr, 2px blur). */}
      <div className="tf-linkpage__booking-panel" id={panelId} inert={!open}>
        <div className="tf-linkpage__booking-clip">
          {mounted && booking && <BookingFlow host={{ name: host }} title={block.title} durationMinutes={block.durationMinutes} location={block.location} {...booking} />}
        </div>
      </div>
    </section>
  );
}

/** Props for LinkPage. */
export interface LinkPageProps {
  readonly profile: LinkPageProfile;
  readonly socials: ReadonlyArray<SocialLink>;
  readonly blocks: ReadonlyArray<LinkBlock>;
  readonly look?: LinkPageLook;
  /** The Custom look's brand colour (a hex); its buttons take it with readable text. */
  readonly accent?: string;
  /** Opens BookingFlow from a booking block. Without it the Book button waits. */
  readonly booking?: LinkPageBooking;
  /** In the editor's phone preview: links don't navigate. */
  readonly isPreview?: boolean;
  readonly showClicks?: boolean;
}

/** A person's public link page, Linktree simple: avatar, name and bio, their social marks, then their blocks in order (buttons, tiles, a featured card, headings, dividers, a booking block), and "Powered by Timefix". */
export function LinkPage({ profile, socials, blocks, look = 'calm', accent = ACCENT_SWATCHES[0]?.hex ?? '#1F5FD6', booking, isPreview = false, showClicks = false }: LinkPageProps) {
  const shown = blocks.filter((b) => !b.hidden);
  const socialsInBlocks = blocks.some((b) => b.kind === 'social');
  const socialRow = <SocialLinks links={socials} label={`${profile.name}'s social links`} isPreview={isPreview} />;
  const style = look === 'custom'
    ? ({ '--tf-lp-custom': accent, '--tf-lp-on-custom': contrastOnWhiteText(accent) >= 4.5 ? '#FFFFFF' : '#111111' } as CSSProperties)
    : undefined;

  // Runs of buttons become one LinkList, runs of tiles one LinkGrid, so a screen reader hears one list per run.
  const out: ReactNode[] = [];
  let run: { readonly style: 'button' | 'tile'; readonly items: LinkItem[] } | undefined;
  const flush = () => {
    if (!run) return;
    const key = `run-${run.items[0]?.id ?? out.length}`;
    out.push(run.style === 'tile'
      ? <LinkGrid key={key} items={run.items} label="Links" isPreview={isPreview} showClicks={showClicks} />
      : <LinkList key={key} items={run.items} label="Links" isPreview={isPreview} showClicks={showClicks} />);
    run = undefined;
  };
  for (const b of shown) {
    if (b.kind === 'link' && (b.style ?? 'button') !== 'featured') {
      const s = b.style === 'tile' ? 'tile' : 'button';
      if (run && run.style !== s) flush();
      run = run ?? { style: s, items: [] };
      run.items.push(asItem(b));
      continue;
    }
    flush();
    if (b.kind === 'link') out.push(<LinkCard key={b.id} item={asItem(b)} isPreview={isPreview} showClicks={showClicks} />);
    else if (b.kind === 'header') out.push(<h2 key={b.id} className="tf-linkpage__heading">{b.title}</h2>);
    else if (b.kind === 'divider') out.push(<hr key={b.id} className="tf-linkpage__divider" />);
    else if (b.kind === 'social') out.push(<div key={b.id} className="tf-linkpage__socials">{socialRow}</div>);
    else out.push(<BookingBlock key={b.id} block={b} host={profile.name} booking={booking} />);
  }
  flush();

  return (
    <div className="tf-linkpage" data-look={look} data-theme={look === 'night' ? 'dark' : undefined} style={style}>
      <PageColumn>
        <header className="tf-linkpage__hero">
          <span className="tf-linkpage__avatar"><Avatar name={profile.name} src={profile.avatarSrc} size={44} /></span>
          <h1 className="tf-linkpage__name">{profile.name}</h1>
          {profile.bio && <p className="tf-linkpage__bio">{profile.bio}</p>}
          {!socialsInBlocks && <div className="tf-linkpage__socials">{socialRow}</div>}
        </header>
        <div className="tf-linkpage__blocks">{out}</div>
        <footer className="tf-linkpage__foot-wrap">
          <a className="tf-linkpage__foot" href={isPreview ? undefined : 'https://www.timefix.com'} target="_blank" rel="noreferrer">
            <span>Powered by</span><Logo size={16} />
          </a>
        </footer>
      </PageColumn>
    </div>
  );
}
