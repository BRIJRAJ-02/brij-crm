import { useId, useState, type CSSProperties, type ReactNode } from 'react';
import { BookOpen, CalendarDays, ChevronDown, FileText, Globe, Mail, Mic, Music, Newspaper, Play, ShieldAlert, ShoppingBag, Video } from 'lucide-react';
import { Dialog } from '../Dialog/Dialog.tsx';
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

/** What every block can carry: when it shows, how big it is, whether visitors are asked first, and whether it's archived (off the page, kept). */
export interface BlockExtras {
  /** Shown from and until these days (YYYY-MM-DD); outside them it's off the page. */
  readonly showFrom?: string; readonly showUntil?: string;
  /** Small takes half the row, beside the next small block. */
  readonly size?: 'small' | 'large';
  /** Visitors are asked first: a sensitive link, or one for 18+ or 21+ only. */
  readonly gate?: 'sensitive' | '18' | '21';
  readonly archived?: boolean;
}

/** One block on a link page, in the owner's order. `hidden` keeps it in the editor but off the page. */
export type LinkBlock = (
  | { readonly kind: 'link'; readonly id: string; readonly title: string; readonly subtitle?: string; readonly href: string; readonly icon?: LinkIconName; readonly style?: LinkStyle; readonly hue?: Hue; readonly image?: string; readonly clicks?: number; readonly hidden?: boolean }
  /** A heading over a group; `folds` makes it a section that opens and closes over the blocks under it, to the next heading. */
  | { readonly kind: 'header'; readonly id: string; readonly title: string; readonly folds?: boolean; readonly hidden?: boolean }
  | { readonly kind: 'booking'; readonly id: string; readonly title: string; readonly durationMinutes: number; readonly location: BookingFlowProps['location']; readonly hidden?: boolean; /** The booking page it opens; its length and place come from there. */ readonly slug?: string }
  /** The next few open times of a booking page as chips; a pick opens the booking card. */
  | { readonly kind: 'next'; readonly id: string; readonly title: string; readonly durationMinutes: number; readonly location: BookingFlowProps['location']; readonly slug?: string; readonly hidden?: boolean }
  | { readonly kind: 'social'; readonly id: string; readonly hidden?: boolean }
  | { readonly kind: 'divider'; readonly id: string; readonly hidden?: boolean }
  /** A few lines of writing: an about, an offer, office hours. */
  | { readonly kind: 'text'; readonly id: string; readonly title?: string; readonly body: string; readonly hidden?: boolean }
  /** Questions people ask, each opening to its answer. */
  | { readonly kind: 'faq'; readonly id: string; readonly items: ReadonlyArray<{ readonly q: string; readonly a: string }>; readonly hidden?: boolean }
  /** One quote from a client, with their name. */
  | { readonly kind: 'testimonial'; readonly id: string; readonly quote: string; readonly name: string; readonly role?: string; readonly hidden?: boolean }
  /** A button to one of your forms. */
  | { readonly kind: 'form'; readonly id: string; readonly title: string; readonly slug: string; readonly hidden?: boolean }
  /** An email field and a button: join a list. */
  | { readonly kind: 'signup'; readonly id: string; readonly title: string; readonly button: string; readonly hidden?: boolean }
  /** A video or a song (YouTube, Vimeo, Spotify, SoundCloud): a card that plays it where it lives. */
  | { readonly kind: 'media'; readonly id: string; readonly title: string; readonly url: string; readonly hidden?: boolean }
  /** One picture, optionally a link. */
  | { readonly kind: 'picture'; readonly id: string; readonly src: string; readonly alt: string; readonly href?: string; readonly hidden?: boolean }
  /** A few pictures in a grid. */
  | { readonly kind: 'gallery'; readonly id: string; readonly title?: string; readonly images: ReadonlyArray<{ readonly src: string; readonly alt: string }>; readonly hidden?: boolean }
  /** A short announcement in the page's colour, optionally a link. */
  | { readonly kind: 'banner'; readonly id: string; readonly title: string; readonly line?: string; readonly href?: string; readonly hidden?: boolean }
) & BlockExtras;

/** The provider a media address belongs to, and whether it's music. */
export function mediaKind(url: string): { readonly name: string; readonly music: boolean } | undefined {
  const u = url.toLowerCase();
  if (/youtube\.com|youtu\.be/.test(u)) return { name: 'YouTube', music: false };
  if (/vimeo\.com/.test(u)) return { name: 'Vimeo', music: false };
  if (/spotify\.com/.test(u)) return { name: 'Spotify', music: true };
  if (/soundcloud\.com/.test(u)) return { name: 'SoundCloud', music: true };
  if (/music\.apple\.com/.test(u)) return { name: 'Apple Music', music: true };
  return undefined;
}

/** Whether a block shows on the page now: not hidden or archived, inside its dates, and with something in it. */
export function isShown(b: LinkBlock, now: Date = new Date()): boolean {
  const day = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  if (b.hidden || b.archived) return false;
  if (b.showFrom && day < b.showFrom) return false;
  if (b.showUntil && day > b.showUntil) return false;
  return !(b.kind === 'link' && !b.href.trim()) && !(b.kind === 'text' && !b.body.trim()) && !(b.kind === 'faq' && !b.items.some((x) => x.q.trim()))
    && !(b.kind === 'testimonial' && !b.quote.trim()) && !(b.kind === 'form' && !b.slug) && !(b.kind === 'media' && !b.url.trim()) && !(b.kind === 'picture' && !b.src)
    && !(b.kind === 'gallery' && b.images.length === 0) && !(b.kind === 'banner' && !b.title.trim());
}

/** Who the page belongs to. */
export interface LinkPageProfile { readonly name: string; readonly bio?: string; readonly avatarSrc?: string;
  /** A line under the name ("Head of Sales"). */ readonly title?: string;
  /** The photo's shape: a circle, or a rounded square. */ readonly shape?: 'circle' | 'rounded';
  /** The wide photo at the top, and a photo behind the whole page. */ readonly cover?: string; readonly ground?: string;
  /** A colour for the page's ground instead of the template's ("#F7F3EE"); a dark one turns the page dark. */ readonly groundColour?: string }

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

/** The next open times of a booking calendar, soonest first. */
function nextTimes(booking: LinkPageBooking, count: number): ReadonlyArray<{ readonly label: string; readonly key: string }> {
  const out: Array<{ readonly label: string; readonly key: string }> = [];
  for (let d = 0; d < 21 && out.length < count; d++) {
    const day = booking.today.add({ days: d });
    if (!booking.isDayOpen(day)) continue;
    for (const m of booking.slotsFor(day)) {
      if (out.length >= count) break;
      const at = new Date(day.year, day.month - 1, day.day, Math.floor(m / 60), m % 60);
      if (d === 0 && at < new Date()) continue;
      out.push({ key: `${day.toString()}-${m}`, label: `${at.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })} · ${at.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}` });
    }
  }
  return out;
}

/** Next times: the soonest open times as chips; any of them opens the booking card under it. */
function NextBlock({ block, host, booking }: { readonly block: Extract<LinkBlock, { kind: 'next' }>; readonly host: string; readonly booking?: LinkPageBooking }) {
  const [open, setOpen] = useState(false);
  const panelId = useId();
  const times = booking ? nextTimes(booking, 3) : [];
  return (
    <section className="tf-linkpage__booking tf-linkpage__next" data-open={open || undefined} aria-label={block.title}>
      <div className="tf-linkpage__booking-head">
        <span className="tf-linkpage__booking-icon" aria-hidden="true"><CalendarDays size={20} strokeWidth={1.75} /></span>
        <span className="tf-linkpage__booking-text"><span className="tf-linkpage__booking-title">{block.title}</span><span className="tf-linkpage__booking-sub tf-num">{block.durationMinutes} min · {block.location.label}</span></span>
      </div>
      <ul className="tf-linkpage__times" aria-label="Next open times">
        {times.length === 0 ? <li className="tf-linkpage__booking-sub">No open times in the next three weeks.</li> : times.map((x) => (
          <li key={x.key}><button type="button" className="tf-linkpage__time tf-num" aria-expanded={open} aria-controls={panelId} onClick={() => setOpen(true)}>{x.label}</button></li>))}
      </ul>
      <div className="tf-linkpage__booking-panel" id={panelId} inert={!open}>
        <div className="tf-linkpage__booking-clip">{open && booking && <BookingFlow host={{ name: host }} title={block.title} durationMinutes={block.durationMinutes} location={block.location} {...booking} />}</div>
      </div>
    </section>
  );
}

/** A link that asks first: a sensitive link, or one for adults only. Continue opens it; Go back stays. */
function GatedLink({ block, isPreview }: { readonly block: Extract<LinkBlock, { kind: 'link' }>; readonly isPreview: boolean }) {
  const [asking, setAsking] = useState(false);
  const words = block.gate === 'sensitive' ? { title: 'This link may be sensitive', line: 'It may show things some people would rather not see.', go: 'Continue' }
    : { title: `For ${block.gate} and over`, line: `You must be ${block.gate} or older to open this link. Are you?`, go: `I’m ${block.gate} or older` };
  return (
    <>
      <ul className="tf-linklist" aria-label="Links"><li>
        <button type="button" className="tf-linklist__btn" onClick={() => setAsking(true)}>
          <span className="tf-linklist__icon" aria-hidden="true"><ShieldAlert size={20} strokeWidth={1.75} /></span>
          <span className="tf-linklist__text"><span className="tf-linklist__title">{block.title}</span><span className="tf-linklist__sub">{block.gate === 'sensitive' ? 'Sensitive' : `${block.gate}+`}</span></span>
          <span className="tf-linklist__end" />
        </button></li></ul>
      {asking && <Dialog isOpen onOpenChange={(o) => { if (!o) setAsking(false); }} title={words.title} description={words.line}
        actions={<><Button variant="ghost" slot="close">Go back</Button><Button variant="primary" onPress={() => { setAsking(false); if (!isPreview) window.open(block.href, '_blank', 'noopener'); }}>{words.go}</Button></>} />}
    </>
  );
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
      {/* 21 accordion: the booking card opens in place under the block (0fr to 1fr. */}
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
  /** A visitor joined the email list (the live page only; the preview never sends). */
  readonly onSignup?: (email: string, heading: string) => void;
  /** One line over the foot ("Replies within a day"). */
  readonly closing?: string;
  /** The day the page is drawn for; blocks outside their dates don't show. */
  readonly now?: Date;
  /** A team's or company's page: the people on it, under the name. */
  readonly members?: ReadonlyArray<{ readonly name: string; readonly title?: string; readonly avatarSrc?: string }>;
}

/** A person's public link page, Linktree simple: avatar, name and bio, their social marks, then their blocks in order (buttons, tiles, a featured card, headings, dividers, a booking block), and "Powered by Timefix". */
export function LinkPage({ profile, socials, blocks, look = 'calm', accent = ACCENT_SWATCHES[0]?.hex ?? '#1F5FD6', booking, isPreview = false, showClicks = false, onSignup, closing, now, members = [] }: LinkPageProps) {
  const darkGround = profile.groundColour ? contrastOnWhiteText(profile.groundColour) >= 4.5 : false;
  // Hidden, archived, out-of-date blocks, and blocks with nothing in them yet, don't show.
  const shown = blocks.filter((b) => isShown(b, now));
  const socialsInBlocks = blocks.some((b) => b.kind === 'social');
  const socialRow = <SocialLinks links={socials} label={`${profile.name}'s social links`} isPreview={isPreview} />;
  const style = {
    ...(look === 'custom' ? { '--tf-lp-custom': accent, '--tf-lp-on-custom': contrastOnWhiteText(accent) >= 4.5 ? '#FFFFFF' : '#111111' } : {}),
    ...(profile.ground ? { '--tf-lp-ground': `url("${profile.ground}")` } : {}),
    ...(profile.groundColour ? { '--tf-lp-bg': profile.groundColour } : {}),
  } as CSSProperties;

  // Runs of buttons become one LinkList, runs of tiles one LinkGrid, so a screen reader hears one list per run.
  const draw = (list: ReadonlyArray<LinkBlock>): ReactNode[] => {
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
    const sized = (b: LinkBlock, node: ReactNode) => (b.size === 'small' ? <div key={b.id} className="tf-linkpage__cell" data-size="small">{node}</div> : node);
    for (const b of list) {
      if (b.kind === 'link' && !b.gate && (b.style ?? 'button') !== 'featured' && b.size !== 'large') {
        const s = b.style === 'tile' || b.size === 'small' ? 'tile' : 'button';
        if (run && run.style !== s) flush();
        run = run ?? { style: s, items: [] };
        run.items.push(asItem(b));
        continue;
      }
      flush();
      if (b.kind === 'link') out.push(b.gate ? <GatedLink key={b.id} block={b} isPreview={isPreview} /> : <LinkCard key={b.id} item={asItem(b)} isPreview={isPreview} showClicks={showClicks} />);
      else if (b.kind === 'header') out.push(<h2 key={b.id} className="tf-linkpage__heading">{b.title}</h2>);
      else if (b.kind === 'divider') out.push(<hr key={b.id} className="tf-linkpage__divider" />);
      else if (b.kind === 'social') out.push(<div key={b.id} className="tf-linkpage__socials">{socialRow}</div>);
      else if (b.kind === 'text') out.push(sized(b, <section key={b.id} className="tf-linkpage__text">{b.title && <h2 className="tf-linkpage__heading">{b.title}</h2>}<p>{b.body}</p></section>));
      else if (b.kind === 'faq') out.push(<section key={b.id} className="tf-linkpage__faq" aria-label="Questions">{b.items.filter((x) => x.q.trim()).map((x, n) => <details key={n}><summary>{x.q}</summary><p>{x.a}</p></details>)}</section>);
      else if (b.kind === 'testimonial') out.push(sized(b, <figure key={b.id} className="tf-linkpage__quote"><blockquote>“{b.quote}”</blockquote><figcaption>{b.name}{b.role ? `, ${b.role}` : ''}</figcaption></figure>));
      else if (b.kind === 'form') out.push(<LinkCard key={b.id} item={{ id: b.id, title: b.title, href: `https://timefix.com/f/${b.slug}`, icon: <FileText size={20} strokeWidth={1.75} /> }} isPreview={isPreview} />);
      else if (b.kind === 'signup') out.push(<SignupBlock key={b.id} block={b} isPreview={isPreview} onSignup={onSignup} owner={profile.name} />);
      else if (b.kind === 'media' && b.gate) { const m = mediaKind(b.url); out.push(<GatedLink key={b.id} block={{ kind: 'link', id: b.id, title: b.title || (m ? `Watch on ${m.name}` : 'Play'), href: b.url, gate: b.gate }} isPreview={isPreview} />); }
      else if (b.kind === 'media') { const m = mediaKind(b.url); out.push(sized(b, <LinkCard key={b.id} item={{ id: b.id, title: b.title || (m ? `Watch on ${m.name}` : 'Play'), subtitle: m ? `${m.music ? 'Listen' : 'Watch'} on ${m.name}` : undefined, href: b.url, icon: m?.music ? <Music size={20} strokeWidth={1.75} /> : <Play size={20} strokeWidth={1.75} />, hue: m?.music ? 'green' : 'red' }} isPreview={isPreview} />)); }
      else if (b.kind === 'picture') { const img = <img src={b.src} alt={b.alt} loading="lazy" />; out.push(sized(b, <figure key={b.id} className="tf-linkpage__picture">{b.href && !isPreview ? <a href={b.href} target="_blank" rel="noopener noreferrer nofollow">{img}</a> : img}</figure>)); }
      else if (b.kind === 'gallery') out.push(<section key={b.id} className="tf-linkpage__gallery" aria-label={b.title || 'Pictures'}>{b.title && <h2 className="tf-linkpage__heading">{b.title}</h2>}<ul>{b.images.map((x, n) => <li key={n}><img src={x.src} alt={x.alt} loading="lazy" /></li>)}</ul></section>);
      else if (b.kind === 'banner') { const inner = <><strong>{b.title}</strong>{b.line && <span>{b.line}</span>}</>; out.push(sized(b, b.href && !isPreview ? <a key={b.id} className="tf-linkpage__banner" href={b.href} target="_blank" rel="noopener noreferrer">{inner}</a> : <div key={b.id} className="tf-linkpage__banner">{inner}</div>)); }
      else if (b.kind === 'next') out.push(<NextBlock key={b.id} block={b} host={profile.name} booking={booking} />);
      else out.push(<BookingBlock key={b.id} block={b} host={profile.name} booking={booking} />);
    }
    flush();
    return out;
  };
  // A folding heading gathers the blocks under it, to the next heading, into a section that opens and closes.
  const out: ReactNode[] = [];
  let i = 0;
  while (i < shown.length) {
    const b = shown[i];
    if (b?.kind === 'header' && b.folds) {
      let j = i + 1;
      while (j < shown.length && shown[j]?.kind !== 'header') j += 1;
      out.push(<details key={b.id} className="tf-linkpage__fold"><summary><span>{b.title}</span><ChevronDown size={16} strokeWidth={1.75} aria-hidden="true" /></summary><div className="tf-linkpage__foldbody">{draw(shown.slice(i + 1, j))}</div></details>);
      i = j;
    } else {
      let j = i + 1;
      while (j < shown.length && !(shown[j]?.kind === 'header' && (shown[j] as { readonly folds?: boolean }).folds)) j += 1;
      out.push(...draw(shown.slice(i, j)));
      i = j;
    }
  }

  return (
    <div className="tf-linkpage" data-look={look} data-theme={look === 'night' || darkGround ? 'dark' : profile.groundColour ? 'light' : undefined} data-ground={profile.ground ? true : undefined} style={style}>
      <PageColumn>
        {/* A cover band in the page's colour (or the owner's photo), the face overlapping its lower edge (owner's 11 Nov reference). */}
        <div className="tf-linkpage__cover" data-photo={profile.cover ? true : undefined} aria-hidden="true">{profile.cover && <img src={profile.cover} alt="" />}</div>
        <header className="tf-linkpage__hero">
          <span className="tf-linkpage__avatar" data-shape={profile.shape === 'rounded' ? 'rounded' : undefined}><Avatar name={profile.name} src={profile.avatarSrc} size={44} shape={profile.shape === 'rounded' ? 'square' : 'round'} /></span>
          <h1 className="tf-linkpage__name">{profile.name}</h1>
          {profile.title && <p className="tf-linkpage__role">{profile.title}</p>}
          {profile.bio && <p className="tf-linkpage__bio">{profile.bio}</p>}
          {!socialsInBlocks && <div className="tf-linkpage__socials">{socialRow}</div>}
          {members.length > 0 && <ul className="tf-linkpage__members" aria-label="People">{members.map((m) => <li key={m.name}><Avatar name={m.name} src={m.avatarSrc} size={36} /><span>{m.name.split(' ')[0]}</span></li>)}</ul>}
        </header>
        <div className="tf-linkpage__blocks">{out}</div>
        {closing && <p className="tf-linkpage__closing">{closing}</p>}
        <footer className="tf-linkpage__foot-wrap">
          <a className="tf-linkpage__foot" href={isPreview ? undefined : 'https://www.timefix.com'} target="_blank" rel="noreferrer">
            <span>Powered by</span><Logo size={16} />
          </a>
        </footer>
      </PageColumn>
    </div>
  );
}

/** An email signup on the page: one field, one button, and a thank-you once it's sent. */
function SignupBlock({ block, isPreview, onSignup, owner }: { readonly block: Extract<LinkBlock, { kind: 'signup' }>; readonly isPreview: boolean; readonly onSignup?: (email: string, heading: string) => void; readonly owner: string }) {
  const [email, setEmail] = useState('');
  const [done, setDone] = useState(false);
  const [bad, setBad] = useState(false);
  const id = useId();
  if (done) return <p className="tf-linkpage__signup tf-linkpage__signup--done" role="status">{isPreview ? 'Preview: this is what visitors see. Nothing was sent.' : 'You’re on the list. Thank you.'}</p>;
  return (
    <form className="tf-linkpage__signup" onSubmit={(e) => { e.preventDefault(); if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { setBad(true); return; } if (!isPreview) onSignup?.(email.trim(), block.title || 'Join my list'); setDone(true); }}>
      <label htmlFor={id} className="tf-linkpage__signup-title">{block.title || 'Join my list'}</label>
      <span className="tf-linkpage__signup-row">
        <input id={id} type="email" className="tf-linkpage__signup-input" placeholder="you@example.com" value={email} aria-invalid={bad || undefined} onChange={(e) => { setEmail(e.target.value); setBad(false); }} />
        <Button type="submit" variant="primary">{block.button}</Button>
      </span>
      {bad && <span className="tf-linkpage__signup-error" role="alert">That doesn’t look like an email address.</span>}
      {/* What signing up means, said where the address is given: the consent the list rests on. */}
      <span className="tf-linkpage__signup-note">You’ll get emails from {owner}. Unsubscribe any time.</span>
    </form>
  );
}
