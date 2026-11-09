import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Button as AriaButton, DropIndicator, GridList, GridListItem, useDragAndDrop } from 'react-aria-components';
import { AtSign, CalendarDays, GripVertical, Heading, Link2, Minus, Plus, Trash2 } from 'lucide-react';
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
import { LinkPage, LINK_ICONS, LINK_PAGE_LOOKS, linkIcon, type LinkBlock, type LinkIconName, type LinkPageBooking, type LinkPageLook, type LinkPageProfile, type LinkStyle } from '../LinkPage/LinkPage.tsx';
import { detectNetwork, reorderIds, SocialLinksEditor, SocialMark, socialLabel, type SocialLink } from '../SocialLinks/SocialLinks.tsx';
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
}

/** Props for LinkEditor. */
export interface LinkEditorProps {
  /** The page as guests see it now. */
  readonly live: LinkPageDraft;
  /** Resolves once the draft is live. */
  readonly onPublish: (page: LinkPageDraft) => Promise<void>;
  readonly booking?: LinkPageBooking;
}

type Kind = LinkBlock['kind'];
const KIND_LABEL: Readonly<Record<Kind, string>> = { link: 'Link', header: 'Header', booking: 'Booking', social: 'Social icons', divider: 'Divider' };
const KIND_ICON: Readonly<Record<Kind, ReactNode>> = { link: <Link2 {...i16} />, header: <Heading {...i16} />, booking: <CalendarDays {...i16} />, social: <AtSign {...i16} />, divider: <Minus {...i16} /> };

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
  return n;
}

function describe(b: LinkBlock, socials: number): string {
  if (b.kind === 'link') return socialLabel(b.href) || 'No address yet';
  if (b.kind === 'booking') return `${b.durationMinutes} min · ${b.location.label}`;
  if (b.kind === 'social') return `${socials} ${socials === 1 ? 'network' : 'networks'}`;
  return KIND_LABEL[b.kind];
}
const titleOf = (b: LinkBlock) => (b.kind === 'link' || b.kind === 'header' || b.kind === 'booking' ? b.title || 'Untitled' : KIND_LABEL[b.kind]);

let nextId = 0;
function newBlock(kind: Kind): LinkBlock {
  nextId += 1;
  const id = `new-${kind}-${nextId}`;
  if (kind === 'link') return { kind, id, title: '', href: '' };
  if (kind === 'header') return { kind, id, title: 'New section' };
  if (kind === 'booking') return { kind, id, title: 'Intro call', durationMinutes: 15, location: { kind: 'video', label: 'Google Meet' } };
  return { kind, id };
}

/** The link page editor: blocks on the left (drag to reorder, switch to hide, press to edit in a side panel), a live phone preview on the right, and the PublishBar once the draft differs from the live page. */
export function LinkEditor({ live: initial, onPublish, booking }: LinkEditorProps) {
  const [live, setLive] = useState(initial);
  const [draft, setDraft] = useState(initial);
  const [editing, setEditing] = useState<string>();
  const [fresh, setFresh] = useState<string>();
  const [washed, setWashed] = useState<string>();
  const [deleted, setDeleted] = useState<{ readonly block: LinkBlock; readonly index: number }>();
  const [status, setStatus] = useState<Exclude<PublishBarStatus, 'live' | 'draft'>>();
  const timers = useRef<number[]>([]);
  useEffect(() => () => timers.current.forEach((t) => window.clearTimeout(t)), []);
  const later = (ms: number, fn: () => void) => { timers.current.push(window.setTimeout(fn, ms)); };

  const changes = changesBetween(draft, live);
  const barStatus: PublishBarStatus = status ?? (changes > 0 ? 'draft' : 'live');
  const setBlocks = (fn: (b: ReadonlyArray<LinkBlock>) => ReadonlyArray<LinkBlock>) => setDraft((d) => ({ ...d, blocks: fn(d.blocks) }));
  const patch = (id: string, p: Partial<LinkBlock>) => setBlocks((bs) => bs.map((b) => (b.id === id ? ({ ...b, ...p } as LinkBlock) : b)));
  // The panel keeps showing what it edited while it slides away.
  const lastEditing = useRef<string | undefined>(undefined);
  if (editing !== undefined) lastEditing.current = editing;
  const shown = editing ?? lastEditing.current;
  const block = draft.blocks.find((b) => b.id === shown);

  const publish = async () => {
    setStatus('publishing');
    await onPublish(draft);
    setLive(draft); setStatus('published');
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

  const { dragAndDropHooks } = useDragAndDrop({
    getItems: (keys) => [...keys].map((k) => ({ 'text/plain': String(k) })),
    onReorder: (e) => { if (e.target.dropPosition !== 'on') { const pos = e.target.dropPosition; const key = String(e.target.key); setBlocks((bs) => reorderIds(bs, [...e.keys].map(String), key, pos)); } },
    renderDropIndicator: (target) => <DropIndicator target={target} className="tf-linked__slot" />,
  });

  const hasSocial = draft.blocks.some((b) => b.kind === 'social');
  const list = (
    <div className="tf-linked__list">
      <section className="tf-linked__section" aria-label="Look">
        <SegmentedControl aria-label="Look" size="sm" isFullWidth items={LINK_PAGE_LOOKS.map((l) => ({ id: l.id, label: l.label }))} selectedKey={draft.look} onSelectionChange={(k) => setDraft((d) => ({ ...d, look: k as LinkPageLook }))} />
        <div className="tf-linked__custom" data-open={draft.look === 'custom' || undefined} inert={draft.look !== 'custom'}>
          <div className="tf-linked__custom-clip"><AccentPicker label="Button colour" value={draft.accent} onChange={(accent) => setDraft((d) => ({ ...d, accent }))} /></div>
        </div>
      </section>
      <AriaButton className="tf-linked__profile" onPress={() => setEditing('profile')}>
        <Avatar name={draft.profile.name || '?'} size={36} />
        <span className="tf-linked__text"><span className="tf-linked__title">{draft.profile.name || 'Your name'}</span><span className="tf-linked__sub">{draft.profile.bio || 'Add a short bio'}</span></span>
      </AriaButton>
      <div className="tf-linked__bar">
        <h3 className="tf-linked__heading">Blocks</h3>
        <MenuTrigger>
          <Button size="sm" icon={<Plus size={14} strokeWidth={1.75} />}>Add block</Button>
          <Menu aria-label="Add block" placement="bottom end" onAction={(k) => add(String(k) as Kind)}>
            <MenuItem id="link" icon={KIND_ICON.link} description="A button to any address">Link</MenuItem>
            <MenuItem id="booking" icon={KIND_ICON.booking} description="Opens your booking calendar">Booking</MenuItem>
            <MenuItem id="header" icon={KIND_ICON.header} description="A small title over a group">Header</MenuItem>
            {!hasSocial ? <MenuItem id="social" icon={KIND_ICON.social} description="Your social marks, placed here">Social icons</MenuItem> : null}
            <MenuItem id="divider" icon={KIND_ICON.divider}>Divider</MenuItem>
          </Menu>
        </MenuTrigger>
      </div>
      <GridList aria-label="Blocks, in page order" items={draft.blocks} dragAndDropHooks={dragAndDropHooks} className="tf-linked__blocks"
        onAction={(k) => { const b = draft.blocks.find((x) => x.id === k); if (b && b.kind !== 'divider') setEditing(String(k)); }}>
        {(b) => (
          <GridListItem id={b.id} textValue={titleOf(b)} className={cx('tf-linked__row', fresh === b.id && 'is-new', washed === b.id && 'is-changed', b.hidden && 'is-hidden')}>
            <span className="tf-linked__rowin">
              <AriaButton slot="drag" className="tf-linked__grip" aria-label={`Move ${titleOf(b)}`}><GripVertical size={14} strokeWidth={1.75} /></AriaButton>
              <span className="tf-linked__tile" aria-hidden="true">{b.kind === 'link' ? linkIcon(b, 16) ?? KIND_ICON.link : KIND_ICON[b.kind]}</span>
              <span className="tf-linked__text">
                <span className="tf-linked__title">{titleOf(b)}</span>
                <span className="tf-linked__sub">{b.hidden ? 'Hidden · ' : ''}{describe(b, draft.socials.length)}</span>
              </span>
              {b.kind === 'link' && b.clicks !== undefined && <ClickCount clicks={b.clicks} />}
              <Switch aria-label={`Show ${titleOf(b)} on the page`} isSelected={!b.hidden} onChange={(on) => patch(b.id, { hidden: !on })} />
            </span>
          </GridListItem>
        )}
      </GridList>
      {deleted && (
        <p className="tf-linked__undo" role="status"><span>{titleOf(deleted.block)} deleted</span><Button size="sm" variant="ghost" onPress={undo}>Undo</Button></p>
      )}
    </div>
  );

  const fields = (() => {
    if (shown === 'profile') {
      return (
        <>
          <TextField label="Name" value={draft.profile.name} onChange={(name) => setDraft((d) => ({ ...d, profile: { ...d.profile, name } }))} />
          <TextArea label="Bio" aside="Optional" showCount maxLength={120} value={draft.profile.bio ?? ''} onChange={(bio) => setDraft((d) => ({ ...d, profile: { ...d.profile, bio } }))} />
        </>
      );
    }
    if (!block) return null;
    if (block.kind === 'link') {
      const net = detectNetwork(block.href);
      return (
        <>
          <TextField label="Title" value={block.title} placeholder="What the button says" onChange={(title) => patch(block.id, { title })} />
          <TextField label="Address" type="url" value={block.href} placeholder="https://" onChange={(href) => patch(block.id, { href })}
            icon={<span className="tf-linked__detected" key={net ?? 'none'}>{net ? <SocialMark network={net} size={16} /> : <Link2 {...i16} />}</span>} />
          <TextField label="Line under the title" aside="Optional" value={block.subtitle ?? ''} onChange={(subtitle) => patch(block.id, { subtitle: subtitle || undefined })} />
          <Select label="Shown as" items={[{ id: 'button', label: 'Button' }, { id: 'tile', label: 'Tile, two to a row' }, { id: 'featured', label: 'Featured card with picture' }]}
            value={block.style ?? 'button'} onChange={(s) => patch(block.id, { style: (s ?? 'button') as LinkStyle })} />
          <Select label="Icon" items={[{ id: 'auto', label: net && net !== 'website' ? 'Network mark' : 'None' }, ...(Object.keys(LINK_ICONS) as LinkIconName[]).map((k) => ({ id: k, label: LINK_ICONS[k].label, icon: LINK_ICONS[k].icon(16) }))]}
            value={block.icon ?? 'auto'} onChange={(k) => patch(block.id, { icon: k === 'auto' || k === null ? undefined : (k as LinkIconName) })} />
        </>
      );
    }
    if (block.kind === 'header') return <TextField label="Title" value={block.title} onChange={(title) => patch(block.id, { title })} />;
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
    if (block.kind === 'social') return <SocialLinksEditor links={draft.socials} onChange={(socials) => setDraft((d) => ({ ...d, socials }))} />;
    return null;
  })();

  const panelTitle = shown === 'profile' ? 'Profile' : block ? `Edit ${KIND_LABEL[block.kind].toLowerCase()}` : '';
  return (
    <div className="tf-linked-host">
    <div className="tf-linked">
      <div className="tf-linked__side">
        {/* 08 page side-by-side: the list waits 8px left, the panel comes from 8px right, both through a 3px blur. */}
        <div className="tf-linked__pane" data-pos={editing ? 'before' : 'current'} inert={editing !== undefined}>{list}</div>
        <div className="tf-linked__pane" data-pos={editing ? 'current' : 'after'} inert={editing === undefined}>
          {(shown === 'profile' || block) && (
            <DrawerPanel title={panelTitle} subtitle={shown === 'profile' ? undefined : block ? titleOf(block) : undefined} onClose={close} saveState="clean"
              footerStart={block ? <Button variant="ghost" icon={<Trash2 {...i16} />} onPress={() => remove(block.id)}>Delete</Button> : undefined}>
              {fields}
            </DrawerPanel>
          )}
        </div>
      </div>
      <div className="tf-linked__preview">
        <p className="tf-linked__preview-label">Preview · updates as you type</p>
        <div className="tf-linked__phone">
          <LinkPage profile={draft.profile} socials={draft.socials} blocks={draft.blocks} look={draft.look} accent={draft.accent} booking={booking} isPreview />
        </div>
      </div>
      <PublishBar status={barStatus} changes={changes} onPublish={() => { void publish(); }} onDiscard={() => { setDraft(live); setEditing(undefined); setDeleted(undefined); }} />
    </div>
    </div>
  );
}
