// The link page's block registry (spec 0051, built as blocks): the one place a kind of block plugs into the editor.
// Each kind names its Add menu entry (label, line, icon), its editor Modal, how its row reads, what its Copy link
// copies, and how it draws in the preview (the library's LinkPage block). A later kind (text, a photo, a video, a
// form, an email capture) is one more entry here, a schema in `@crm/contracts`, and a renderer in LinkPage; the
// public page maps it in `public/booking/link-page.ts`. A kind the editor has no entry for is skipped, never a crash.
import type { BlockDraft, ProfileBlockKind, ProfileItem, ProfilePageChoice, ProfilePageFacts } from '@crm/data';
import type { IconName, LinkPageBlock, LinkPageMark } from '@crm/ui';
import type { ComponentType } from 'react';
import { HeadingEditor, LinkEditor, PageChooser } from './editors.tsx';
import { strings } from './strings.ts';

/** What a block's editor Modal is handed: the block being edited (none for an add), and what it needs to check. */
export interface BlockEditorProps {
  readonly item?: ProfileItem;
  /** The live blocks, for the checks the server keeps (a heading's text once). */
  readonly items: readonly ProfileItem[];
  /** The workspace the screen is in: the editors read through it. */
  readonly slug: string;
  /** The person's handle, for the preview's booking page addresses. */
  readonly handle: string;
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
  heading: {
    label: strings.addHeading,
    description: strings.addHeadingText,
    icon: 'type',
    Editor: HeadingEditor,
    isEditable: true,
  },
};

/** The Add menu's kinds, in order. */
export const ADDABLE: readonly ProfileBlockKind[] = ['page', 'link', 'heading'];

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

/** How a block's row reads. */
export function rowWords(item: ProfileItem): BlockRowWords {
  if (item.kind === 'link') return { title: item.title, address: shownAddress(item.url) };
  if (item.kind === 'heading') return { title: item.title, address: strings.heading };
  if (item.page === undefined) {
    return { title: strings.bookingPage, address: strings.unavailableText, badge: strings.unavailable, isOff: true };
  }
  const facts = pageFacts(item.page);
  return {
    title: item.page.title,
    address: [strings.bookingPage, item.page.workspaceName, ...(facts === '' ? [] : [facts])].join(' · '),
    ...(item.page.status === 'paused' ? { badge: strings.paused, isOff: true } : {}),
  };
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
