// Brief
// Purpose: the editors of spec 0061's six kinds (R4): a socials row, a video or song, a picture, a gallery, a
// booking page's next times and a banner, each one Modal for an add and an edit, as every other kind's.
// Main task: fill a block's few fields and see it as a visitor will, then Add or Save; it shows on the list at once.
// Leaves out: saving itself (the screen does, through the data layer, optimistic), and drawing the blocks, which is
// the library's LinkPage.
import type { BlockDraft, BlockProblems, ProfilePageChoice } from '@crm/data';
import { Button, ButtonLink, Callout, ChoiceChips, EmptyState, Field, FileDrop, Form, Select, Skeleton } from '@crm/ui';
import { useEffect, useId, useState, type ReactNode } from 'react';
import { linksHref } from '../booking/links.ts';
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
import type { BlockEditorProps } from './registry.tsx';
import { strings } from './strings.ts';

/** The words under a refused field, or nothing. */
const errorOf = (problems: BlockProblems, key: keyof BlockProblems) =>
  problems[key] === undefined ? {} : { error: problems[key] };

/**
 * A socials row (AC-6104): nothing of its own to type, since the icons are the person's social links. The Modal says
 * where those are changed, and draws the row as it will show; with none yet it says so.
 */
export function SocialsEditor({ item, items, linkPage, socialLinks, chrome, onSubmit, onClose }: BlockEditorProps) {
  const formId = useId();
  const editing = item?.kind === 'socials' ? item : undefined;
  const extras = useBlockExtras(editing, false);
  const submit = () => {
    const draft: BlockDraft = { kind: 'socials', ...extras.draft };
    const checked = linkPage.check(draft, items, editing?.id);
    if (!checked.ok) {
      extras.take(checked.problems);
      return;
    }
    onSubmit(draft);
  };
  return (
    <EditorModal
      title={editing === undefined ? words.newSocials : words.editSocials}
      formId={formId}
      submitLabel={editing === undefined ? strings.add : strings.save}
      onClose={onClose}
      {...(chrome === undefined ? {} : { chrome })}
      preview={
        socialLinks.length === 0 ? undefined : (
          <DraftPage
            layout="blocks"
            caption={strings.howItLooks}
            blocks={[{ kind: 'socials', id: editing?.id ?? 'draft', links: socialLinks }]}
          />
        )
      }
    >
      <Form id={formId} onSubmit={submit} label={words.newSocials}>
        {socialLinks.length === 0 ? (
          <Callout tone="info">{words.socialsNone}</Callout>
        ) : (
          <p>{`${words.socialsCount(socialLinks.length)}. ${words.socialsHint}`}</p>
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
  const draft: BlockDraft = {
    kind: 'image',
    ...(picture === undefined ? {} : { image: picture.image }),
    alt,
    caption,
    url,
    ...extras.draft,
  };
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
      title={editing === undefined ? words.newImage : words.editImage}
      formId={formId}
      submitLabel={editing === undefined ? strings.add : strings.save}
      onClose={onClose}
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
  const { upload, isSending } = usePictureUpload(linkPage, slug);
  const draft: BlockDraft = {
    kind: 'gallery',
    images: pictures.map((each) => ({ image: each.image, alt: each.alt })),
    display,
    ...extras.draft,
  };
  const submit = () => {
    const checked = linkPage.check(draft, items, editing?.id);
    if (!checked.ok) {
      setProblems(checked.problems);
      extras.take(checked.problems);
      return;
    }
    onSubmit(draft);
  };
  const room = rules.galleryMax - pictures.length;
  const change = (next: readonly (HeldPicture & { readonly alt: string })[]) => {
    setPictures(next);
    // A picture's reason is by its place, so a move or a removal clears them all rather than leave one on another.
    setProblems({});
  };
  return (
    <EditorModal
      title={editing === undefined ? words.newGallery : words.editGallery}
      formId={formId}
      submitLabel={editing === undefined ? strings.add : strings.save}
      onClose={onClose}
      {...(chrome === undefined ? {} : { chrome })}
      preview={
        pictures.length === 0 ? undefined : (
          <DraftPage
            layout="blocks"
            caption={strings.howItLooks}
            blocks={[
              {
                kind: 'gallery',
                id: editing?.id ?? 'draft',
                images: pictures.map((each, at) => ({
                  src: each.src,
                  width: each.width,
                  height: each.height,
                  alt: each.alt.trim() === '' ? words.galleryAlt(at + 1) : each.alt.trim(),
                })),
                display,
              },
            ]}
          />
        )
      }
    >
      <Form id={formId} onSubmit={submit} label={editing === undefined ? words.newGallery : words.editGallery}>
        {isSending ? (
          <Skeleton shape="field" width="full" />
        ) : room > 0 ? (
          <FileDrop
            label={words.galleryAdd}
            acceptedTypes={PICTURE_TYPES}
            maxSize={PICTURE_PICK_MAX_BYTES}
            allowsMultiple
            onFiles={(files) => {
              void upload(files.slice(0, room)).then((stored) => {
                setPictures((held) => [...held, ...stored.map((each) => ({ ...each, alt: '' }))]);
                setProblems((held) => ({ ...held, images: undefined }));
              });
            }}
          />
        ) : (
          <p>{words.galleryFull}</p>
        )}
        {problems.images !== undefined && <Callout tone="danger">{problems.images}</Callout>}
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
                    onPress={() =>
                      change([...pictures.slice(0, at - 1), each, pictures[at - 1] ?? each, ...pictures.slice(at + 1)])
                    }
                  />
                )}
                <Button
                  variant="ghost"
                  icon="trash"
                  label={words.galleryRemove(at + 1)}
                  onPress={() => change(pictures.filter((one) => one.image !== each.image))}
                />
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
  const focusFirst = useFocusesFirstField();
  const formId = useId();
  const editing = item?.kind === 'times' ? item : undefined;
  const [choices, setChoices] = useState<TimesChoices>(
    editing === undefined ? { status: 'loading' } : { status: 'ready', choices: [] },
  );
  const [picked, setPicked] = useState<string | null>(editing?.pageId ?? null);
  const [problems, setProblems] = useState<BlockProblems>({});
  const [attempt, setAttempt] = useState(0);
  const extras = useBlockExtras(editing, false);
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
        icon="calendar-clock"
        title={strings.noPagesYet}
        actions={<ButtonLink href={linksHref(slug)}>{strings.noPagesAction}</ButtonLink>}
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
