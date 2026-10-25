// The link page's block registry (spec 0051, built as blocks): the one place a kind of block plugs into the editor.
// Each kind names its Add menu entry (label, line, icon), its editor Modal, how its row reads, what its Copy link
// copies, and how it draws in the preview (the library's LinkPage block). A later kind (text, a photo, a video, a
// form, an email capture) is one more entry here, a schema in `@crm/contracts`, and a renderer in LinkPage; the
// public page maps it in `public/booking/link-page.ts`. A kind the editor has no entry for is skipped, never a crash.
import type {
  BlockDraft,
  LinkPageStore,
  ProfileCounts,
  ProfileBlockKind,
  ProfileItem,
  ProfilePageChoice,
  ProfilePageFacts,
} from '@crm/data';
import type { Hue, IconName, LinkPageBlock, LinkPageMark } from '@crm/ui';
import type { ComponentType, ReactNode } from 'react';
import { ContactEditor, HeadingEditor, LinkEditor, PageChooser, TextEditor } from './editors.tsx';
import { strings } from './strings.ts';

/**
 * What the one Add modal lends an editor, so every kind is added in the same dialog rather than one dialog per
 * kind (the owner's Add item design): its title, the kind picker above the fields, the footer's quiet line and
 * the primary button's word. An edit opens the kind's own editor with none of it, as before.
 */
export interface EditorChrome {
  readonly title?: string;
  readonly leading?: ReactNode;
  readonly hint?: ReactNode;
  readonly submitLabel?: string;
}

/** What a block's editor Modal is handed: the block being edited (none for an add), and what it needs to check. */
export interface BlockEditorProps {
  readonly item?: ProfileItem;
  /** Set only while the one Add modal is open: see EditorChrome. */
  readonly chrome?: EditorChrome;
  /** The live blocks, for the checks the server keeps (a heading's text once). */
  readonly items: readonly ProfileItem[];
  /** The workspace the screen is in: the editors read through it. */
  readonly slug: string;
  /** The person's handle, for the preview's booking page addresses. */
  readonly handle: string;
  /** The colour a new link's letter takes once saved, so "How it looks" shows it before. */
  readonly newHue: Hue;
  /** The link page's store: its checks, marks and the booking pages to choose from. */
  readonly linkPage: LinkPageStore;
  /** The networks already in the person's social icons: a link to one is allowed, with a quiet note saying so. */
  readonly socialNetworks: readonly string[];
  /** The person's name, a new contact card's full name to start from. */
  readonly ownerName: string;
  /**
   * Checked and ready: the screen saves it (shown at once) and closes the Modal. A booking page comes with its
   * facts, so its row shows them before the server answers.
   */
  readonly onSubmit: (draft: BlockDraft, page?: ProfilePageFacts) => void;
  readonly onClose: () => void;
}

/** How a block's row reads in the editor's list. */
export interface BlockRowWords {
  readonly title: string;
  /** The muted words after the title: a link's address, "Booking page · Acme · 30 min", "Heading". */
  readonly address: string;
  /** A state that comes and goes: Paused, Unavailable. */
  readonly badge?: string;
  readonly isOff?: boolean;
}

/** One kind's entry. */
export interface BlockKind {
  /** The Add menu's entry. */
  readonly label: string;
  readonly description: string;
  readonly icon: IconName;
  /** Its editor Modal, for an add and an edit. */
  readonly Editor: ComponentType<BlockEditorProps>;
  /** Whether Edit is offered (a booking page block has nothing of its own to edit). */
  readonly isEditable: boolean;
}

/** The kinds this editor knows, in the Add menu's order. */
export const BLOCK_KINDS: Readonly<Record<ProfileBlockKind, BlockKind>> = {
  page: {
    label: strings.addPage,
    description: strings.addPageText,
    icon: 'calendar-clock',
    Editor: PageChooser,
    isEditable: false,
  },
  link: {
    label: strings.addLink,
    description: strings.addLinkText,
    icon: 'link',
    Editor: LinkEditor,
    isEditable: true,
  },
  contact: {
    label: strings.addContact,
    description: strings.addContactText,
    icon: 'id-card',
    Editor: ContactEditor,
    isEditable: true,
  },
  text: {
    label: strings.addText,
    description: strings.addTextText,
    icon: 'file-text',
    Editor: TextEditor,
    isEditable: true,
  },
  heading: {
    label: strings.addHeading,
    description: strings.addHeadingText,
    icon: 'type',
    Editor: HeadingEditor,
    isEditable: true,
  },
};

/** The Add menu's kinds, in order. */
// The order the picker draws them in, from the owner's Add item board: the commonest first, the section last,
// and the one Add item opens on.
export const ADDABLE: readonly ProfileBlockKind[] = ['link', 'page', 'text', 'contact', 'heading'];

/** A booking page's lengths and kind, said once: "30 min · 60 min · Team". */
export function pageFacts(page: { readonly durations: readonly number[]; readonly isTeam: boolean }): string {
  return [...page.durations.map((minutes) => strings.minutes(minutes)), ...(page.isTeam ? [strings.team] : [])].join(
    ' · ',
  );
}

/** A link's address as its row shows it: without the scheme for a web address. */
function shownAddress(url: string): string {
  return url.replace(/^https?:\/\//i, '').replace(/\/$/, '');
}

/** How a block's row reads; a booking page names its workspace only when the person's pages come from several. */
export function rowWords(item: ProfileItem, namesWorkspace = false): BlockRowWords {
  if (item.kind === 'link') return { title: item.title, address: shownAddress(item.url) };
  if (item.kind === 'heading') return { title: item.title, address: strings.heading };
  // Writing has nowhere to go, so its row reads as what it is, with its first line after it.
  if (item.kind === 'text') return { title: item.title ?? strings.text, address: item.body.split('\n')[0] ?? '' };
  if (item.kind === 'contact') return { title: item.fullName, address: contactWords(item, true) };
  if (item.page === undefined) {
    // Unavailable leads the line, as Paused does, so a phone keeps the row on one line.
    return {
      title: strings.bookingPage,
      address: `${strings.unavailableLine} · ${strings.unavailableText}`,
      isOff: true,
    };
  }
  const facts = pageFacts(item.page);
  const isPaused = item.page.status === 'paused';
  // Paused leads the line rather than standing as a badge at the row's end, so a phone keeps the title on one line.
  return {
    title: item.page.title,
    address: [
      ...(isPaused ? [strings.pausedHidden] : []),
      strings.bookingPage,
      ...(namesWorkspace ? [item.page.workspaceName] : []),
      ...(facts === '' ? [] : [facts]),
    ].join(' · '),
    ...(isPaused ? { isOff: true } : {}),
  };
}

/** A contact card's line: its job title and company, after "Contact card" in the editor's row. */
export function contactWords(card: { readonly jobTitle?: string; readonly company?: string }, inRow = false): string {
  return [...(inRow ? [strings.contactCard] : []), card.jobTitle, card.company]
    .filter((part): part is string => part !== undefined && part !== '')
    .join(' · ');
}

/** Where a person's contact card is saved from: its vCard on this origin (AC-5114). */
export function contactHref(handle: string): string {
  return `/api/public/handles/${encodeURIComponent(handle)}/contact.vcf`;
}

/**
 * A block as the preview draws it, or undefined for one a visitor wouldn't see (a paused or unavailable booking
 * page): the same LinkPage block the public page draws.
 */
export function previewBlock(
  item: ProfileItem,
  handle: string,
  markOf: (url: string) => LinkPageMark | undefined,
): LinkPageBlock | undefined {
  if (item.kind === 'heading') return { kind: 'heading', id: item.id, title: item.title };
  if (item.kind === 'text') {
    return { kind: 'text', id: item.id, body: item.body, ...(item.title === undefined ? {} : { title: item.title }) };
  }
  if (item.kind === 'contact') {
    const line = contactWords(item);
    return {
      kind: 'contact',
      id: item.id,
      title: item.fullName,
      href: contactHref(handle),
      ...(line === '' ? {} : { line }),
    };
  }
  if (item.kind === 'link') {
    const mark = markOf(item.url);
    return {
      kind: 'link',
      id: item.id,
      title: item.title,
      href: item.url,
      hue: item.hue,
      ...(item.note === undefined ? {} : { note: item.note }),
      ...(mark === undefined ? {} : { mark }),
      ...(item.icon === undefined ? {} : { icon: item.icon }),
    };
  }
  if (item.page?.status !== 'live') return undefined;
  return {
    kind: 'page',
    id: item.id,
    title: item.page.title,
    href: `/${encodeURIComponent(handle)}/${encodeURIComponent(item.page.slug)}`,
    facts: pageFacts(item.page),
  };
}

/** A booking page choice as a block shown before the server answers. */
export function pageItem(id: string, choice: ProfilePageChoice): ProfileItem {
  return {
    kind: 'page',
    id,
    workspaceId: choice.workspaceId,
    pageId: choice.pageId,
    page: choice.facts,
    updatedAt: new Date().toISOString(),
  };
}

/** The page's figures as one sentence under the Blocks heading (AC-5127): views, visitors, and the change. */
export function figuresLine(counts: ProfileCounts): string {
  const { days, views, visitors, before } = counts;
  if (views === 0) return before.views === 0 ? strings.noViewsYet(days) : strings.noViews(days, before.views);
  const said = strings.views(views, visitors, days);
  if (before.views === 0) return `${said}.`;
  if (views > before.views) return said + strings.viewsUp(before.views, days);
  if (views < before.views) return said + strings.viewsDown(before.views, days);
  return said + strings.viewsSame(days);
}

/** A block's presses as its row's chip, said as clicks: none for a heading (it can't be pressed), "No clicks yet" for zero. */
export function pressesChip(item: ProfileItem, counts: ProfileCounts | undefined): readonly string[] {
  if (counts === undefined || item.kind === 'heading') return [];
  const presses = counts.presses.find((each) => each.id === item.id)?.presses ?? 0;
  return [presses === 0 ? strings.noPresses : strings.presses(presses)];
}
