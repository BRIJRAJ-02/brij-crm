// Brief
// Purpose: the editors of spec 0061's six kinds (R4): a socials row, a video or song, a picture, a gallery, a
// booking page's next times and a banner, each one Modal for an add and an edit, as every other kind's.
// Main task: fill a block's few fields and see it as a visitor will, then Add or Save; it shows on the list at once.
// Leaves out: saving itself (the screen does, through the data layer, optimistic), and drawing the blocks, which is
// the library's LinkPage.
import { describeLink } from '@crm/contracts/social';
import {
  isDataError,
  type BlockDraft,
  type BlockProblems,
  type DataLayer,
  type ProfilePageChoice,
  type ProfilePlaceChoice,
  type SocialLink,
  type SocialLinksAccess,
  type SocialLinksHeld,
  type SocialLinksState,
} from '@crm/data';
import { useSocialLinks } from '@crm/data/react';
import {
  Button,
  ButtonLink,
  Callout,
  ChoiceChips,
  EmptyState,
  Field,
  FileDrop,
  focusLater,
  Form,
  isSocialLinksDraftChanged,
  Select,
  Skeleton,
  SocialLinksEditor,
  socialLinksDraftOf,
  socialLinksOfDraft,
  type SocialLinkDraft,
  type SocialLinkItem,
} from '@crm/ui';
import { useRouteContext } from '@tanstack/react-router';
import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { linksHref } from '../booking/links.ts';
import { strings as socialsStrings } from '../booking/socials-strings.ts';
import { businessSettingsHref } from '../settings/nav.ts';
import {
  heldPicture,
  PICTURE_TYPES,
  PictureField,
  useBlockExtras,
  usePictureUpload,
  type HeldPicture,
} from './block-extras.tsx';
import { DraftPage } from './draft-look.tsx';
import { EditorModal, useFocusesFirstField } from './editors.tsx';
import { PICTURE_PICK_MAX_BYTES } from './photo-prep.ts';
import { reachStrings as words } from './reach-strings.ts';
import type { BlockEditorProps, SocialsKeeper } from './registry.tsx';
import { strings } from './strings.ts';
import { useLinkPagePlace } from './place.tsx';

/** The words under a refused field, or nothing. */
const errorOf = (problems: BlockProblems, key: keyof BlockProblems) =>
  problems[key] === undefined ? {} : { error: problems[key] };

/** A person's links as a page draws them: each with what it reads as ("@ada", "ada.dev"). */
export function drawnSocials(links: readonly SocialLink[]): readonly SocialLinkItem[] {
  return links.map((link) => ({ network: link.network, href: link.href, label: describeLink(link.href).label }));
}

/** The draft's links that check now, in order, for "How it looks" while they are typed. */
function draftLinks(rows: readonly SocialLinkDraft[]): readonly SocialLink[] {
  return rows.flatMap((row) => {
    const checked = socialLinksOfDraft([row]);
    return checked.ok ? checked.links : [];
  });
}

/** What stands in for the person's own links store until it has loaded: loading, read never. */
const LOADING_SOCIALS: SocialLinksState = { status: 'loading' };
const NO_SOCIALS: SocialLinksHeld = {
  subscribe: () => () => undefined,
  getSnapshot: () => LOADING_SOCIALS,
  retain: () => () => undefined,
  retry: () => undefined,
};

/**
 * The person's own links store (`data.profile.loadSocials()`), loaded on first use: undefined until then, or when
 * the page isn't theirs; `failed` when its module didn't load, with a way to ask again.
 */
function useOwnSocials(data: DataLayer, isOwn: boolean) {
  const [access, setAccess] = useState<SocialLinksAccess | undefined>(undefined);
  const [failed, setFailed] = useState(false);
  const [tries, setTries] = useState(0);
  useEffect(() => {
    if (!isOwn) return undefined;
    let isCurrent = true;
    data.profile.loadSocials().then(
      (loaded) => {
        if (isCurrent) setAccess(loaded);
      },
      () => {
        if (isCurrent) setFailed(true);
      },
    );
    return () => {
      isCurrent = false;
    };
  }, [data, isOwn, tries]);
  return {
    access,
    failed,
    retry: () => {
      setFailed(false);
      setTries((count) => count + 1);
    },
  };
}

/**
 * A socials row (AC-6104), with the links themselves (10 Nov 2026, the owner: added where the block is added, as on
 * Linktree, so inside a partner's frame and on Team pages there is somewhere to add them). Whose set it is decides who
 * may change it: your own (`self`, through your own links store, read before the fields show so a draft never starts
 * from an older set), a person with no login whose links a team page manager keeps (`team`), or someone who keeps
 * their own (`kept`), shown read only.
 */
export function SocialsEditor(props: BlockEditorProps) {
  const { data } = useRouteContext({ from: '__root__' });
  const keeper: SocialsKeeper = props.socialsKeeper ?? { kind: 'kept' };
  const own = useOwnSocials(data, keeper.kind === 'self');
  const held = own.access?.of(props.slug) ?? NO_SOCIALS;
  const ownState = useSocialLinks(held);
  const editing = props.item?.kind === 'socials' ? props.item : undefined;
  if (keeper.kind === 'self' && ownState.status !== 'ready') {
    const failed = own.failed || ownState.status === 'error';
    return (
      <EditorModal
        title={editing === undefined ? words.newSocials : words.editSocials}
        formId=""
        submitLabel={editing === undefined ? strings.add : strings.save}
        onClose={props.onClose}
        canSubmit={false}
        {...(props.chrome === undefined ? {} : { chrome: props.chrome })}
      >
        {failed ? (
          <Callout
            tone="danger"
            title={socialsStrings.failed}
            actions={<Button onPress={own.failed ? own.retry : held.retry}>{socialsStrings.tryAgain}</Button>}
          >
            {ownState.status === 'error' ? ownState.message : undefined}
          </Callout>
        ) : (
          <SocialLinksEditor rows={[]} onChange={() => undefined} tone="bare" isLoading />
        )}
      </EditorModal>
    );
  }
  // Your own set as your store holds it now; anyone else's as their page was read (or last saved here).
  const stored = keeper.kind === 'self' && ownState.status === 'ready' ? ownState.links : props.socialLinks;
  const isReadOnly = keeper.kind === 'kept' || (ownState.status === 'ready' && !ownState.canChange);
  return (
    <SocialsFields
      {...props}
      keeper={keeper}
      stored={stored}
      isReadOnly={isReadOnly}
      {...(own.access === undefined ? {} : { own: own.access })}
    />
  );
}

/** Whose read only links these are: the app that added them, or the person, in their own Profile. */
export function socialsKeptLine(keeper: SocialsKeeper): string {
  return keeper.kind === 'kept' && keeper.byApp !== undefined
    ? words.socialsByApp(keeper.byApp.name)
    : words.socialsKept;
}

/** The links and the block's own fields, once the set they start from is known. */
function SocialsFields({
  item,
  items,
  linkPage,
  slug,
  chrome,
  onSubmit,
  onClose,
  keeper,
  stored,
  isReadOnly,
  own,
}: BlockEditorProps & {
  readonly keeper: SocialsKeeper;
  readonly stored: readonly SocialLink[];
  readonly isReadOnly: boolean;
  readonly own?: SocialLinksAccess;
}) {
  const { data, toasts } = useRouteContext({ from: '__root__' });
  const focusFirst = useFocusesFirstField();
  const formId = useId();
  const editing = item?.kind === 'socials' ? item : undefined;
  const extras = useBlockExtras(editing, true);
  const [rows, setRows] = useState<readonly SocialLinkDraft[]>(() => socialLinksDraftOf(stored));
  const [errorFocus, setErrorFocus] = useState(0);
  // One save per Modal: a second press, or ⌘↵, while it closes sends nothing more.
  const isSent = useRef(false);
  const shown = draftLinks(rows);
  /** Their set saved through Team pages: shown on the phone at once, put back with Try again if refused. */
  const saveFor = (
    member: string,
    onShow: (links: readonly SocialLinkItem[]) => void,
    links: readonly SocialLink[],
  ) => {
    onShow(drawnSocials(links));
    data.teamPages.setSocials(slug, member, links).then(
      (saved) => {
        onShow(drawnSocials(saved));
      },
      (error: unknown) => {
        onShow(drawnSocials(stored));
        toasts.toast({
          tone: 'danger',
          message: isDataError(error) ? `${words.socialsNotSaved} ${error.message}` : words.socialsNotSaved,
          action: {
            label: socialsStrings.tryAgain,
            onAction: () => {
              saveFor(member, onShow, links);
            },
          },
        });
      },
    );
  };
  const submit = () => {
    if (isSent.current) return;
    const checked = socialLinksOfDraft(rows);
    if (!checked.ok) {
      setRows(checked.rows);
      setErrorFocus((count) => count + 1);
      return;
    }
    // A row with no links draws nothing on the page (⌘↵ submits a form with no submit shown).
    if (checked.links.length === 0) return;
    const draft: BlockDraft = { kind: 'socials', ...extras.draft };
    const block = linkPage.check(draft, items, editing?.id);
    if (!block.ok) {
      extras.take(block.problems);
      return;
    }
    isSent.current = true;
    if (!isReadOnly && isSocialLinksDraftChanged(rows, stored)) {
      // Your own: shown at once on the card and the phone; a refusal puts the set back and says so with Try again.
      if (keeper.kind === 'self' && own !== undefined) void own.change(slug, checked.links);
      else if (keeper.kind === 'team') saveFor(keeper.member, keeper.onShow, checked.links);
    }
    onSubmit(draft);
  };
  return (
    <EditorModal
      title={editing === undefined ? words.newSocials : words.editSocials}
      formId={formId}
      submitLabel={editing === undefined ? strings.add : strings.save}
      onClose={onClose}
      // A row with no links draws nothing on the page, so there is nothing to add until there is one.
      canSubmit={shown.length > 0}
      {...(chrome === undefined ? {} : { chrome })}
      preview={
        shown.length === 0 ? undefined : (
          <DraftPage
            layout="blocks"
            caption={strings.howItLooks}
            blocks={[{ kind: 'socials', id: editing?.id ?? 'draft', links: drawnSocials(shown) }]}
          />
        )
      }
    >
      <Form id={formId} onSubmit={submit} label={words.newSocials} focusesFirstField={focusFirst}>
        {/* Read only, the one line says whose they are; with none, it is all there is to say. */}
        {isReadOnly && <Callout tone="info">{socialsKeptLine(keeper)}</Callout>}
        {(!isReadOnly || rows.length > 0) && (
          <SocialLinksEditor
            rows={rows}
            onChange={setRows}
            tone="bare"
            errorFocus={errorFocus}
            {...(isReadOnly ? { isReadOnly: true } : {})}
          />
        )}
        {extras.fields}
      </Form>
    </EditorModal>
  );
}

/**
 * A video or a song (AC-6105, AC-6106): the share link and a title nobody has to give. The draft names the service
 * from the address's host, so "Plays from YouTube" shows as it is typed; the server parses it strictly on save.
 */
export function MediaEditor({ item, items, linkPage, slug, chrome, onSubmit, onClose }: BlockEditorProps) {
  const focusFirst = useFocusesFirstField();
  const formId = useId();
  const editing = item?.kind === 'media' ? item : undefined;
  const [url, setUrl] = useState(editing?.url ?? '');
  const [title, setTitle] = useState(editing?.title ?? '');
  const [problems, setProblems] = useState<BlockProblems>({});
  const extras = useBlockExtras(editing, true);
  const { rules } = linkPage.reach;
  const provider = rules.mediaProviderOf(url) ?? editing?.provider;
  const draft: BlockDraft = { kind: 'media', url, ...(title.trim() === '' ? {} : { title }), ...extras.draft };
  const submit = () => {
    const checked = linkPage.check(draft, items, editing?.id);
    if (!checked.ok) {
      setProblems(checked.problems);
      extras.take(checked.problems);
      return;
    }
    onSubmit(draft);
  };
  // The poster is the saved one's, until the link changes: a new link's poster is read once, on save.
  const poster = editing?.poster !== undefined && url === editing.url ? editing.poster : undefined;
  return (
    <EditorModal
      title={editing === undefined ? words.newMedia : words.editMedia}
      formId={formId}
      submitLabel={editing === undefined ? strings.add : strings.save}
      onClose={onClose}
      {...(chrome === undefined ? {} : { chrome })}
      preview={
        provider === undefined ? undefined : (
          <DraftPage
            layout="blocks"
            caption={strings.howItLooks}
            blocks={[
              {
                kind: 'media',
                id: editing?.id ?? 'draft',
                provider,
                title: title.trim() === '' ? (editing?.title ?? words.mediaUntitled) : title.trim(),
                frame: '',
                ...(poster === undefined ? {} : { poster: heldPicture(linkPage, slug, poster) }),
              },
            ]}
          />
        )
      }
    >
      <Form
        id={formId}
        onSubmit={submit}
        label={editing === undefined ? words.newMedia : words.editMedia}
        focusesFirstField={focusFirst}
      >
        <Field
          label={words.mediaUrl}
          name="url"
          type="url"
          inputMode="url"
          autoComplete="off"
          isRequired
          isVerbatim
          maxLength={2_000}
          placeholder={words.mediaUrlPlaceholder}
          hint={words.mediaUrlHint}
          value={url}
          onChange={(next) => {
            setUrl(next);
            setProblems((held) => ({ ...held, url: undefined }));
          }}
          {...errorOf(problems, 'url')}
        />
        <Field
          label={words.mediaTitle}
          name="title"
          autoComplete="off"
          maxLength={100}
          hint={words.mediaTitleHint}
          value={title}
          onChange={(next) => {
            setTitle(next);
            setProblems((held) => ({ ...held, title: undefined }));
          }}
          {...errorOf(problems, 'title')}
        />
        {extras.fields}
      </Form>
    </EditorModal>
  );
}

/** One picture (AC-6108): the picture itself, its description (required), a caption and a link nobody has to give. */
export function ImageEditor({ item, items, linkPage, slug, chrome, onSubmit, onClose }: BlockEditorProps) {
  const formId = useId();
  const editing = item?.kind === 'image' ? item : undefined;
  const [picture, setPicture] = useState<HeldPicture | undefined>(() =>
    editing === undefined ? undefined : heldPicture(linkPage, slug, editing.image),
  );
  const [alt, setAlt] = useState(editing?.alt ?? '');
  const [caption, setCaption] = useState(editing?.caption ?? '');
  const [url, setUrl] = useState(editing?.url ?? '');
  const [problems, setProblems] = useState<BlockProblems>({});
  const extras = useBlockExtras(editing, true);
  const [isSending, setSending] = useState(false);
  const draft: BlockDraft = {
    kind: 'image',
    ...(picture === undefined ? {} : { image: picture.image }),
    alt,
    caption,
    url,
    ...extras.draft,
  };
  const submit = () => {
    // Enter in a field submits too: a picture still on its way would be lost, so the save waits for it.
    if (isSending) return;
    const checked = linkPage.check(draft, items, editing?.id);
    if (!checked.ok) {
      setProblems(checked.problems);
      extras.take(checked.problems);
      return;
    }
    onSubmit(draft);
  };
  return (
    <EditorModal
      title={editing === undefined ? words.newImage : words.editImage}
      formId={formId}
      submitLabel={editing === undefined ? strings.add : strings.save}
      onClose={onClose}
      isWaiting={isSending}
      {...(chrome === undefined ? {} : { chrome })}
      preview={
        picture === undefined ? undefined : (
          <DraftPage
            layout="blocks"
            caption={strings.howItLooks}
            blocks={[
              {
                kind: 'image',
                id: editing?.id ?? 'draft',
                image: { src: picture.src, width: picture.width, height: picture.height },
                alt: alt.trim() === '' ? words.pictureAlt : alt.trim(),
                ...(caption.trim() === '' ? {} : { caption: caption.trim() }),
              },
            ]}
          />
        )
      }
    >
      <Form id={formId} onSubmit={submit} label={editing === undefined ? words.newImage : words.editImage}>
        <PictureField
          label={picture === undefined ? words.imagePick : words.imageReplace}
          linkPage={linkPage}
          slug={slug}
          {...(picture === undefined ? {} : { value: picture })}
          onChange={(next) => {
            if (next === undefined) return;
            setPicture(next);
            setProblems((held) => ({ ...held, image: undefined }));
          }}
          onSendingChange={setSending}
          {...(problems.image === undefined ? {} : { error: problems.image })}
        />
        <Field
          label={words.imageAlt}
          name="alt"
          autoComplete="off"
          isRequired
          maxLength={200}
          hint={words.imageAltHint}
          value={alt}
          onChange={(next) => {
            setAlt(next);
            setProblems((held) => ({ ...held, alt: undefined }));
          }}
          {...errorOf(problems, 'alt')}
        />
        <Field
          label={words.imageCaption}
          name="caption"
          autoComplete="off"
          maxLength={120}
          showCounter
          hint={words.imageCaptionHint}
          value={caption}
          onChange={(next) => {
            setCaption(next);
            setProblems((held) => ({ ...held, caption: undefined }));
          }}
          {...errorOf(problems, 'caption')}
        />
        <Field
          label={words.imageUrl}
          name="url"
          type="url"
          inputMode="url"
          autoComplete="off"
          isVerbatim
          maxLength={2_000}
          hint={words.imageUrlHint}
          value={url}
          onChange={(next) => {
            setUrl(next);
            setProblems((held) => ({ ...held, url: undefined }));
          }}
          {...errorOf(problems, 'url')}
        />
        {extras.fields}
      </Form>
    </EditorModal>
  );
}

/**
 * Two to twelve pictures (AC-6109): added several at once, each with its own description, moved up or taken out,
 * and shown as a swipe row or a grid. The pictures upload as they are picked; the gallery saves with Add or Save.
 */
export function GalleryEditor({ item, items, linkPage, slug, chrome, onSubmit, onClose }: BlockEditorProps) {
  const formId = useId();
  const editing = item?.kind === 'gallery' ? item : undefined;
  const { rules } = linkPage.reach;
  const [pictures, setPictures] = useState<readonly (HeldPicture & { readonly alt: string })[]>(
    () => editing?.images.map((each) => ({ ...heldPicture(linkPage, slug, each.image), alt: each.alt })) ?? [],
  );
  const [display, setDisplay] = useState<'row' | 'grid'>(editing?.display ?? 'row');
  const [problems, setProblems] = useState<BlockProblems>({});
  const extras = useBlockExtras(editing, true);
  const { toasts } = useRouteContext({ from: '__root__' });
  const { upload, isSending, cropper } = usePictureUpload(linkPage, slug);
  const draft: BlockDraft = {
    kind: 'gallery',
    images: pictures.map((each) => ({ image: each.image, alt: each.alt })),
    display,
    ...extras.draft,
  };
  const submit = () => {
    if (isSending) return;
    const checked = linkPage.check(draft, items, editing?.id);
    if (!checked.ok) {
      setProblems(checked.problems);
      extras.take(checked.problems);
      return;
    }
    onSubmit(draft);
  };
  const room = rules.galleryMax - pictures.length;
  /** Crops a picture already in the gallery again (spec 0068, AC-6809): the new one takes its place and keeps its words. */
  const recrop = (held: HeldPicture & { readonly alt: string }) => {
    void upload([held.src]).then(([again]) => {
      if (again === undefined) return;
      setPictures((now) => now.map((one) => (one.image === held.image ? { ...again, alt: one.alt } : one)));
    });
  };
  const change = (next: readonly (HeldPicture & { readonly alt: string })[]) => {
    setPictures(next);
    // A picture's reason is by its place, so a move or a removal clears them all rather than leave one on another.
    setProblems({});
  };
  /** Moves a picture one place, keeping focus on its own arrow (the other one where it reached an end). */
  const move = (at: number, by: -1 | 1) => {
    const to = at + by;
    const moving = pictures[at];
    const other = pictures[to];
    if (moving === undefined || other === undefined) return;
    const next = [...pictures];
    next[to] = moving;
    next[at] = other;
    change(next);
    // The same arrow while the picture can still go that way, else the other one.
    const canGoOn = by === -1 ? to > 0 : to < next.length - 1;
    const keep = (by === -1) === canGoOn ? words.galleryMoveUp(to + 1) : words.galleryMoveDown(to + 1);
    focusLater(() => document.querySelector<HTMLElement>(`[aria-label="${keep}"]`) ?? undefined);
  };
  /** Takes a picture out, then focuses the description now in its place, else the one before, else the drop zone. */
  const remove = (at: number) => {
    const next = pictures.filter((_one, place) => place !== at);
    change(next);
    focusLater(() => {
      const near = Math.min(at, next.length - 1);
      const field = near < 0 ? null : document.querySelector<HTMLElement>(`[name="alt-${String(near)}"]`);
      return (
        field ??
        document.querySelector<HTMLElement>(
          `[aria-label="${words.galleryAdd}"] button, [aria-label="${words.galleryAddFirst}"] button`,
        ) ??
        undefined
      );
    });
  };
  const drawn = pictures.map((each, at) => ({
    src: each.src,
    width: each.width,
    height: each.height,
    alt: each.alt.trim() === '' ? words.galleryAlt(at + 1) : each.alt.trim(),
  }));
  return (
    <EditorModal
      title={editing === undefined ? words.newGallery : words.editGallery}
      formId={formId}
      submitLabel={editing === undefined ? strings.add : strings.save}
      onClose={onClose}
      isWaiting={isSending}
      {...(chrome === undefined ? {} : { chrome })}
    >
      <Form id={formId} onSubmit={submit} label={editing === undefined ? words.newGallery : words.editGallery}>
        {/* The pictures as the page will show them, above their descriptions, so each numbered field sits under
            the picture it names: How it looks, where the descriptions are typed. */}
        {pictures.length > 0 && (
          <DraftPage
            layout="blocks"
            caption={strings.howItLooks}
            blocks={[{ kind: 'gallery', id: editing?.id ?? 'draft', images: drawn, display }]}
          />
        )}
        <FileDrop
          label={pictures.length === 0 ? words.galleryAddFirst : words.galleryAdd}
          acceptedTypes={PICTURE_TYPES}
          typesText={words.pictureTypes}
          maxSize={PICTURE_PICK_MAX_BYTES}
          allowsMultiple
          isPending={isSending}
          isDisabled={room <= 0}
          {...(problems.images === undefined ? {} : { error: problems.images })}
          onFiles={(files) => {
            if (files.length > room) toasts.toast({ tone: 'info', message: words.galleryRoom(room) });
            void upload(files.slice(0, room)).then((stored) => {
              setPictures((held) => [...held, ...stored.map((each) => ({ ...each, alt: '' }))]);
              setProblems((held) => ({ ...held, images: undefined }));
            });
          }}
        />
        {cropper}
        {room <= 0 && <Callout tone="info">{words.galleryFull}</Callout>}
        {pictures.map((each, at) => (
          <Field
            key={each.image}
            label={words.galleryAlt(at + 1)}
            name={`alt-${String(at)}`}
            autoComplete="off"
            isRequired
            maxLength={200}
            value={each.alt}
            onChange={(next) => {
              setPictures((held) => held.map((one) => (one.image === each.image ? { ...one, alt: next } : one)));
              setProblems((held) => ({ ...held, [`alt:${String(at)}`]: undefined }));
            }}
            {...errorOf(problems, `alt:${at}`)}
            after={
              <>
                {at > 0 && (
                  <Button
                    variant="ghost"
                    icon="arrow-up"
                    label={words.galleryMoveUp(at + 1)}
                    onPress={() => move(at, -1)}
                  />
                )}
                {at < pictures.length - 1 && (
                  <Button
                    variant="ghost"
                    icon="arrow-down"
                    label={words.galleryMoveDown(at + 1)}
                    onPress={() => move(at, 1)}
                  />
                )}
                <Button
                  variant="ghost"
                  icon="pencil"
                  label={words.galleryAdjust(at + 1)}
                  isDisabled={isSending}
                  onPress={() => {
                    recrop(each);
                  }}
                />
                <Button variant="ghost" icon="trash" label={words.galleryRemove(at + 1)} onPress={() => remove(at)} />
              </>
            }
          />
        ))}
        <ChoiceChips
          isSingle
          label={words.galleryDisplay}
          choices={[
            { id: 'row', label: words.galleryRow },
            { id: 'grid', label: words.galleryGrid },
          ]}
          selected={[display]}
          onChange={(picked) => {
            if (picked[0] === 'row' || picked[0] === 'grid') setDisplay(picked[0]);
          }}
        />
        {extras.fields}
      </Form>
    </EditorModal>
  );
}

/** The booking pages a next times block may name, as the chooser reads them. */
type TimesChoices =
  | { readonly status: 'loading' }
  | { readonly status: 'error' }
  | { readonly status: 'ready'; readonly choices: readonly ProfilePageChoice[] };

/**
 * A booking page's next open times (AC-6110): one of the person's Public pages, read fresh each time it opens, its
 * first length the one the chips are for. Editing one keeps its page and changes only its window.
 */
export function TimesChooser({ slug, item, items, linkPage, chrome, onSubmit, onClose }: BlockEditorProps) {
  // A partner's frame shares Link pages alone (spec 0070, AC-7033): no way out to another module's screens.
  const { isEmbedded } = useLinkPagePlace(slug);
  const focusFirst = useFocusesFirstField();
  const formId = useId();
  const editing = item?.kind === 'times' ? item : undefined;
  const [choices, setChoices] = useState<TimesChoices>(
    editing === undefined ? { status: 'loading' } : { status: 'ready', choices: [] },
  );
  const [picked, setPicked] = useState<string | null>(editing?.pageId ?? null);
  const [problems, setProblems] = useState<BlockProblems>({});
  const [attempt, setAttempt] = useState(0);
  const extras = useBlockExtras(editing, true);
  useEffect(() => {
    if (editing !== undefined) return undefined;
    let isCurrent = true;
    linkPage.pageChoices(slug).then(
      (found) => {
        if (!isCurrent) return;
        // A page another next times block already shows is left out: one block per page is enough.
        const placed = new Set(items.flatMap((each) => (each.kind === 'times' ? [each.pageId] : [])));
        const open = found.filter((choice) => !placed.has(choice.pageId));
        setChoices({ status: 'ready', choices: open });
        setPicked(open[0]?.pageId ?? null);
      },
      () => {
        if (isCurrent) setChoices({ status: 'error' });
      },
    );
    return () => {
      isCurrent = false;
    };
    // The blocks as the chooser opened: a change while it is open never reads the choices again.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [linkPage, slug, attempt]);
  const chosen = choices.status === 'ready' ? choices.choices.find((each) => each.pageId === picked) : undefined;
  const submit = () => {
    const draft: BlockDraft =
      editing === undefined
        ? {
            kind: 'times',
            ...(chosen === undefined ? {} : { workspaceId: chosen.workspaceId, pageId: chosen.pageId }),
            ...extras.draft,
          }
        : { kind: 'times', workspaceId: editing.workspaceId, pageId: editing.pageId, ...extras.draft };
    const checked = linkPage.check(draft, items, editing?.id);
    if (!checked.ok) {
      setProblems(checked.problems);
      extras.take(checked.problems);
      return;
    }
    const facts = chosen?.facts ?? editing?.page;
    onSubmit(draft, facts === undefined ? undefined : { page: facts });
  };
  const page = chosen?.facts ?? editing?.page;
  const minutes = page?.durations[0];
  let body: ReactNode;
  if (choices.status === 'loading') {
    body = <Skeleton shape="field" width="full" />;
  } else if (choices.status === 'error') {
    body = (
      <Callout
        tone="danger"
        actions={
          <Button
            onPress={() => {
              setChoices({ status: 'loading' });
              setAttempt((was) => was + 1);
            }}
          >
            {strings.retry}
          </Button>
        }
      >
        {strings.pagesFailed}
      </Callout>
    );
  } else if (editing === undefined && choices.choices.length === 0) {
    body = (
      <EmptyState
        layout="row"
        title={strings.noPagesYet}
        {...(isEmbedded ? {} : { actions: <ButtonLink href={linksHref(slug)}>{strings.noPagesAction}</ButtonLink> })}
      />
    );
  } else {
    body = (
      <Form
        id={formId}
        onSubmit={submit}
        label={editing === undefined ? words.newTimes : words.editTimes}
        focusesFirstField={focusFirst}
      >
        {editing === undefined ? (
          <Select
            label={words.timesPage}
            searchLabel={strings.pageSearch}
            hint={words.timesHint}
            items={choices.choices.map((choice) => ({
              id: choice.pageId,
              label: choice.facts.title,
              icon: 'calendar-clock',
              description: choice.facts.status === 'paused' ? strings.paused : '',
            }))}
            value={picked}
            onChange={(next) => {
              setPicked(next);
              setProblems((held) => ({ ...held, page: undefined }));
            }}
            {...errorOf(problems, 'page')}
          />
        ) : (
          <Field
            label={words.timesPage}
            isReadOnly
            readOnlyReason={strings.pageFixed}
            value={editing.page?.title ?? strings.bookingPage}
          />
        )}
        {extras.fields}
      </Form>
    );
  }
  return (
    <EditorModal
      title={editing === undefined ? words.newTimes : words.editTimes}
      formId={formId}
      submitLabel={editing === undefined ? strings.add : strings.save}
      onClose={onClose}
      {...(chrome === undefined ? {} : { chrome })}
      canSubmit={choices.status === 'ready' && (editing !== undefined || choices.choices.length > 0)}
      preview={
        page === undefined || minutes === undefined ? undefined : (
          <DraftPage
            layout="blocks"
            caption={strings.howItLooks}
            blocks={[
              {
                kind: 'times',
                id: editing?.id ?? 'draft',
                title: page.title,
                href: '',
                duration: minutes,
                times: { status: 'error' },
              },
            ]}
          />
        )
      }
    >
      {body}
    </EditorModal>
  );
}

/** One line at the very top of the page (AC-6112), with a link nobody has to give. One shows at a time. */
export function BannerEditor({ item, items, linkPage, chrome, onSubmit, onClose }: BlockEditorProps) {
  const focusFirst = useFocusesFirstField();
  const formId = useId();
  const editing = item?.kind === 'banner' ? item : undefined;
  const [text, setText] = useState(editing?.text ?? '');
  const [url, setUrl] = useState(editing?.url ?? '');
  const [problems, setProblems] = useState<BlockProblems>({});
  const extras = useBlockExtras(editing, false);
  const draft: BlockDraft = { kind: 'banner', text, url, ...extras.draft };
  const submit = () => {
    const checked = linkPage.check(draft, items, editing?.id);
    if (!checked.ok) {
      setProblems(checked.problems);
      extras.take(checked.problems);
      return;
    }
    onSubmit(draft);
  };
  return (
    <EditorModal
      title={editing === undefined ? words.newBanner : words.editBanner}
      formId={formId}
      submitLabel={editing === undefined ? strings.add : strings.save}
      onClose={onClose}
      {...(chrome === undefined ? {} : { chrome })}
      preview={
        <DraftPage
          layout="blocks"
          caption={strings.howItLooks}
          blocks={[
            {
              kind: 'banner',
              id: editing?.id ?? 'draft',
              text: text.trim() === '' ? words.bannerTextPlaceholder : text.trim(),
            },
          ]}
        />
      }
    >
      <Form
        id={formId}
        onSubmit={submit}
        label={editing === undefined ? words.newBanner : words.editBanner}
        focusesFirstField={focusFirst}
      >
        <Field
          label={words.bannerText}
          name="text"
          autoComplete="off"
          isRequired
          maxLength={80}
          showCounter
          placeholder={words.bannerTextPlaceholder}
          value={text}
          onChange={(next) => {
            setText(next);
            setProblems((held) => ({ ...held, text: undefined }));
          }}
          {...errorOf(problems, 'text')}
        />
        <Field
          label={words.bannerUrl}
          name="url"
          type="url"
          inputMode="url"
          autoComplete="off"
          isVerbatim
          maxLength={2_000}
          hint={words.bannerUrlHint}
          value={url}
          onChange={(next) => {
            setUrl(next);
            setProblems((held) => ({ ...held, url: undefined }));
          }}
          {...errorOf(problems, 'url')}
        />
        {extras.fields}
      </Form>
    </EditorModal>
  );
}

/** The places to choose from, as they load. */
type PlaceChoices =
  | { readonly status: 'loading' }
  | { readonly status: 'error' }
  | { readonly status: 'ready'; readonly choices: readonly ProfilePlaceChoice[] };

/**
 * A place's menu or its reservation page (spec 0065, AC-6528): one of the workspace's places, read fresh each time
 * it opens, and an optional label for the row. With one place it is picked already; a place whose block would be
 * hidden now (the menu unpublished or hidden, reservations off) says so beside it. Editing keeps the place.
 */
function PlaceChooser({
  which,
  slug,
  item,
  items,
  linkPage,
  chrome,
  onSubmit,
  onClose,
}: BlockEditorProps & { readonly which: 'menu' | 'reserve' }) {
  // A partner's frame shares Link pages alone (spec 0070, AC-7033): no way out to another module's screens.
  const { isEmbedded } = useLinkPagePlace(slug);
  const focusFirst = useFocusesFirstField();
  const formId = useId();
  const editing = item?.kind === 'menu' || item?.kind === 'reserve' ? item : undefined;
  const [choices, setChoices] = useState<PlaceChoices>({ status: 'loading' });
  const [picked, setPicked] = useState<string | null>(editing?.placeId ?? null);
  const [label, setLabel] = useState(editing?.label ?? '');
  const [problems, setProblems] = useState<BlockProblems>({});
  const [attempt, setAttempt] = useState(0);
  const extras = useBlockExtras(editing, false);
  const fallback = which === 'menu' ? words.menuTitle : words.reserveTitle;
  useEffect(() => {
    let isCurrent = true;
    linkPage.placeChoices(slug).then(
      (found) => {
        if (!isCurrent) return;
        const open = found.filter((choice) => (which === 'menu' ? choice.menu : choice.reserve) !== undefined);
        setChoices({ status: 'ready', choices: open });
        setPicked((was) => was ?? open[0]?.placeId ?? null);
      },
      () => {
        if (isCurrent) setChoices({ status: 'error' });
      },
    );
    return () => {
      isCurrent = false;
    };
  }, [linkPage, slug, which, attempt]);
  const factsOf = (choice: ProfilePlaceChoice | undefined) => (which === 'menu' ? choice?.menu : choice?.reserve);
  const chosen = choices.status === 'ready' ? choices.choices.find((each) => each.placeId === picked) : undefined;
  const facts = factsOf(chosen) ?? editing?.place;
  const submit = () => {
    const draft: BlockDraft = {
      kind: which,
      ...(picked === null ? {} : { placeId: picked }),
      ...(label.trim() === '' ? {} : { label }),
      ...extras.draft,
    };
    const checked = linkPage.check(draft, items, editing?.id);
    if (!checked.ok) {
      setProblems(checked.problems);
      extras.take(checked.problems);
      return;
    }
    onSubmit(draft, facts === undefined ? undefined : { place: facts });
  };
  let body: ReactNode;
  if (choices.status === 'loading') {
    body = <Skeleton shape="field" width="full" />;
  } else if (choices.status === 'error') {
    body = (
      <Callout
        tone="danger"
        actions={
          <Button
            onPress={() => {
              setChoices({ status: 'loading' });
              setAttempt((was) => was + 1);
            }}
          >
            {strings.retry}
          </Button>
        }
      >
        {words.placesFailed}
      </Callout>
    );
  } else if (editing === undefined && choices.choices.length === 0) {
    body = (
      <EmptyState
        layout="row"
        icon="store"
        title={words.noPlacesTitle}
        {...(isEmbedded
          ? {}
          : { actions: <ButtonLink href={businessSettingsHref(slug)}>{words.openBusiness}</ButtonLink> })}
      >
        {words.noPlacesText}
      </EmptyState>
    );
  } else {
    body = (
      <Form
        id={formId}
        onSubmit={submit}
        label={which === 'menu' ? words.newMenu : words.newReserve}
        focusesFirstField={focusFirst}
      >
        {editing === undefined ? (
          // One place is picked already: nothing to ask. Several, and the owner picks one.
          choices.choices.length < 2 ? null : (
            <Select
              label={words.place}
              searchLabel={words.placeSearch}
              items={choices.choices.map((choice) => {
                const each = factsOf(choice);
                return {
                  id: choice.placeId,
                  label: each?.name ?? '',
                  icon: 'store' as const,
                  description: each?.status === 'paused' ? words.placeOff(each.reason) : '',
                };
              })}
              value={picked}
              onChange={(next) => {
                setPicked(next);
                setProblems((held) => ({ ...held, placeId: undefined }));
              }}
              {...errorOf(problems, 'placeId')}
            />
          )
        ) : (
          <Field label={words.place} isReadOnly readOnlyReason={words.placeFixed} value={editing.place?.name ?? ''} />
        )}
        {facts?.status === 'paused' ? <Callout tone="warning">{words.placeOff(facts.reason)}</Callout> : null}
        <Field
          label={words.label}
          name="label"
          value={label}
          placeholder={fallback}
          maxLength={60}
          onChange={(next) => {
            setLabel(next);
            setProblems((held) => ({ ...held, label: undefined }));
          }}
          {...errorOf(problems, 'label')}
        />
        {extras.fields}
      </Form>
    );
  }
  const title =
    editing === undefined
      ? which === 'menu'
        ? words.newMenu
        : words.newReserve
      : which === 'menu'
        ? words.editMenu
        : words.editReserve;
  return (
    <EditorModal
      title={title}
      formId={formId}
      submitLabel={editing === undefined ? strings.add : strings.save}
      onClose={onClose}
      {...(chrome === undefined ? {} : { chrome })}
      canSubmit={choices.status === 'ready' && (editing !== undefined || choices.choices.length > 0)}
      preview={
        facts === undefined ? undefined : (
          <DraftPage
            layout="blocks"
            caption={strings.howItLooks}
            blocks={[
              which === 'menu'
                ? {
                    kind: 'menu',
                    id: editing?.id ?? 'draft',
                    title: label.trim() === '' ? fallback : label.trim(),
                    href: '',
                    dishes: [],
                  }
                : {
                    kind: 'reserve',
                    id: editing?.id ?? 'draft',
                    title: label.trim() === '' ? fallback : label.trim(),
                    href: '',
                  },
            ]}
          />
        )
      }
    >
      {body}
    </EditorModal>
  );
}

/** A place's menu block (spec 0065, AC-6528). */
export function MenuChooser(props: BlockEditorProps) {
  return <PlaceChooser {...props} which="menu" />;
}

/** A place's Reserve a table block (spec 0065, AC-6528). */
export function ReserveChooser(props: BlockEditorProps) {
  return <PlaceChooser {...props} which="reserve" />;
}
