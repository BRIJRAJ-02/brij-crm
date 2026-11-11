import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Button as AriaButton } from 'react-aria-components';
import { DragList } from '../../lib/drag.ts';
import { DragHandle, DragItem } from '../DragHandle/DragHandle.tsx';
import { AlignLeft, Archive, ArchiveRestore, AtSign, CalendarClock, CalendarDays, FileText, Heading, HelpCircle, Image, Images, Import, Link2, Mail, Megaphone, Minus, Palette, Play, Plus, Quote, Settings2, Trash2 } from 'lucide-react';
import { Dialog } from '../Dialog/Dialog.tsx';
import { FileDrop } from '../FileDrop/FileDrop.tsx';
import { PhotoCrop } from '../PhotoCrop/PhotoCrop.tsx';
import { ShowMore } from '../Disclosure/Disclosure.tsx';
import { Checkbox } from '../Checkbox/Checkbox.tsx';
import { Tag } from '../Tag/Tag.tsx';
import { Avatar } from '../Avatar/Avatar.tsx';
import { Button } from '../Button/Button.tsx';
import { Switch } from '../Checkbox/Checkbox.tsx';
import { AccentPicker } from '../ColorPicker/ColorPicker.tsx';
import { DrawerPanel } from '../Drawer/Drawer.tsx';
import { TextArea, TextField } from '../Field/Field.tsx';
import { PublishBar, type PublishBarStatus } from '../FloatingBar/FloatingBar.tsx';
import { Menu, MenuItem, MenuTrigger } from '../Menu/Menu.tsx';
import { SegmentedControl } from '../SegmentedControl/SegmentedControl.tsx';
import { Select } from '../Select/Select.tsx';
import { ClickCount } from '../LinkList/LinkList.tsx';
import { LinkPage, LINK_ICONS, LINK_PAGE_LOOKS, isShown, linkIcon, mediaKind, type LinkBlock, type LinkIconName, type LinkPageBooking, type LinkPageLook, type LinkPageProfile, type LinkStyle } from '../LinkPage/LinkPage.tsx';
import { detectNetwork, SocialLinksEditor, SocialMark, socialLabel, type SocialLink } from '../SocialLinks/SocialLinks.tsx';
import { cx } from '../../lib/cx.ts';
import './LinkEditor.css';

const i16 = { size: 16, strokeWidth: 1.75 } as const;

/** Everything a link page is made of; what the editor drafts and Publish sends. */
export interface LinkPageDraft {
  readonly profile: LinkPageProfile;
  readonly socials: ReadonlyArray<SocialLink>;
  readonly blocks: ReadonlyArray<LinkBlock>;
  readonly look: LinkPageLook;
  readonly accent: string;
  /** The page's details: the title browsers and search show, a closing line, the picture a shared link shows, and search indexing. */
  readonly details?: { readonly siteTitle?: string; readonly closing?: string; readonly shareImage?: string; readonly indexed?: boolean };
}

/** Props for LinkEditor. */
export interface LinkEditorProps {
  /** The page as guests see it now. */
  readonly live: LinkPageDraft;
  /** Resolves once the draft is live. */
  readonly onPublish: (page: LinkPageDraft) => Promise<void>;
  readonly booking?: LinkPageBooking;
  /** Unpublished work kept by the app, so leaving the editor (or opening "See it") never loses it. */
  readonly initialDraft?: LinkPageDraft;
  readonly onDraftChange?: (draft: LinkPageDraft | undefined) => void;
  /** Never published: the bar offers Publish straight away. */
  readonly neverPublished?: boolean;
  /** The workspace's forms, for the Form block. */
  readonly forms?: ReadonlyArray<{ readonly slug: string; readonly name: string; readonly live: boolean }>;
  /** A team's or company's people, shown on the preview under the name. */
  readonly members?: ReadonlyArray<{ readonly name: string; readonly title?: string }>;
  /** The workspace's booking pages, for the Booking block: it opens one of them, with its length and place. */
  readonly bookingPages?: ReadonlyArray<{ readonly slug: string; readonly name: string; readonly minutes: number; readonly location: { readonly kind: 'video' | 'phone' | 'place'; readonly label: string } }>;
}

type Kind = LinkBlock['kind'];
const KIND_LABEL: Readonly<Record<Kind, string>> = { link: 'Link', header: 'Header', booking: 'Booking', social: 'Social icons', divider: 'Divider', text: 'Text', faq: 'Questions', testimonial: 'Testimonial', form: 'Form', signup: 'Email signup',
  next: 'Next times', media: 'Video or music', picture: 'Picture', gallery: 'Gallery', banner: 'Banner' };
const KIND_ICON: Readonly<Record<Kind, ReactNode>> = { link: <Link2 {...i16} />, header: <Heading {...i16} />, booking: <CalendarDays {...i16} />, social: <AtSign {...i16} />, divider: <Minus {...i16} />,
  text: <AlignLeft {...i16} />, faq: <HelpCircle {...i16} />, testimonial: <Quote {...i16} />, form: <FileText {...i16} />, signup: <Mail {...i16} />,
  next: <CalendarClock {...i16} />, media: <Play {...i16} />, picture: <Image {...i16} />, gallery: <Images {...i16} />, banner: <Megaphone {...i16} /> };
/** Calm grounds for a page's background, each with readable text on it; Ink turns the page dark. */
const GROUNDS = [{ hex: '#F7F3EE', name: 'Sand' }, { hex: '#EEF4FF', name: 'Sky' }, { hex: '#EDF7F1', name: 'Mint' }, { hex: '#FBEFF3', name: 'Blush' }, { hex: '#F2F2F3', name: 'Stone' }, { hex: '#14161A', name: 'Ink' }];
/** Reads picked image files as data addresses, so a picture stays with the draft. */
const readImages = (files: readonly File[]) => Promise.all(files.filter((f) => f.type.startsWith('image/')).map((f) => new Promise<{ readonly src: string; readonly alt: string }>((resolve) => { const r = new FileReader(); r.onload = () => resolve({ src: String(r.result), alt: f.name.replace(/\.[a-z]+$/i, '').replace(/[-_]+/g, ' ') }); r.readAsDataURL(f); })));
const fmtDay = (d: string) => new Date(`${d}T00:00`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
/** Links found in pasted text, each once, with a title from its address. */
export function findLinks(text: string): ReadonlyArray<{ readonly href: string; readonly title: string }> {
  const seen = new Set<string>();
  return (text.match(/(?:https?:\/\/|www\.)[^\s<>"')]+/gi) ?? []).map((u) => (u.startsWith('http') ? u : `https://${u}`).replace(/[.,;]+$/, ''))
    .filter((u) => !/linktr\.ee|beacons\.ai|bio\.link|lnk\.bio/i.test(u) && !seen.has(u.toLowerCase()) && Boolean(seen.add(u.toLowerCase())))
    .map((href) => ({ href, title: titleFromUrl(href) || href }));
}

/** How many things differ between the draft and the live page (a moved block counts once). */
export function changesBetween(a: LinkPageDraft, b: LinkPageDraft): number {
  const live = new Map(b.blocks.map((x) => [x.id, JSON.stringify(x)]));
  let n = a.blocks.filter((x) => live.get(x.id) !== JSON.stringify(x)).length;
  n += b.blocks.filter((x) => !a.blocks.some((y) => y.id === x.id)).length;
  const order = (d: LinkPageDraft) => d.blocks.filter((x) => live.has(x.id) && a.blocks.some((y) => y.id === x.id)).map((x) => x.id).join();
  if (order(a) !== order(b)) n += 1;
  if (JSON.stringify(a.profile) !== JSON.stringify(b.profile)) n += 1;
  if (JSON.stringify(a.socials) !== JSON.stringify(b.socials)) n += 1;
  if (a.look !== b.look || (a.look === 'custom' && a.accent !== b.accent)) n += 1;
  if (JSON.stringify(a.details ?? {}) !== JSON.stringify(b.details ?? {})) n += 1;
  return n;
}

function describe(b: LinkBlock, socials: number): string {
  if (b.kind === 'link') return socialLabel(b.href) || 'No address yet';
  if (b.kind === 'booking') return `${b.durationMinutes} min · ${b.location.label}`;
  if (b.kind === 'social') return `${socials} ${socials === 1 ? 'network' : 'networks'}`;
  if (b.kind === 'text') return b.body.slice(0, 48) || 'Empty';
  if (b.kind === 'faq') return `${b.items.length} ${b.items.length === 1 ? 'question' : 'questions'}`;
  if (b.kind === 'testimonial') return b.name || 'No name yet';
  if (b.kind === 'form') return `timefix.com/f/${b.slug}`;
  if (b.kind === 'signup') return b.button;
  if (b.kind === 'next') return `Next 3 times · ${b.durationMinutes} min`;
  if (b.kind === 'media') return mediaKind(b.url)?.name ?? (b.url || 'No address yet');
  if (b.kind === 'picture') return b.src ? b.alt || 'A picture' : 'No picture yet';
  if (b.kind === 'gallery') return `${b.images.length} ${b.images.length === 1 ? 'picture' : 'pictures'}`;
  if (b.kind === 'banner') return b.line || 'Banner';
  if (b.kind === 'header' && b.folds) return 'Folds shut';
  return KIND_LABEL[b.kind];
}
/** The schedule, size and ask-first marks a row shows after its description. */
const marks = (b: LinkBlock) => [b.showFrom || b.showUntil ? `Shown ${b.showFrom ? `from ${fmtDay(b.showFrom)}` : ''}${b.showFrom && b.showUntil ? ' ' : ''}${b.showUntil ? `until ${fmtDay(b.showUntil)}` : ''}` : '', b.size === 'small' ? 'Small' : b.size === 'large' ? 'Large' : '', b.gate ? (b.gate === 'sensitive' ? 'Asks first' : `${b.gate}+`) : ''].filter(Boolean);
const titleOf = (b: LinkBlock) => (b.kind === 'link' || b.kind === 'header' || b.kind === 'booking' || b.kind === 'form' || b.kind === 'signup' || b.kind === 'next' || b.kind === 'banner' || b.kind === 'media' ? b.title || KIND_LABEL[b.kind] : b.kind === 'text' ? b.title || 'Text' : b.kind === 'gallery' ? b.title || 'Gallery' : b.kind === 'testimonial' ? `“${b.quote.slice(0, 32)}”` : KIND_LABEL[b.kind]);
/** A button title from a pasted address: "youtube.com/@priya" reads "YouTube". */
const titleFromUrl = (href: string) => { const host = /^(?:https?:\/\/)?(?:www\.)?([^/?#]+)/i.exec(href.trim())?.[1] ?? ''; const name = host.split('.')[0] ?? ''; const known: Readonly<Record<string, string>> = { youtube: 'YouTube', linkedin: 'LinkedIn', github: 'GitHub', instagram: 'Instagram', x: 'X', twitter: 'X', tiktok: 'TikTok', substack: 'Substack', medium: 'Medium', dribbble: 'Dribbble', behance: 'Behance', spotify: 'Spotify', calendly: 'Booking page' }; return known[name.toLowerCase()] ?? (name ? name[0]?.toUpperCase() + name.slice(1) : ''); };

let nextId = 0;
function newBlock(kind: Kind): LinkBlock {
  nextId += 1;
  const id = `new-${kind}-${nextId}`;
  if (kind === 'link') return { kind, id, title: '', href: '' };
  if (kind === 'header') return { kind, id, title: 'New section' };
  if (kind === 'booking') return { kind, id, title: 'Intro call', durationMinutes: 15, location: { kind: 'video', label: 'Google Meet' } };
  // New blocks start empty; empty blocks don't show on the page, so nothing made up is ever published.
  if (kind === 'text') return { kind, id, title: '', body: '' };
  if (kind === 'faq') return { kind, id, items: [{ q: '', a: '' }] };
  if (kind === 'testimonial') return { kind, id, quote: '', name: '' };
  if (kind === 'form') return { kind, id, title: '', slug: '' };
  if (kind === 'signup') return { kind, id, title: '', button: 'Sign up' };
  if (kind === 'next') return { kind, id, title: 'Book a call', durationMinutes: 30, location: { kind: 'video', label: 'Google Meet' } };
  if (kind === 'media') return { kind, id, title: '', url: '' };
  if (kind === 'picture') return { kind, id, src: '', alt: '' };
  if (kind === 'gallery') return { kind, id, images: [] };
  if (kind === 'banner') return { kind, id, title: '' };
  return { kind, id } as LinkBlock;
}

/** The link page editor: blocks on the left (drag to reorder, switch to hide, press to edit in a side panel), a live phone preview on the right, and the PublishBar once the draft differs from the live page. */
export function LinkEditor({ live: initial, onPublish, booking, initialDraft, onDraftChange, neverPublished = false, forms = [], bookingPages = [], members }: LinkEditorProps) {
  const [live, setLive] = useState(initial);
  const [draft, setDraft] = useState(initialDraft ?? initial);
  const [published, setPublished] = useState(!neverPublished);
  const reportDraft = useRef(onDraftChange); reportDraft.current = onDraftChange;
  useEffect(() => { reportDraft.current?.(changesBetween(draft, live) > 0 ? draft : undefined); }, [draft, live]);
  const [editing, setEditing] = useState<string>();
  const [fresh, setFresh] = useState<string>();
  const [washed, setWashed] = useState<string>();
  const [deleted, setDeleted] = useState<{ readonly block: LinkBlock; readonly index: number }>();
  const [status, setStatus] = useState<Exclude<PublishBarStatus, 'live' | 'draft'>>();
  const [importing, setImporting] = useState(false);
  const [cropping, setCropping] = useState<'avatar' | 'cover' | 'ground'>();
  const [dropping, setDropping] = useState<LinkBlock>();
  const timers = useRef<number[]>([]);
  useEffect(() => () => timers.current.forEach((t) => window.clearTimeout(t)), []);
  const later = (ms: number, fn: () => void) => { timers.current.push(window.setTimeout(fn, ms)); };

  const changes = changesBetween(draft, live);
  const barStatus: PublishBarStatus = status ?? (changes > 0 || !published ? 'draft' : 'live');
  const setBlocks = (fn: (b: ReadonlyArray<LinkBlock>) => ReadonlyArray<LinkBlock>) => setDraft((d) => ({ ...d, blocks: fn(d.blocks) }));
  const patch = (id: string, p: Partial<LinkBlock>) => setBlocks((bs) => bs.map((b) => (b.id === id ? ({ ...b, ...p } as LinkBlock) : b)));
  // The panel keeps showing what it edited while it slides away.
  const lastEditing = useRef<string | undefined>(undefined);
  if (editing !== undefined) lastEditing.current = editing;
  const shown = editing ?? lastEditing.current;
  const block = draft.blocks.find((b) => b.id === shown);

  const publish = async () => {
    setStatus('publishing');
    try { await onPublish(draft); } catch { setStatus(undefined); return; }
    setLive(draft); setPublished(true); setStatus('published');
    later(1400, () => setStatus(undefined));
  };
  const add = (kind: Kind) => {
    const b = newBlock(kind);
    setBlocks((bs) => [b, ...bs]);
    setFresh(b.id); setDeleted(undefined);
    if (kind !== 'divider') setEditing(b.id);
  };
  const remove = (id: string) => {
    const index = draft.blocks.findIndex((b) => b.id === id);
    const b = draft.blocks[index];
    if (!b) return;
    setBlocks((bs) => bs.filter((x) => x.id !== id));
    setDeleted({ block: b, index }); setEditing(undefined);
  };
  const undo = () => {
    if (!deleted) return;
    setBlocks((bs) => [...bs.slice(0, deleted.index), deleted.block, ...bs.slice(deleted.index)]);
    setWashed(deleted.block.id); setDeleted(undefined);
  };
  const close = () => { setWashed(editing); setEditing(undefined); };
  const archive = (id: string, on: boolean) => { patch(id, { archived: on || undefined }); if (on) setEditing(undefined); };
  const setProfile = (p: Partial<LinkPageProfile>) => setDraft((d) => ({ ...d, profile: { ...d.profile, ...p } }));
  const setDetails = (p: Partial<NonNullable<LinkPageDraft['details']>>) => setDraft((d) => ({ ...d, details: { ...d.details, ...p } }));
  const archived = draft.blocks.filter((b) => b.archived);
  const pageBlocks = draft.blocks.filter((b) => !b.archived);

  // Blocks reorder by their grip; archived ones keep their place at the end.
  const reorderBlocks = (ids: ReadonlyArray<string>) => setBlocks((bs) => [...ids.map((id) => bs.find((x) => x.id === id)).filter((x): x is LinkBlock => Boolean(x)), ...bs.filter((x) => x.archived)]);
  const openBlock = (b: LinkBlock) => { if (b.kind !== 'divider') setEditing(b.id); };
  const blockBody = (b: LinkBlock, grip: ReactNode) => (
    <span className="tf-linked__rowin">
      {grip}
      <span className="tf-linked__tile" aria-hidden="true">{b.kind === 'link' ? linkIcon(b, 16) ?? KIND_ICON.link : KIND_ICON[b.kind]}</span>
      <span className="tf-linked__text">
        <span className="tf-linked__title">{titleOf(b)}</span>
        <span className="tf-linked__sub">{[b.hidden ? 'Hidden' : !isShown(b) && (b.showFrom || b.showUntil) ? 'Not showing today' : '', describe(b, draft.socials.length), ...marks(b)].filter(Boolean).join(' · ')}</span>
      </span>
      {b.kind === 'link' && b.clicks !== undefined && <ClickCount clicks={b.clicks} />}
      <Switch aria-label={`Show ${titleOf(b)} on the page`} isSelected={!b.hidden} onChange={(on) => patch(b.id, { hidden: !on })} />
    </span>
  );

  const hasSocial = draft.blocks.some((b) => b.kind === 'social');
  const list = (
    <div className="tf-linked__list">
      <AriaButton className="tf-linked__profile" onPress={() => setEditing('profile')}>
        <Avatar name={draft.profile.name || '?'} src={draft.profile.avatarSrc} size={36} shape={draft.profile.shape === 'rounded' ? 'square' : 'round'} />
        <span className="tf-linked__text"><span className="tf-linked__title">{draft.profile.name || 'Your name'}</span><span className="tf-linked__sub">{[draft.profile.title, draft.profile.bio || 'Add a short bio'].filter(Boolean).join(' · ')}</span></span>
      </AriaButton>
      <div className="tf-linked__pair">
        <AriaButton className="tf-linked__profile tf-linked__mini" onPress={() => setEditing('design')}>
          <span className="tf-linked__tile" aria-hidden="true"><Palette {...i16} /></span>
          <span className="tf-linked__text"><span className="tf-linked__title">Design</span><span className="tf-linked__sub">{LINK_PAGE_LOOKS.find((l) => l.id === draft.look)?.label ?? 'Calm'}{draft.profile.ground ? ' · photo background' : draft.profile.groundColour ? ' · own background' : ''}</span></span>
        </AriaButton>
        <AriaButton className="tf-linked__profile tf-linked__mini" onPress={() => setEditing('details')}>
          <span className="tf-linked__tile" aria-hidden="true"><Settings2 {...i16} /></span>
          <span className="tf-linked__text"><span className="tf-linked__title">Details</span><span className="tf-linked__sub">{draft.details?.indexed === false ? 'Hidden from search' : 'In search engines'}</span></span>
        </AriaButton>
      </div>
      <div className="tf-linked__bar">
        <h3 className="tf-linked__heading">Blocks</h3>
        <span className="tf-linked__baracts"><Button size="sm" variant="ghost" icon={<Import size={14} strokeWidth={1.75} />} onPress={() => setImporting(true)}>Import</Button>
        <MenuTrigger>
          <Button size="sm" icon={<Plus size={14} strokeWidth={1.75} />}>Add block</Button>
          <Menu aria-label="Add block" placement="bottom end" onAction={(k) => add(String(k) as Kind)}>
            <MenuItem id="link" icon={KIND_ICON.link} description="A button to any address">Link</MenuItem>
            <MenuItem id="booking" icon={KIND_ICON.booking} description="Opens your booking calendar">Booking</MenuItem>
            <MenuItem id="next" icon={KIND_ICON.next} description="Your next open times, one tap to book">Next times</MenuItem>
            <MenuItem id="header" icon={KIND_ICON.header} description="A title over a group, or a section that folds">Header</MenuItem>
            <MenuItem id="media" icon={KIND_ICON.media} description="YouTube, Vimeo, Spotify or SoundCloud">Video or music</MenuItem>
            <MenuItem id="picture" icon={KIND_ICON.picture} description="One photo, optionally a link">Picture</MenuItem>
            <MenuItem id="gallery" icon={KIND_ICON.gallery} description="A few photos in a grid">Gallery</MenuItem>
            <MenuItem id="banner" icon={KIND_ICON.banner} description="A short announcement in your colour">Banner</MenuItem>
            {!hasSocial ? <MenuItem id="social" icon={KIND_ICON.social} description="Your social marks, placed here">Social icons</MenuItem> : null}
            <MenuItem id="divider" icon={KIND_ICON.divider}>Divider</MenuItem>
            <MenuItem id="text" icon={KIND_ICON.text} description="A few lines of writing">Text</MenuItem>
            <MenuItem id="faq" icon={KIND_ICON.faq} description="Questions that open to answers">Questions</MenuItem>
            <MenuItem id="testimonial" icon={KIND_ICON.testimonial} description="A quote from a client">Testimonial</MenuItem>
            <MenuItem id="form" icon={KIND_ICON.form} description="A button to one of your forms">Form</MenuItem>
            <MenuItem id="signup" icon={KIND_ICON.signup} description="Collect emails for a list">Email signup</MenuItem>
          </Menu>
        </MenuTrigger></span>
      </div>
      <DragList ids={pageBlocks.map((b) => b.id)} onReorder={reorderBlocks} textOf={(id) => { const b = draft.blocks.find((x) => x.id === id); return b ? titleOf(b) : 'block'; }}
        overlay={(id) => { const b = draft.blocks.find((x) => x.id === id); return b ? <div className="tf-linked__row">{blockBody(b, <DragHandle label="" reveal="always" isLifted size="sm" />)}</div> : null; }}>
        <ul aria-label="Blocks, in page order" className="tf-linked__blocks">
          {pageBlocks.map((b) => (
            <DragItem key={b.id} id={b.id} className={cx('tf-linked__row', fresh === b.id && 'is-new', washed === b.id && 'is-changed', b.hidden && 'is-hidden')}>
              {(d) => <>
                {b.kind !== 'divider' && <button type="button" className="tf-linked__open" aria-label={`Edit ${titleOf(b)}`} onClick={() => openBlock(b)} />}
                {blockBody(b, <DragHandle label={`Move ${titleOf(b)}`} reveal="always" size="sm" isLifted={d.isDragging} drag={d.grip} />)}
              </>}
            </DragItem>
          ))}
        </ul>
      </DragList>
      {deleted && (
        <p className="tf-linked__undo" role="status"><span>{titleOf(deleted.block)} deleted</span><Button size="sm" variant="ghost" onPress={undo}>Undo</Button></p>
      )}
      {archived.length > 0 && <ShowMore showLabel={`Archived · ${archived.length}`} hideLabel={`Hide archived · ${archived.length}`}>
        <p className="tf-linked__note">Off your page, kept here with everything they held.</p>
        <ul className="tf-linked__archived" aria-label="Archived blocks">{archived.map((b) => (
          <li key={b.id}><span className="tf-linked__tile" aria-hidden="true">{KIND_ICON[b.kind]}</span><span className="tf-linked__text"><span className="tf-linked__title">{titleOf(b)}</span><span className="tf-linked__sub">{describe(b, draft.socials.length)}</span></span>
            <Button size="sm" variant="ghost" icon={<ArchiveRestore size={14} strokeWidth={1.75} />} onPress={() => archive(b.id, false)}>Restore</Button>
            <Button size="sm" variant="ghost" icon={<Trash2 size={14} strokeWidth={1.75} />} onPress={() => setDropping(b)}>Delete</Button></li>))}</ul>
      </ShowMore>}
    </div>
  );

  const fields = (() => {
    if (shown === 'profile') {
      return (
        <>
          <div className="tf-linked__photo">
            <Avatar name={draft.profile.name || '?'} src={draft.profile.avatarSrc} size={56} shape={draft.profile.shape === 'rounded' ? 'square' : 'round'} />
            <span className="tf-linked__photoacts"><Button size="sm" variant="secondary" onPress={() => setCropping('avatar')}>{draft.profile.avatarSrc ? 'Change photo' : 'Add a photo'}</Button>
              {draft.profile.avatarSrc && <Button size="sm" variant="ghost" onPress={() => setProfile({ avatarSrc: undefined })}>Remove photo</Button>}</span>
          </div>
          <TextField label="Name" value={draft.profile.name} onChange={(name) => setProfile({ name })} />
          <TextField label="Title" aside="Optional" value={draft.profile.title ?? ''} placeholder="Head of Sales" onChange={(title) => setProfile({ title: title || undefined })} description="It sits under your name." />
          <TextArea label="Bio" aside="Optional" showCount maxLength={120} value={draft.profile.bio ?? ''} onChange={(bio) => setProfile({ bio })} />
          <div className="tf-linked__group"><span className="tf-linked__label">Profile photo shape</span>
            <SegmentedControl aria-label="Profile photo shape" size="sm" selectedKey={draft.profile.shape ?? 'circle'} onSelectionChange={(k) => setProfile({ shape: k === 'rounded' ? 'rounded' : undefined })} items={[{ id: 'circle', label: 'Circle' }, { id: 'rounded', label: 'Rounded' }]} /></div>
          <div className="tf-linked__group"><span className="tf-linked__label">Cover photo</span><span className="tf-linked__note">The wide photo at the top. Without one, the page’s colour shows.</span>
            {draft.profile.cover && <img className="tf-linked__share" src={draft.profile.cover} alt="The cover photo on this page" />}
            <span className="tf-linked__photoacts"><Button size="sm" variant="secondary" onPress={() => setCropping('cover')}>{draft.profile.cover ? 'Change cover' : 'Add a cover photo'}</Button>{draft.profile.cover && <Button size="sm" variant="ghost" onPress={() => setProfile({ cover: undefined })}>Remove</Button>}</span></div>
        </>
      );
    }
    if (shown === 'design') {
      return (
        <>
          <div className="tf-linked__group"><span className="tf-linked__label">Template</span>
            <SegmentedControl aria-label="Look" size="sm" isFullWidth items={LINK_PAGE_LOOKS.filter((l) => l.id !== 'custom').map((l) => ({ id: l.id, label: l.label }))} selectedKey={draft.look === 'custom' ? 'calm' : draft.look} onSelectionChange={(k) => setDraft((d) => ({ ...d, look: k as LinkPageLook }))} /></div>
          <div className="tf-linked__group"><span className="tf-linked__label">Colour</span>
            <div className="tf-set__switch tf-linked__switch"><span>Your own button colour</span><Switch aria-label="Your own button colour" isSelected={draft.look === 'custom'} onChange={(on) => setDraft((d) => ({ ...d, look: on ? 'custom' : 'calm' }))} /></div>
            {draft.look === 'custom' && <AccentPicker label="Button colour" value={draft.accent} onChange={(accent) => setDraft((d) => ({ ...d, accent }))} />}</div>
          <div className="tf-linked__group"><span className="tf-linked__label">Background</span>
            <SegmentedControl aria-label="Background" size="sm" selectedKey={draft.profile.ground ? 'photo' : draft.profile.groundColour ? 'colour' : 'template'} items={[{ id: 'template', label: 'Template' }, { id: 'colour', label: 'Colour' }, { id: 'photo', label: 'Photo' }]}
              onSelectionChange={(k) => { if (k === 'template') setProfile({ ground: undefined, groundColour: undefined }); else if (k === 'colour') setProfile({ ground: undefined, groundColour: draft.profile.groundColour ?? GROUNDS[0]?.hex }); else setCropping('ground'); }} />
            {draft.profile.groundColour && !draft.profile.ground && <AccentPicker label="Background colour" use="ground" swatches={GROUNDS} value={draft.profile.groundColour} onChange={(groundColour) => setProfile({ groundColour })} />}
            {draft.profile.ground && <span className="tf-linked__photo"><img className="tf-linked__share" src={draft.profile.ground} alt="The background photo on this page" /><span className="tf-linked__photoacts"><Button size="sm" variant="secondary" onPress={() => setCropping('ground')}>Change</Button><Button size="sm" variant="ghost" onPress={() => setProfile({ ground: undefined })}>Remove</Button></span></span>}
            <span className="tf-linked__note">Fills the page behind everything.</span></div>
        </>
      );
    }
    if (shown === 'details') {
      const d = draft.details ?? {};
      return (
        <>
          <TextField label="Site title" aside="Optional" value={d.siteTitle ?? ''} placeholder={`${draft.profile.name} · Timefix`} onChange={(siteTitle) => setDetails({ siteTitle: siteTitle || undefined })} description="What a browser tab and search results say." />
          <TextField label="Closing line" aside="Optional" value={d.closing ?? ''} placeholder="Replies within a day." onChange={(closing) => setDetails({ closing: closing || undefined })} description="One line at the foot of your page." />
          <div className="tf-linked__group"><span className="tf-linked__label">Share image</span>
            {d.shareImage ? <span className="tf-linked__photo"><img className="tf-linked__share" src={d.shareImage} alt="Your page’s share picture" /><Button size="sm" variant="ghost" onPress={() => setDetails({ shareImage: undefined })}>Remove</Button></span>
              : <FileDrop variant="compact" label="Drop a PNG or JPG, or choose one" description="Shows when your link is shared. Without one we draw a card." acceptedFileTypes={['image/png', 'image/jpeg']} allowsMultiple={false} onFiles={(fs) => { void readImages(fs).then((xs) => { if (xs[0]) setDetails({ shareImage: xs[0].src }); }); }} />}</div>
          <div className="tf-set__switch tf-linked__switch"><span><strong>Show in search engines</strong><span className="tf-linked__note">Off asks Google and others to leave your page out.</span></span><Switch aria-label="Show in search engines" isSelected={d.indexed !== false} onChange={(on) => setDetails({ indexed: on ? undefined : false })} /></div>
        </>
      );
    }
    if (!block) return null;
    if (block.kind === 'link') {
      const net = detectNetwork(block.href);
      return (
        <>
          <TextField label="Title" value={block.title} placeholder="What the button says" onChange={(title) => patch(block.id, { title })} />
          <TextField label="Address" type="url" value={block.href} placeholder="https://" onChange={(href) => patch(block.id, { href, ...(!block.title || block.title === titleFromUrl(block.href) ? { title: titleFromUrl(href) } : {}) })}
            icon={<span className="tf-linked__detected" key={net ?? 'none'}>{net ? <SocialMark network={net} size={16} /> : <Link2 {...i16} />}</span>} />
          <TextField label="Line under the title" aside="Optional" value={block.subtitle ?? ''} onChange={(subtitle) => patch(block.id, { subtitle: subtitle || undefined })} />
          <Select label="Shown as" items={[{ id: 'button', label: 'Button' }, { id: 'tile', label: 'Tile, two to a row' }, { id: 'featured', label: 'Featured card with picture' }]}
            value={block.style ?? 'button'} onChange={(s) => patch(block.id, { style: (s ?? 'button') as LinkStyle })} />
          {block.style && block.style !== 'button' && (block.image ? <span className="tf-linked__photo"><img className="tf-linked__share" src={block.image} alt="" /><Button size="sm" variant="ghost" onPress={() => patch(block.id, { image: undefined })}>Remove picture</Button></span>
            : <FileDrop variant="compact" label="Add the link’s picture" description="PNG, JPG or WebP" acceptedFileTypes={['image/*']} allowsMultiple={false} onFiles={(fs) => { void readImages(fs).then((xs) => { if (xs[0]) patch(block.id, { image: xs[0].src }); }); }} />)}
          <Select label="Icon" items={[{ id: 'auto', label: net && net !== 'website' ? 'Network mark' : 'None' }, ...(Object.keys(LINK_ICONS) as LinkIconName[]).map((k) => ({ id: k, label: LINK_ICONS[k].label, icon: LINK_ICONS[k].icon(16) }))]}
            value={block.icon ?? 'auto'} onChange={(k) => patch(block.id, { icon: k === 'auto' || k === null ? undefined : (k as LinkIconName) })} />
        </>
      );
    }
    if (block.kind === 'header') return <><TextField label="Title" value={block.title} onChange={(title) => patch(block.id, { title })} />
      <div className="tf-set__switch tf-linked__switch"><span><strong>Folds shut</strong><span className="tf-linked__note">Visitors open it to see the blocks under it, to the next header.</span></span><Switch aria-label="Folds shut" isSelected={Boolean(block.folds)} onChange={(folds) => patch(block.id, { folds: folds || undefined })} /></div></>;
    if (block.kind === 'next') return <>
      {bookingPages.length > 0 && <Select label="Booking page" value={block.slug ?? null} placeholder="Pick a booking page" onChange={(slug) => { const p = bookingPages.find((x) => x.slug === slug); if (p) patch(block.id, { slug: p.slug, title: p.name, durationMinutes: p.minutes, location: p.location }); }} items={bookingPages.map((p) => ({ id: p.slug, label: p.name, description: `${p.minutes} min · ${p.location.label}` }))} />}
      <TextField label="Title" value={block.title} onChange={(title) => patch(block.id, { title })} />
      <p className="tf-linked__note">Shows your next three open times. A tap opens the booking card with that day.</p></>;
    if (block.kind === 'media') return <><TextField label="Address" type="url" value={block.url} placeholder="https://youtube.com/watch?v=…" onChange={(url) => patch(block.id, { url })} description={mediaKind(block.url) ? `${mediaKind(block.url)?.name}: plays where it lives.` : 'YouTube, Vimeo, Spotify, SoundCloud or Apple Music.'} />
      <TextField label="Title" aside="Optional" value={block.title} placeholder="My latest talk" onChange={(title) => patch(block.id, { title })} /></>;
    if (block.kind === 'picture') return <>
      {block.src ? <span className="tf-linked__photo"><img className="tf-linked__share" src={block.src} alt="" /><Button size="sm" variant="ghost" onPress={() => patch(block.id, { src: '' })}>Remove</Button></span>
        : <FileDrop variant="compact" label="Drop a photo, or choose one" description="PNG, JPG or WebP" acceptedFileTypes={['image/*']} allowsMultiple={false} onFiles={(fs) => { void readImages(fs).then((xs) => { const x = xs[0]; if (x) patch(block.id, { src: x.src, alt: block.alt || x.alt }); }); }} />}
      <TextField label="Describe it" value={block.alt} placeholder="The studio at sunrise" onChange={(alt) => patch(block.id, { alt })} description="For people who can’t see it." />
      <TextField label="Link" aside="Optional" type="url" value={block.href ?? ''} placeholder="https://" onChange={(href) => patch(block.id, { href: href || undefined })} /></>;
    if (block.kind === 'gallery') return <>
      <TextField label="Title" aside="Optional" value={block.title ?? ''} onChange={(title) => patch(block.id, { title: title || undefined })} />
      {block.images.length > 0 && <ul className="tf-linked__thumbs" aria-label="Pictures">{block.images.map((x, n) => <li key={n}><img src={x.src} alt={x.alt} /><Button size="sm" variant="ghost" onPress={() => patch(block.id, { images: block.images.filter((_, k) => k !== n) })}>Remove</Button></li>)}</ul>}
      {block.images.length < 9 && <FileDrop variant="compact" label="Drop photos, or choose them" description="Up to 9" acceptedFileTypes={['image/*']} onFiles={(fs) => { void readImages(fs).then((xs) => patch(block.id, { images: [...block.images, ...xs].slice(0, 9) })); }} />}</>;
    if (block.kind === 'banner') return <><TextField label="Headline" value={block.title} placeholder="New: weekend slots" onChange={(title) => patch(block.id, { title })} />
      <TextField label="Line under it" aside="Optional" value={block.line ?? ''} onChange={(line) => patch(block.id, { line: line || undefined })} />
      <TextField label="Link" aside="Optional" type="url" value={block.href ?? ''} placeholder="https://" onChange={(href) => patch(block.id, { href: href || undefined })} /></>;
    if (block.kind === 'booking' && bookingPages.length > 0) {
      const page = bookingPages.find((p) => p.slug === block.slug) ?? bookingPages.find((p) => p.name === block.title);
      return (
        <>
          <Select label="Booking page" value={block.slug ?? bookingPages.find((x) => x.name === block.title)?.slug ?? null} placeholder="Pick a booking page" onChange={(slug) => { const p = bookingPages.find((x) => x.slug === slug); if (p) patch(block.id, { slug: p.slug, title: !block.title || bookingPages.some((x) => x.name === block.title) ? p.name : block.title, durationMinutes: p.minutes, location: p.location }); }}
            items={bookingPages.map((p) => ({ id: p.slug, label: p.name, description: `${p.minutes} min · ${p.location.label}` }))} />
          <TextField label="Title" value={block.title} onChange={(title) => patch(block.id, { title })} />
          <p className="tf-linked__note">{page ? `${page.minutes} min · ${page.location.label}. Change these on the booking page itself.` : 'Pick which booking page this opens; its length and place come from there.'}</p>
        </>
      );
    }
    if (block.kind === 'booking') {
      return (
        <>
          <TextField label="Title" value={block.title} onChange={(title) => patch(block.id, { title })} />
          <Select label="Length" items={[15, 30, 45, 60].map((m) => ({ id: String(m), label: `${m} min` }))} value={String(block.durationMinutes)} onChange={(m) => patch(block.id, { durationMinutes: Number(m ?? 30) })} />
          <Select label="Where" items={[{ id: 'Google Meet', label: 'Google Meet' }, { id: 'Zoom', label: 'Zoom' }, { id: 'Phone call', label: 'Phone call' }]} value={block.location.label}
            onChange={(l) => patch(block.id, { location: { kind: l === 'Phone call' ? 'phone' : 'video', label: l ?? 'Google Meet' } })} />
        </>
      );
    }
    if (block.kind === 'text') return <><TextField label="Title" aside="Optional" value={block.title ?? ''} onChange={(title) => patch(block.id, { title: title || undefined })} /><TextArea label="Text" rows={5} value={block.body} placeholder="A few words about what you do" onChange={(body) => patch(block.id, { body })} /></>;
    if (block.kind === 'testimonial') return <><TextArea label="Quote" rows={3} value={block.quote} placeholder="What they said, in their words" onChange={(quote) => patch(block.id, { quote })} /><TextField label="Their name" value={block.name} onChange={(name) => patch(block.id, { name })} /><TextField label="Role or company" aside="Optional" value={block.role ?? ''} onChange={(role) => patch(block.id, { role: role || undefined })} /></>;
    if (block.kind === 'form') return forms.length === 0 ? <p className="tf-linked__note">Make a form first, in Forms. Then pick it here.</p> : <>
      <Select label="Form" value={block.slug || null} placeholder="Pick a form" onChange={(slug) => { const f = forms.find((x) => x.slug === slug); if (f) patch(block.id, { slug: f.slug, title: block.title || f.name }); }} items={forms.map((f) => ({ id: f.slug, label: f.name, description: f.live ? 'Live' : 'Draft: publish it before it works' }))} />
      <TextField label="Button" value={block.title} placeholder="What the button says" onChange={(title) => patch(block.id, { title })} /></>;
    if (block.kind === 'signup') return <><TextField label="Heading" value={block.title} placeholder="Join my list" onChange={(title) => patch(block.id, { title })} /><TextField label="Button" value={block.button} onChange={(button) => patch(block.id, { button })} /><p className="tf-linked__note">Emails land in People, tagged with this heading.</p></>;
    if (block.kind === 'faq') {
      const items = block.items;
      const put = (next: ReadonlyArray<{ readonly q: string; readonly a: string }>) => patch(block.id, { items: next });
      return (
        <>
          {items.map((x, n) => (
            <div key={n} className="tf-linked__faq">
              <TextField label={`Question ${n + 1}`} value={x.q} placeholder="What do people often ask?" onChange={(q) => put(items.map((y, k) => (k === n ? { ...y, q } : y)))} />
              <TextArea label="Answer" rows={2} value={x.a} onChange={(a) => put(items.map((y, k) => (k === n ? { ...y, a } : y)))} />
              {items.length > 1 && <Button size="sm" variant="ghost" icon={<Trash2 {...i16} />} onPress={() => put(items.filter((_, k) => k !== n))}>Remove question</Button>}
            </div>
          ))}
          <Button size="sm" variant="secondary" icon={<Plus size={14} strokeWidth={1.75} />} onPress={() => put([...items, { q: '', a: '' }])}>Add a question</Button>
        </>
      );
    }
    if (block.kind === 'social') return <SocialLinksEditor links={draft.socials} onChange={(socials) => setDraft((d) => ({ ...d, socials }))} />;
    return null;
  })();

  const more = block && block.kind !== 'divider' && block.kind !== 'social' && (
    <ShowMore key={block.id} showLabel="More options" hideLabel="Fewer options" defaultExpanded={Boolean(block.showFrom || block.showUntil || block.size || block.gate)}>
      <div className="tf-linked__more">
        <div className="tf-linked__pairs"><TextField label="Show from" aside="Optional" type="date" value={block.showFrom ?? ''} onChange={(v) => patch(block.id, { showFrom: v || undefined })} />
          <TextField label="Show until" aside="Optional" type="date" value={block.showUntil ?? ''} onChange={(v) => patch(block.id, { showUntil: v || undefined })} isInvalid={Boolean(block.showFrom && block.showUntil && block.showUntil < block.showFrom)} errorMessage="Before the first day." /></div>
        {block.kind !== 'header' && block.kind !== 'faq' && block.kind !== 'signup' && block.kind !== 'gallery' && <Select label="Size" value={block.size ?? 'normal'} onChange={(v) => patch(block.id, { size: v === 'small' ? 'small' : v === 'large' ? 'large' : undefined })}
          items={[{ id: 'normal', label: 'Full width' }, { id: 'small', label: 'Small, two to a row' }, ...(block.kind === 'link' ? [{ id: 'large', label: 'Large card' }] : [])]} />}
        {(block.kind === 'link' || block.kind === 'media') && <Select label="Ask first" value={block.gate ?? 'none'} onChange={(v) => patch(block.id, { gate: v === 'sensitive' || v === '18' || v === '21' ? v : undefined })}
          items={[{ id: 'none', label: 'Don’t ask' }, { id: 'sensitive', label: 'Sensitive content', description: 'Visitors confirm before it opens' }, { id: '18', label: '18 and over' }, { id: '21', label: '21 and over' }]} />}
      </div>
    </ShowMore>
  );
  const panelTitle = shown === 'profile' ? 'Profile' : shown === 'design' ? 'Design' : shown === 'details' ? 'Details' : block ? `Edit ${KIND_LABEL[block.kind].toLowerCase()}` : '';
  return (
    <div className="tf-linked-host">
    <div className="tf-linked">
      <div className="tf-linked__side">
        {/* 08 page side-by-side: the list waits 8px left, the panel comes from 8px right, both through. */}
        <div className="tf-linked__pane" data-pos={editing ? 'before' : 'current'} inert={editing !== undefined}>{list}</div>
        <div className="tf-linked__pane" data-pos={editing ? 'current' : 'after'} inert={editing === undefined}>
          {(shown === 'profile' || shown === 'design' || shown === 'details' || block) && (
            <DrawerPanel title={panelTitle} subtitle={block ? titleOf(block) : undefined} onClose={close} saveState="clean"
              footerStart={block ? <span className="tf-linked__foot"><Button variant="ghost" icon={<Archive {...i16} />} onPress={() => archive(block.id, true)}>Archive</Button><Button variant="ghost" icon={<Trash2 {...i16} />} onPress={() => remove(block.id)}>Delete</Button></span> : undefined}>
              {fields}
              {more}
            </DrawerPanel>
          )}
        </div>
      </div>
      <div className="tf-linked__preview">
        <p className="tf-linked__preview-label">Preview · updates as you type</p>
        <div className="tf-linked__phone">
          <LinkPage profile={draft.profile} socials={draft.socials} blocks={draft.blocks} look={draft.look} accent={draft.accent} booking={booking} closing={draft.details?.closing} members={members} isPreview />
        </div>
      </div>
      {importing && <ImportLinks onClose={() => setImporting(false)} onAdd={(found) => { const made = found.map((x) => { nextId += 1; return { kind: 'link' as const, id: `new-link-${nextId}`, title: x.title, href: x.href }; }); setBlocks((bs) => [...bs, ...made]); setImporting(false); }} />}
      <PhotoCrop isOpen={cropping !== undefined} onOpenChange={(o) => { if (!o) setCropping(undefined); }} shape={cropping === 'avatar' ? 'round' : 'wide'} title={cropping === 'avatar' ? 'Profile photo' : cropping === 'cover' ? 'Cover photo' : 'Background photo'}
        src={cropping === 'avatar' ? draft.profile.avatarSrc : cropping === 'cover' ? draft.profile.cover : cropping === 'ground' ? draft.profile.ground : undefined}
        onSave={(src) => { if (cropping === 'avatar') setProfile({ avatarSrc: src }); else if (cropping === 'cover') setProfile({ cover: src }); else setProfile({ ground: src }); }} />
      {dropping && <Dialog isOpen onOpenChange={(o) => { if (!o) setDropping(undefined); }} title={`Delete ${titleOf(dropping)}?`} description="It leaves your page for good. Archive keeps it."
        actions={<><Button variant="ghost" slot="close">Cancel</Button><Button variant="danger" onPress={() => { const id = dropping.id; setBlocks((bs) => bs.filter((x) => x.id !== id)); setDropping(undefined); }}>Delete block</Button></>} />}
       <PublishBar status={barStatus} changes={Math.max(changes, published ? 0 : 1)} onPublish={() => { void publish(); }} onDiscard={() => { setDraft(live); setEditing(undefined); setDeleted(undefined); }} />
    </div>
    </div>
  );
}

/** Import from Linktree and the like: paste your page's links (or the page's text), review what was found, add the ones you want.
 *  It reads what you paste; it never fetches another site. */
export function ImportLinks({ onClose, onAdd }: { readonly onClose: () => void; readonly onAdd: (links: ReadonlyArray<{ readonly href: string; readonly title: string }>) => void }) {
  const [text, setText] = useState('');
  const [found, setFound] = useState<ReadonlyArray<{ readonly href: string; readonly title: string }>>();
  const [picked, setPicked] = useState<ReadonlySet<string>>(new Set());
  const onlyPage = found !== undefined && found.length === 0 && /linktr\.ee|beacons\.ai|bio\.link|lnk\.bio/i.test(text);
  return (
    <Dialog isOpen onOpenChange={(o) => { if (!o) onClose(); }} title="Bring your links across" description="From Linktree, Beacons or any page: paste its links, or select all on that page and paste."
      actions={found && found.length > 0 ? <><Button variant="ghost" onPress={() => setFound(undefined)}>Back</Button><Button variant="primary" isDisabled={picked.size === 0} onPress={() => onAdd(found.filter((x) => picked.has(x.href)))}>{`Add ${picked.size} ${picked.size === 1 ? 'link' : 'links'}`}</Button></>
        : <><Button variant="ghost" slot="close">Cancel</Button><Button variant="primary" isDisabled={!text.trim()} onPress={() => { const f = findLinks(text); setFound(f); setPicked(new Set(f.map((x) => x.href))); }}>Find links</Button></>}>
      {found && found.length > 0 ? (
        <div className="tf-linked__found">
          <p className="tf-linked__note">{found.length === 1 ? '1 link found.' : `${found.length} links found.`} Untick any you don’t want. They land at the end, as buttons.</p>
          <ul aria-label="Links found">{found.map((x) => <li key={x.href}><Checkbox isSelected={picked.has(x.href)} onChange={(on) => setPicked((p) => { const n = new Set(p); if (on) n.add(x.href); else n.delete(x.href); return n; })}><span className="tf-linked__text"><span className="tf-linked__title">{x.title}</span><span className="tf-linked__sub">{x.href}</span></span></Checkbox></li>)}</ul>
        </div>
      ) : (
        <div className="tf-linked__found">
          <TextArea label="Your links" rows={5} value={text} onChange={(v) => { setText(v); setFound(undefined); }} placeholder={'https://instagram.com/you\nhttps://youtube.com/@you\nhttps://yourshop.com'} />
          {found && <p className="tf-linked__note" role="alert">{onlyPage ? 'We can’t open other sites from here. Open your page there, select everything, copy it and paste it here: its links come with it.' : 'No links in that. Paste addresses that start with https:// or www.'}</p>}
          <Tag size="sm" hue="gray">Nothing is published until you do</Tag>
        </div>
      )}
    </Dialog>
  );
}
