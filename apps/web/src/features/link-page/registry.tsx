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
  ProfileFormFacts,
  ProfilePageFacts,
} from '@crm/data';
import type { Hue, IconName, LinkPageBlock, LinkPageMark, SocialLinkItem } from '@crm/ui';
import type { ComponentType } from 'react';
import {
  ContactEditor,
  FaqEditor,
  FormChooser,
  HeadingEditor,
  LinkEditor,
  PageChooser,
  SignupEditor,
  TestimonialEditor,
  TextEditor,
} from './editors.tsx';
import {
  BannerEditor,
  GalleryEditor,
  ImageEditor,
  MediaEditor,
  SocialsEditor,
  TimesChooser,
} from './editors-reach.tsx';
import { reachStrings } from './reach-strings.ts';
import { strings } from './strings.ts';

/**
 * What the one Add modal lends an editor, so every kind is added in the same dialog rather than one dialog per
 * kind (the owner's Add item design). The dialog, its title, the kind picker and the footer's quiet line are the
 * frame's own and outlive the kind being changed (`BlockEditorFrame`, 25 October 2026); all the editor needs from
 * it is the word on the primary button, which says Add rather than Save. An edit opens the kind's own editor,
 * which brings its Modal with it, since nothing swaps under that one.
 */
export interface EditorChrome {
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
  /** The person's social links as the page draws them, for a socials row's "How it looks" (spec 0061). */
  readonly socialLinks: readonly SocialLinkItem[];
  /**
   * Checked and ready: the screen saves it (shown at once) and closes the Modal. A booking page comes with its
   * facts, so its row shows them before the server answers.
   */
  /**
   * The chosen page's or form's facts, so the row reads right before the server answers; and what to do once the
   * add lands: a new link's own site picture, fetched by the saved link's id (spec 0061, AC-6101).
   */
  readonly onSubmit: (draft: BlockDraft, facts?: ChosenFacts, after?: AfterSave) => void;
  readonly onClose: () => void;
}

/** What follows a save once it lands. */
export interface AfterSave {
  /** Fetch the saved link's own site picture as its thumbnail. */
  readonly siteThumb?: boolean;
}

/** What a chooser knows of what was picked, for the row it shows at once. */
export type ChosenFacts = { readonly page: ProfilePageFacts } | { readonly form: ProfileFormFacts };

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
  /** Its tile's tint in the Add modal's grid, so the kinds read apart at a glance (spec 0058, AC-9). */
  readonly hue: Hue;
  /** Its editor Modal, for an add and an edit. */
  readonly Editor: ComponentType<BlockEditorProps>;
  /** Whether Edit is offered (a booking page block has nothing of its own to edit). */
  readonly isEditable: boolean;
}

/**
 * What the Add modal offers (spec 0052, AC-5217): every block kind, and `signup`, which is not a kind. Email
 * signup makes a hosted form with one email field and then adds an ordinary `form` block for it, so it is an entry
 * in this picker and nothing else: no kind word, no column, no renderer and nothing new on the public page.
 */
export type AddableKind = ProfileBlockKind | 'signup';

/** Whether an entry makes a block of its own kind, or one of another kind (Email signup makes a form). */
export function blockKindOf(kind: AddableKind): ProfileBlockKind {
  return kind === 'signup' ? 'form' : kind;
}

/** The kinds this editor knows, in the Add menu's order. */
export const BLOCK_KINDS: Readonly<Record<AddableKind, BlockKind>> = {
  page: {
    label: strings.addPage,
    description: strings.addPageText,
    icon: 'calendar-clock',
    hue: 'green',
    Editor: PageChooser,
    // Its size and its window (spec 0061); the page itself is fixed, and pressing the row opens its own editor.
    isEditable: true,
  },
  link: {
    label: strings.addLink,
    description: strings.addLinkText,
    icon: 'link',
    hue: 'blue',
    Editor: LinkEditor,
    isEditable: true,
  },
  contact: {
    label: strings.addContact,
    description: strings.addContactText,
    icon: 'id-card',
    hue: 'sky',
    Editor: ContactEditor,
    isEditable: true,
  },
  text: {
    label: strings.addText,
    description: strings.addTextText,
    icon: 'file-text',
    hue: 'gray',
    Editor: TextEditor,
    isEditable: true,
  },
  form: {
    label: strings.addForm,
    description: strings.addFormText,
    icon: 'clipboard-list',
    hue: 'lime',
    Editor: FormChooser,
    // The label is the only thing an edit could change, and the chooser is where it is typed.
    isEditable: true,
  },
  faq: {
    label: strings.addFaq,
    description: strings.addFaqText,
    icon: 'circle-question-mark',
    hue: 'yellow',
    Editor: FaqEditor,
    isEditable: true,
  },
  signup: {
    label: strings.addSignup,
    description: strings.addSignupText,
    icon: 'mail',
    hue: 'orange',
    Editor: SignupEditor,
    isEditable: false,
  },
  testimonial: {
    label: strings.addTestimonial,
    description: strings.addTestimonialText,
    icon: 'message-square',
    hue: 'red',
    Editor: TestimonialEditor,
    isEditable: true,
  },
  socials: {
    label: reachStrings.addSocials,
    description: reachStrings.addSocialsText,
    icon: 'at-sign',
    hue: 'blue',
    Editor: SocialsEditor,
    isEditable: true,
  },
  media: {
    label: reachStrings.addMedia,
    description: reachStrings.addMediaText,
    icon: 'play',
    hue: 'red',
    Editor: MediaEditor,
    isEditable: true,
  },
  image: {
    label: reachStrings.addImage,
    description: reachStrings.addImageText,
    icon: 'image',
    hue: 'purple',
    Editor: ImageEditor,
    isEditable: true,
  },
  gallery: {
    label: reachStrings.addGallery,
    description: reachStrings.addGalleryText,
    icon: 'layers',
    hue: 'yellow',
    Editor: GalleryEditor,
    isEditable: true,
  },
  times: {
    label: reachStrings.addTimes,
    description: reachStrings.addTimesText,
    icon: 'clock',
    hue: 'sky',
    Editor: TimesChooser,
    isEditable: true,
  },
  banner: {
    label: reachStrings.addBanner,
    description: reachStrings.addBannerText,
    icon: 'megaphone',
    hue: 'orange',
    Editor: BannerEditor,
    isEditable: true,
  },
  heading: {
    label: strings.addHeading,
    description: strings.addHeadingText,
    icon: 'type',
    hue: 'gray',
    Editor: HeadingEditor,
    isEditable: true,
  },
};

/** The Add menu's kinds, in order. */
// The order the picker draws them in, from the owner's Add item board: the commonest first, the section last,
// and the one Add item opens on.
export const ADDABLE: readonly AddableKind[] = [
  'link',
  'page',
  'times',
  'form',
  'signup',
  'media',
  'image',
  'gallery',
  'socials',
  'text',
  'faq',
  'testimonial',
  'contact',
  'banner',
  'heading',
];

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

/** How a block's row reads; a link to one of our pages outside this workspace leads with saying so, and is off. */
export function rowWords(item: ProfileItem): BlockRowWords {
  // Spec 0061's kinds: what each is, in the words its Add tile uses, with what it holds after.
  if (item.kind === 'socials') return { title: reachStrings.socials, address: reachStrings.socialsRow };
  if (item.kind === 'media') {
    return {
      title: item.title ?? reachStrings.mediaUntitled,
      address: reachStrings.mediaRow(MEDIA_NAMES[item.provider]),
    };
  }
  if (item.kind === 'image') return { title: item.caption ?? item.alt, address: reachStrings.image };
  if (item.kind === 'gallery') {
    return { title: reachStrings.gallery, address: reachStrings.galleryCount(item.images.length) };
  }
  if (item.kind === 'banner') return { title: item.text, address: reachStrings.banner };
  if (item.kind === 'times') {
    const minutes = item.page?.durations[0];
    return item.page === undefined || minutes === undefined
      ? { title: reachStrings.addTimes, address: reachStrings.timesUnavailable, isOff: true }
      : {
          title: item.page.title,
          address: reachStrings.timesRow(minutes),
          ...(item.page.status === 'live' ? {} : { isOff: true }),
        };
  }
  if (item.kind === 'link') {
    return item.outsideWorkspace === true
      ? { title: item.title, address: `${strings.notInWorkspace} · ${shownAddress(item.url)}`, isOff: true }
      : { title: item.title, address: shownAddress(item.url) };
  }
  if (item.kind === 'heading')
    return { title: item.title, address: item.group === 'folder' ? strings.headingFolds : strings.heading };
  // Writing has nowhere to go, so its row reads as what it is, with its first line after it.
  if (item.kind === 'text') return { title: item.title ?? strings.text, address: item.body.split('\n')[0] ?? '' };
  // A testimonial has nowhere to go either: its row says who said it, with the words after.
  if (item.kind === 'testimonial') return { title: item.author, address: item.quote.split('\n')[0] ?? '' };
  // A set of questions has nowhere to go either: its row says how many it holds.
  if (item.kind === 'faq') return { title: item.title ?? strings.faq, address: strings.faqCount(item.items.length) };
  if (item.kind === 'form') {
    if (item.form === undefined) {
      return { title: strings.form, address: strings.formUnavailable, isOff: true };
    }
    const line = strings.formRow;
    return item.form.status === 'paused'
      ? { title: item.label, address: `${strings.formPaused} · ${line}`, isOff: true }
      : { title: item.label, address: line };
  }
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
    address: [...(isPaused ? [strings.pausedHidden] : []), strings.bookingPage, ...(facts === '' ? [] : [facts])].join(
      ' · ',
    ),
    ...(isPaused ? { isOff: true } : {}),
  };
}

/** Each media service's own name ("Plays from YouTube"): `MEDIA_PROVIDER_NAMES` in the contracts. */
const MEDIA_NAMES: Readonly<Record<'youtube' | 'vimeo' | 'spotify' | 'soundcloud' | 'applemusic', string>> = {
  youtube: 'YouTube',
  vimeo: 'Vimeo',
  spotify: 'Spotify',
  soundcloud: 'SoundCloud',
  applemusic: 'Apple Music',
};

/** A contact card's line: its job title and company, after "Contact card" in the editor's row. */
export function contactWords(card: { readonly jobTitle?: string; readonly company?: string }, inRow = false): string {
  return [...(inRow ? [strings.contactCard] : []), card.jobTitle, card.company]
    .filter((part): part is string => part !== undefined && part !== '')
    .join(' · ');
}

/**
 * Where a person's contact card is saved from: its vCard on this origin (AC-5114). With several cards (spec 0061,
 * AC-6114) each names its own with `?card=`; without one the first card answers, as every link shared before does.
 */
export function contactHref(handle: string, card?: string): string {
  const path = `/api/public/handles/${encodeURIComponent(handle)}/contact.vcf`;
  return card === undefined ? path : `${path}?${new URLSearchParams({ card }).toString()}`;
}

/**
 * A block as the preview draws it, or undefined for one a visitor wouldn't see (a paused or unavailable booking
 * page): the same LinkPage block the public page draws.
 */
export function previewBlock(
  item: ProfileItem,
  handle: string,
  markOf: (url: string) => LinkPageMark | undefined,
  more: PreviewMore = {},
): LinkPageBlock | undefined {
  // Outside its window a visitor doesn't see it, so neither does the phone (AC-6111): its row's chip says when.
  if (more.now !== undefined && item.kind !== 'heading' && !isShownAt(item, more.now)) return undefined;
  const picture = more.picture;
  if (item.kind === 'socials') {
    const links = more.socials ?? [];
    return links.length === 0 ? undefined : { kind: 'socials', id: item.id, links };
  }
  if (item.kind === 'media') {
    return {
      kind: 'media',
      id: item.id,
      provider: item.provider,
      title: item.title ?? reachStrings.mediaUntitled,
      // The phone never plays: its page is inert, so no frame is ever built here.
      frame: '',
      ...(item.poster === undefined || picture === undefined ? {} : { poster: picture(item.poster) }),
      ...(item.size === undefined ? {} : { size: item.size }),
    };
  }
  if (item.kind === 'image') {
    if (picture === undefined) return undefined;
    return {
      kind: 'image',
      id: item.id,
      image: picture(item.image),
      alt: item.alt,
      ...(item.caption === undefined ? {} : { caption: item.caption }),
      ...(item.url === undefined ? {} : { href: item.url }),
      ...(item.size === undefined ? {} : { size: item.size }),
    };
  }
  if (item.kind === 'gallery') {
    if (picture === undefined) return undefined;
    return {
      kind: 'gallery',
      id: item.id,
      images: item.images.map((each) => ({ ...picture(each.image), alt: each.alt })),
      display: item.display ?? 'row',
      ...(item.size === undefined ? {} : { size: item.size }),
    };
  }
  if (item.kind === 'banner') {
    return { kind: 'banner', id: item.id, text: item.text, ...(item.url === undefined ? {} : { href: item.url }) };
  }
  if (item.kind === 'times') {
    const minutes = item.page?.durations[0];
    if (item.page?.status !== 'live' || minutes === undefined) return undefined;
    return {
      kind: 'times',
      id: item.id,
      title: item.page.title,
      href: `/${encodeURIComponent(handle)}/${encodeURIComponent(item.page.slug)}`,
      duration: minutes,
      // The editor reads no times: the phone shows the block's title and More times, which is how it reads when
      // its times can't be read, and never a time that isn't real.
      times: { status: 'error' },
    };
  }
  if (item.kind === 'heading')
    return {
      kind: 'heading',
      id: item.id,
      title: item.title,
      ...(item.group === undefined ? {} : { group: item.group }),
    };
  if (item.kind === 'text') {
    return { kind: 'text', id: item.id, body: item.body, ...(item.title === undefined ? {} : { title: item.title }) };
  }
  if (item.kind === 'testimonial') {
    return {
      kind: 'testimonial',
      id: item.id,
      quote: item.quote,
      author: item.author,
      ...(item.role === undefined ? {} : { role: item.role }),
    };
  }
  if (item.kind === 'form') {
    // A form a visitor can't open now is left out of the phone, as a paused booking page is.
    if (item.form === undefined || item.form.status !== 'live') return undefined;
    return { kind: 'form', id: item.id, title: item.label, href: `/f/${item.form.key}` };
  }
  if (item.kind === 'faq') {
    return {
      kind: 'faq',
      id: item.id,
      items: item.items,
      ...(item.title === undefined ? {} : { title: item.title }),
    };
  }
  if (item.kind === 'contact') {
    const line = contactWords(item);
    return {
      kind: 'contact',
      id: item.id,
      title: item.fullName,
      href: contactHref(handle, item.id),
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
      ...(item.thumb === undefined || picture === undefined ? {} : { thumb: picture(item.thumb) }),
      ...(item.style === undefined ? {} : { style: item.style }),
      ...(item.notice === undefined ? {} : { notice: item.notice }),
      ...(item.size === undefined ? {} : { size: item.size }),
    };
  }
  if (item.page?.status !== 'live') return undefined;
  return {
    kind: 'page',
    id: item.id,
    title: item.page.title,
    href: `/${encodeURIComponent(handle)}/${encodeURIComponent(item.page.slug)}`,
    facts: pageFacts(item.page),
    ...(item.size === undefined ? {} : { size: item.size }),
  };
}

/** What the phone needs beyond a block itself to draw spec 0061's kinds. */
export interface PreviewMore {
  /** A stored picture as the owner's browser reads it. Without it, pictures are left out. */
  readonly picture?: (imageId: string) => { readonly src: string; readonly width: number; readonly height: number };
  /** The person's social links, for a socials row. */
  readonly socials?: readonly SocialLinkItem[];
  /** Now, for the window: a block outside its window is left out, as the public read leaves it out. */
  readonly now?: Date;
}

/** Whether a block is inside its window at `now` (AC-6111): from its start, until its end. */
export function isShownAt(item: ProfileItem, now: Date): boolean {
  if (item.kind === 'heading') return true;
  const at = now.getTime();
  if (item.showFrom !== undefined && Date.parse(item.showFrom) > at) return false;
  return !(item.hideAfter !== undefined && Date.parse(item.hideAfter) <= at);
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
  // A heading, a piece of writing and a set of questions have nowhere to go, so none of them counts a press
  // (AC-5207, AC-5211): a chip saying "No clicks yet" on one would read as a block nobody presses, not one
  // that cannot be pressed.
  if (
    counts === undefined ||
    item.kind === 'heading' ||
    item.kind === 'text' ||
    item.kind === 'faq' ||
    item.kind === 'testimonial' ||
    // A socials row's presses are its links', a gallery's open a viewer, and a picture without a link goes nowhere.
    item.kind === 'socials' ||
    item.kind === 'gallery' ||
    (item.kind === 'image' && item.url === undefined)
  ) {
    return [];
  }
  const presses = counts.presses.find((each) => each.id === item.id)?.presses ?? 0;
  return [presses === 0 ? strings.noPresses : strings.presses(presses)];
}
