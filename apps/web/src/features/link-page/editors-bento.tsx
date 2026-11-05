// Brief
// Purpose: the editors of spec 0068's bento cards (AC-6808): a profile card, a status, an audio intro, an experience
// timeline, client logos, work, how I work, a location and events, each one Modal for an add and an edit.
// Main task: fill a card's few fields, see it as a visitor will, then Add or Save; it shows on the list at once.
// Leaves out: saving itself (the screen does, through the data layer, optimistic) and drawing the cards, which is
// the library's LinkPage.
import type { BentoDraft, BlockProblems, ProfileItem } from '@crm/data';
import {
  AttributeEditor,
  Button,
  Callout,
  Field,
  FileDrop,
  Form,
  QuestionList,
  SegmentedControl,
  type LinkPageBlock,
} from '@crm/ui';
import { useRouteContext } from '@tanstack/react-router';
import { useId, useRef, useState, type ReactNode } from 'react';
import { waveOf } from './audio-wave.ts';
import { bentoStrings as words } from './bento-strings.ts';
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
import type { BlockEditorProps } from './registry.tsx';
import { strings } from './strings.ts';

/** The recordings an audio intro may be picked from: what the server takes (it reads the bytes again). */
const AUDIO_TYPES: readonly string[] = ['audio/mpeg', 'audio/mp4', 'audio/x-m4a', 'audio/ogg', 'audio/webm'];
/** The largest recording stored: `PROFILE_AUDIO_MAX_BYTES` in the contracts. */
const AUDIO_MAX_BYTES = 1_572_864;

/** A field's refusal as the store's check words it, or nothing. */
const errorOf = (problems: BlockProblems, key: string) => {
  const problem = (problems as Readonly<Record<string, string | undefined>>)[key];
  return problem === undefined ? {} : { error: problem };
};

/** The checks and submit every card editor shares: the store's check, then the screen's save. */
function useSubmit(
  props: BlockEditorProps,
  editing: ProfileItem | undefined,
  extras: { readonly take: (found: BlockProblems) => void },
) {
  const [problems, setProblems] = useState<BlockProblems>({});
  const submit = (draft: BentoDraft) => {
    const checked = props.linkPage.check(draft, props.items, editing?.id);
    if (!checked.ok) {
      setProblems(checked.problems);
      extras.take(checked.problems);
      return false;
    }
    props.onSubmit(draft);
    return true;
  };
  const clear = (key: string) => {
    setProblems((held) => ({ ...held, [key]: undefined }));
  };
  return { problems, setProblems, submit, clear };
}

/** The Modal and Form every card editor wears, with its "How it looks" preview. */
function CardModal({
  props,
  isNew,
  titles,
  preview,
  onSubmit,
  isWaiting = false,
  children,
}: {
  readonly props: BlockEditorProps;
  readonly isNew: boolean;
  readonly titles: readonly [string, string];
  readonly preview: LinkPageBlock;
  readonly onSubmit: () => void;
  readonly isWaiting?: boolean;
  readonly children: ReactNode;
}) {
  const focusFirst = useFocusesFirstField();
  const formId = useId();
  const title = isNew ? titles[0] : titles[1];
  return (
    <EditorModal
      title={title}
      formId={formId}
      submitLabel={isNew ? strings.add : strings.save}
      onClose={props.onClose}
      isWaiting={isWaiting}
      {...(props.chrome === undefined ? {} : { chrome: props.chrome })}
      preview={
        <DraftPage
          layout="blocks"
          caption={strings.howItLooks}
          person={{ name: props.ownerName, id: props.handle }}
          blocks={[preview]}
        />
      }
    >
      <Form id={formId} onSubmit={onSubmit} label={title} focusesFirstField={focusFirst}>
        {children}
      </Form>
    </EditorModal>
  );
}

/** A card's own small title, the same field on every card made of rows. */
function CardTitleField({
  value,
  onChange,
  placeholder,
  problems,
}: {
  readonly value: string;
  readonly onChange: (next: string) => void;
  readonly placeholder: string;
  readonly problems: BlockProblems;
}) {
  return (
    <Field
      label={words.cardTitle}
      name="title"
      autoComplete="off"
      maxLength={40}
      placeholder={placeholder}
      hint={words.cardTitleHint}
      value={value}
      onChange={onChange}
      {...errorOf(problems, 'title')}
    />
  );
}

/** The profile card: one line, the bio when it is left empty. */
export function ProfileCardEditor(props: BlockEditorProps) {
  const editing = props.item?.kind === 'profile' ? props.item : undefined;
  const [line, setLine] = useState(editing?.line ?? '');
  const extras = useBlockExtras(editing, true);
  const { problems, submit, clear } = useSubmit(props, editing, extras);
  const draft: BentoDraft = { kind: 'profile', line, ...extras.draft };
  return (
    <CardModal
      props={props}
      isNew={editing === undefined}
      titles={[words.newProfile, words.editProfile]}
      preview={{ kind: 'profile', id: editing?.id ?? 'draft', ...(line.trim() === '' ? {} : { line: line.trim() }) }}
      onSubmit={() => submit(draft)}
    >
      <Field
        label={words.profileLine}
        name="line"
        autoComplete="off"
        maxLength={80}
        showCounter
        hint={words.profileLineHint}
        value={line}
        onChange={(next) => {
          setLine(next);
          clear('line');
        }}
        {...errorOf(problems, 'line')}
      />
      {extras.fields}
    </CardModal>
  );
}

/** A status: its words, and whether the dot is open (green) or away. */
export function StatusEditor(props: BlockEditorProps) {
  const editing = props.item?.kind === 'status' ? props.item : undefined;
  const [text, setText] = useState(editing?.text ?? words.statusPlaceholder);
  const [state, setState] = useState<'open' | 'away'>(editing?.state ?? 'open');
  const extras = useBlockExtras(editing, true);
  const { problems, submit, clear } = useSubmit(props, editing, extras);
  const draft: BentoDraft = { kind: 'status', text, state, ...extras.draft };
  return (
    <CardModal
      props={props}
      isNew={editing === undefined}
      titles={[words.newStatus, words.editStatus]}
      preview={{
        kind: 'status',
        id: editing?.id ?? 'draft',
        text: text.trim() === '' ? words.statusPlaceholder : text.trim(),
        state,
      }}
      onSubmit={() => submit(draft)}
    >
      <Field
        label={words.statusText}
        name="text"
        autoComplete="off"
        isRequired
        maxLength={40}
        showCounter
        placeholder={words.statusPlaceholder}
        value={text}
        onChange={(next) => {
          setText(next);
          clear('text');
        }}
        {...errorOf(problems, 'text')}
      />
      <SegmentedControl
        label={words.statusState}
        isLabelVisible
        size="compact"
        value={state}
        onChange={(next) => {
          setState(next === 'away' ? 'away' : 'open');
        }}
        segments={[
          { value: 'open', label: words.statusOpen },
          { value: 'away', label: words.statusAway },
        ]}
      />
      {extras.fields}
    </CardModal>
  );
}

/**
 * An audio intro: one recording picked, its waveform drawn here from the file, uploaded privately, then a title. The
 * submit waits while it uploads; a recording too long is refused before anything is sent.
 */
export function AudioEditor(props: BlockEditorProps) {
  const { toasts } = useRouteContext({ from: '__root__' });
  const editing = props.item?.kind === 'audio' ? props.item : undefined;
  const [audio, setAudio] = useState(editing?.audio);
  const [wave, setWave] = useState(editing?.wave);
  const [title, setTitle] = useState(editing?.title ?? '');
  const [isSending, setSending] = useState(false);
  const extras = useBlockExtras(editing, true);
  const { problems, submit, clear, setProblems } = useSubmit(props, editing, extras);
  const draft: BentoDraft = {
    kind: 'audio',
    title,
    ...(audio === undefined ? {} : { audio }),
    ...(wave === undefined ? {} : { wave }),
    ...extras.draft,
  };
  const take = async (file: File) => {
    if (file.size > AUDIO_MAX_BYTES) {
      setProblems((held) => ({ ...held, audio: words.audioTooBig }));
      return;
    }
    setSending(true);
    clear('audio');
    try {
      const [drawn, stored] = await Promise.all([waveOf(file), props.linkPage.reach.uploadAudio(props.slug, file)]);
      setAudio(stored);
      setWave(drawn);
      toasts.toast({ tone: 'success', message: words.audioReady });
    } catch (error) {
      setProblems((held) => ({
        ...held,
        audio: error instanceof Error && error.message !== '' ? error.message : words.audioFailed,
      }));
    } finally {
      setSending(false);
    }
  };
  return (
    <CardModal
      props={props}
      isNew={editing === undefined}
      titles={[words.newAudio, words.editAudio]}
      isWaiting={isSending}
      preview={{
        kind: 'audio',
        id: editing?.id ?? 'draft',
        src: audio === undefined ? '' : props.linkPage.reach.audioSrc(props.slug, audio),
        ...(title.trim() === '' ? {} : { title: title.trim() }),
        ...(wave === undefined ? {} : { wave }),
      }}
      onSubmit={() => submit(draft)}
    >
      <FileDrop
        label={audio === undefined ? words.audioFile : words.audioReplace}
        acceptedTypes={AUDIO_TYPES}
        typesText={words.audioTypes}
        isPending={isSending}
        {...errorOf(problems, 'audio')}
        onFiles={(files) => {
          const [file] = files;
          if (file !== undefined) void take(file);
        }}
      />
      <Field
        label={words.audioTitle}
        name="title"
        autoComplete="off"
        maxLength={60}
        placeholder={words.audioTitlePlaceholder}
        value={title}
        onChange={(next) => {
          setTitle(next);
          clear('title');
        }}
        {...errorOf(problems, 'title')}
      />
      {extras.fields}
    </CardModal>
  );
}

/** A location: its name and the address Directions go to. */
export function LocationEditor(props: BlockEditorProps) {
  const editing = props.item?.kind === 'location' ? props.item : undefined;
  const [title, setTitle] = useState(editing?.title ?? '');
  const [address, setAddress] = useState(editing?.address ?? '');
  const extras = useBlockExtras(editing, true);
  const { problems, submit, clear } = useSubmit(props, editing, extras);
  const draft: BentoDraft = { kind: 'location', title, address, ...extras.draft };
  const shown = address.trim() === '' ? words.locationAddressPlaceholder : address.trim();
  return (
    <CardModal
      props={props}
      isNew={editing === undefined}
      titles={[words.newLocation, words.editLocation]}
      preview={{
        kind: 'location',
        id: editing?.id ?? 'draft',
        address: shown,
        directions: `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(shown)}`,
        ...(title.trim() === '' ? {} : { title: title.trim() }),
      }}
      onSubmit={() => submit(draft)}
    >
      <Field
        label={words.locationTitle}
        name="title"
        autoComplete="off"
        maxLength={60}
        placeholder={words.locationTitlePlaceholder}
        value={title}
        onChange={(next) => {
          setTitle(next);
          clear('title');
        }}
        {...errorOf(problems, 'title')}
      />
      <Field
        label={words.locationAddress}
        name="address"
        autoComplete="street-address"
        isRequired
        maxLength={200}
        placeholder={words.locationAddressPlaceholder}
        hint={words.locationHint}
        value={address}
        onChange={(next) => {
          setAddress(next);
          clear('address');
        }}
        {...errorOf(problems, 'address')}
      />
      {extras.fields}
    </CardModal>
  );
}

/** Client logos: several pictures at once through the cropper, each named by its client, in the owner's order. */
export function LogosEditor(props: BlockEditorProps) {
  const editing = props.item?.kind === 'logos' ? props.item : undefined;
  const [title, setTitle] = useState(editing?.title ?? '');
  const [logos, setLogos] = useState<readonly (HeldPicture & { readonly alt: string })[]>(() =>
    (editing?.images ?? []).map((logo) => ({
      ...heldPicture(props.linkPage, props.slug, logo.image),
      alt: logo.alt,
    })),
  );
  const { upload, isSending, cropper } = usePictureUpload(props.linkPage, props.slug);
  const extras = useBlockExtras(editing, true);
  const { problems, submit, clear } = useSubmit(props, editing, extras);
  const draft: BentoDraft = {
    kind: 'logos',
    title,
    images: logos.map((logo) => ({ image: logo.image, alt: logo.alt })),
    ...extras.draft,
  };
  return (
    <CardModal
      props={props}
      isNew={editing === undefined}
      titles={[words.newLogos, words.editLogos]}
      isWaiting={isSending}
      preview={{
        kind: 'logos',
        id: editing?.id ?? 'draft',
        images: logos.map((logo, at) => ({
          src: logo.src,
          width: logo.width,
          height: logo.height,
          alt: logo.alt.trim() === '' ? words.logoName(at + 1) : logo.alt,
        })),
        ...(title.trim() === '' ? {} : { title: title.trim() }),
      }}
      onSubmit={() => submit(draft)}
    >
      <CardTitleField
        value={title}
        onChange={(next) => {
          setTitle(next);
          clear('title');
        }}
        placeholder={words.addLogos}
        problems={problems}
      />
      <FileDrop
        label={words.logosAdd}
        acceptedTypes={PICTURE_TYPES}
        typesText={words.logosTypes}
        maxSize={PICTURE_PICK_MAX_BYTES}
        allowsMultiple
        isPending={isSending}
        {...errorOf(problems, 'images')}
        onFiles={(files) => {
          void upload(files, 'free').then((stored) => {
            setLogos((held) => [...held, ...stored.map((picture) => ({ ...picture, alt: '' }))].slice(0, 12));
            clear('images');
          });
        }}
      />
      {cropper}
      {logos.map((logo, at) => (
        <span key={logo.image}>
          <Field
            label={words.logoName(at + 1)}
            name={`logo-${logo.image}`}
            autoComplete="off"
            isRequired
            maxLength={80}
            value={logo.alt}
            onChange={(next) => {
              setLogos((held) => held.map((each) => (each.image === logo.image ? { ...each, alt: next } : each)));
              clear(`images.${String(at)}.alt`);
            }}
            {...errorOf(problems, `images.${String(at)}.alt`)}
          />
          <Button
            variant="ghost-danger"
            size="sm"
            icon="trash"
            onPress={() => {
              setLogos((held) => held.filter((each) => each.image !== logo.image));
            }}
          >
            {words.logoRemove(logo.alt.trim() === '' ? words.logoName(at + 1) : logo.alt)}
          </Button>
        </span>
      ))}
      {extras.fields}
    </CardModal>
  );
}

/** A row being typed, with the id its fold is known by in the editor. */
type Typed<Row> = Row & { readonly id: string };

/**
 * The rows of a card made of rows (a timeline, work, steps, events) on the library's QuestionList: each row a fold
 * with its fields, moved by drag or keyboard, added up to the card's most and removed from its own fold. A row that
 * was refused opens, so its reason is in view.
 */
function useRows<Row extends object>(initial: readonly Row[], blank: () => Row) {
  const minted = useRef(initial.length);
  const [rows, setRows] = useState<readonly Typed<Row>[]>(() =>
    (initial.length === 0 ? [blank()] : initial).map((row, at) => ({ ...row, id: `r${String(at)}` })),
  );
  const [openIds, setOpenIds] = useState<ReadonlySet<string>>(() => new Set(initial.length === 0 ? ['r0'] : []));
  const add = () => {
    const id = `r${String(minted.current)}`;
    minted.current += 1;
    setRows((held) => [...held, { ...blank(), id }]);
    setOpenIds(new Set([id]));
  };
  const set = (id: string, part: Partial<Row>) => {
    setRows((held) => held.map((row) => (row.id === id ? { ...row, ...part } : row)));
  };
  return { rows, setRows, openIds, setOpenIds, add, set };
}

/** The list of rows, its Add and each row's Remove, around the fields a kind gives each open row. */
function RowList<Row extends object>({
  label,
  rows,
  most,
  addLabel,
  removeLabel,
  titleOf,
  noteOf,
  problems,
  onChange,
  render,
}: {
  readonly label: string;
  readonly rows: ReturnType<typeof useRows<Row>>;
  readonly most: number;
  readonly addLabel: string;
  readonly removeLabel: string;
  readonly titleOf: (row: Row) => string;
  readonly noteOf: (row: Row) => string;
  readonly problems: BlockProblems;
  readonly onChange: () => void;
  readonly render: (row: Typed<Row>, at: number) => ReactNode;
}) {
  const hasProblem = (at: number) => Object.keys(problems).some((key) => key.startsWith(`items.${String(at)}.`));
  return (
    <>
      <QuestionList
        label={label}
        items={rows.rows.map((row, at) => ({
          id: row.id,
          label: titleOf(row).trim(),
          note: noteOf(row).trim(),
          hasProblem: hasProblem(at),
        }))}
        openIds={new Set([...rows.openIds, ...rows.rows.filter((_row, at) => hasProblem(at)).map((row) => row.id)])}
        onOpenChange={(id, isOpen) => {
          rows.setOpenIds((held) => {
            const next = new Set(held);
            if (isOpen) next.add(id);
            else next.delete(id);
            return next;
          });
        }}
        onMove={(id, index) => {
          rows.setRows((held) => {
            const moving = held.find((row) => row.id === id);
            if (moving === undefined) return held;
            const rest = held.filter((row) => row.id !== id);
            return [...rest.slice(0, index), moving, ...rest.slice(index)];
          });
          onChange();
        }}
        actions={
          <Button icon="plus" isDisabled={rows.rows.length >= most} onPress={rows.add}>
            {addLabel}
          </Button>
        }
        renderFooter={(id) => (
          <Button
            icon="trash"
            variant="ghost-danger"
            onPress={() => {
              rows.setRows((held) => held.filter((row) => row.id !== id));
              onChange();
            }}
          >
            {removeLabel}
          </Button>
        )}
        renderOpen={(id) => {
          const at = rows.rows.findIndex((row) => row.id === id);
          const row = rows.rows[at];
          return row === undefined ? null : render(row, at);
        }}
      />
      {problems.items !== undefined && <Callout tone="danger">{problems.items}</Callout>}
    </>
  );
}

/** Without the editor's own id: what is sent. */
function plain<Row extends object>(rows: readonly Typed<Row>[]): Row[] {
  return rows.map(({ id: _id, ...row }) => row as unknown as Row);
}

/** One row field's refusal by its place: `items.2.title`. */
const rowError = (problems: BlockProblems, at: number, field: string) =>
  errorOf(problems, `items.${String(at)}.${field}`);

/** An experience timeline: when, what and where, row by row. */
export function TimelineEditor(props: BlockEditorProps) {
  const editing = props.item?.kind === 'timeline' ? props.item : undefined;
  const [title, setTitle] = useState(editing?.title ?? '');
  const rows = useRows(
    (editing?.items ?? []).map((row) => ({ when: row.when, title: row.title, place: row.place ?? '' })),
    () => ({ when: '', title: '', place: '' }),
  );
  const extras = useBlockExtras(editing, true);
  const { problems, setProblems, submit, clear } = useSubmit(props, editing, extras);
  const draft: BentoDraft = { kind: 'timeline', title, items: plain(rows.rows), ...extras.draft };
  return (
    <CardModal
      props={props}
      isNew={editing === undefined}
      titles={[words.newTimeline, words.editTimeline]}
      preview={{
        kind: 'timeline',
        id: editing?.id ?? 'draft',
        items: rows.rows.map((row) => ({
          when: row.when.trim() === '' ? words.timelineWhenPlaceholder : row.when.trim(),
          title: row.title.trim() === '' ? words.timelineWhatPlaceholder : row.title.trim(),
          ...(row.place.trim() === '' ? {} : { place: row.place.trim() }),
        })),
        ...(title.trim() === '' ? {} : { title: title.trim() }),
      }}
      onSubmit={() => submit(draft)}
    >
      <CardTitleField
        value={title}
        onChange={(next) => {
          setTitle(next);
          clear('title');
        }}
        placeholder={words.addTimeline}
        problems={problems}
      />
      <RowList
        label={words.timelineRows}
        rows={rows}
        most={12}
        addLabel={words.timelineAdd}
        removeLabel={words.timelineRemove}
        titleOf={(row) => row.title}
        noteOf={(row) => row.when}
        problems={problems}
        onChange={() => {
          setProblems({});
        }}
        render={(row, at) => (
          <>
            <Field
              label={words.timelineWhen}
              name={`when-${row.id}`}
              autoComplete="off"
              isRequired
              maxLength={20}
              placeholder={words.timelineWhenPlaceholder}
              value={row.when}
              onChange={(next) => {
                rows.set(row.id, { when: next });
                clear(`items.${String(at)}.when`);
              }}
              {...rowError(problems, at, 'when')}
            />
            <Field
              label={words.timelineWhat}
              name={`what-${row.id}`}
              autoComplete="off"
              isRequired
              maxLength={60}
              placeholder={words.timelineWhatPlaceholder}
              value={row.title}
              onChange={(next) => {
                rows.set(row.id, { title: next });
                clear(`items.${String(at)}.title`);
              }}
              {...rowError(problems, at, 'title')}
            />
            <Field
              label={words.timelinePlace}
              name={`place-${row.id}`}
              autoComplete="organization"
              maxLength={60}
              placeholder={words.timelinePlacePlaceholder}
              value={row.place}
              onChange={(next) => {
                rows.set(row.id, { place: next });
                clear(`items.${String(at)}.place`);
              }}
              {...rowError(problems, at, 'place')}
            />
          </>
        )}
      />
      {extras.fields}
    </CardModal>
  );
}

/** How I work: two to six steps, each a name and a few words. */
export function StepsEditor(props: BlockEditorProps) {
  const editing = props.item?.kind === 'steps' ? props.item : undefined;
  const [title, setTitle] = useState(editing?.title ?? '');
  const rows = useRows(editing?.items ?? [], () => ({ title: '', body: '' }));
  const extras = useBlockExtras(editing, true);
  const { problems, setProblems, submit, clear } = useSubmit(props, editing, extras);
  const draft: BentoDraft = { kind: 'steps', title, items: plain(rows.rows), ...extras.draft };
  return (
    <CardModal
      props={props}
      isNew={editing === undefined}
      titles={[words.newSteps, words.editSteps]}
      preview={{
        kind: 'steps',
        id: editing?.id ?? 'draft',
        items: rows.rows.map((row) => ({
          title: row.title.trim() === '' ? words.stepTitlePlaceholder : row.title.trim(),
          body: row.body.trim() === '' ? words.stepBody : row.body.trim(),
        })),
        ...(title.trim() === '' ? {} : { title: title.trim() }),
      }}
      onSubmit={() => submit(draft)}
    >
      <CardTitleField
        value={title}
        onChange={(next) => {
          setTitle(next);
          clear('title');
        }}
        placeholder={words.addSteps}
        problems={problems}
      />
      <RowList
        label={words.stepsList}
        rows={rows}
        most={6}
        addLabel={words.stepsAdd}
        removeLabel={words.stepsRemove}
        titleOf={(row) => row.title}
        noteOf={(row) => row.body}
        problems={problems}
        onChange={() => {
          setProblems({});
        }}
        render={(row, at) => (
          <>
            <Field
              label={words.stepTitle}
              name={`step-${row.id}`}
              autoComplete="off"
              isRequired
              maxLength={60}
              placeholder={words.stepTitlePlaceholder}
              value={row.title}
              onChange={(next) => {
                rows.set(row.id, { title: next });
                clear(`items.${String(at)}.title`);
              }}
              {...rowError(problems, at, 'title')}
            />
            <Field
              label={words.stepBody}
              name={`body-${row.id}`}
              isMultiline
              isRequired
              maxLength={240}
              showCounter
              value={row.body}
              onChange={(next) => {
                rows.set(row.id, { body: next.replace(/\s*\n\s*/g, ' ') });
                clear(`items.${String(at)}.body`);
              }}
              {...rowError(problems, at, 'body')}
            />
          </>
        )}
      />
      {extras.fields}
    </CardModal>
  );
}

/** Work: one to six pieces, each a picture through the cropper, a title, two lines and an optional link. */
export function WorkEditor(props: BlockEditorProps) {
  const editing = props.item?.kind === 'work' ? props.item : undefined;
  const [title, setTitle] = useState(editing?.title ?? '');
  const rows = useRows<{ picture?: HeldPicture; title: string; body: string; url: string }>(
    (editing?.items ?? []).map((piece) => ({
      ...(piece.image === undefined ? {} : { picture: heldPicture(props.linkPage, props.slug, piece.image) }),
      title: piece.title,
      body: piece.body ?? '',
      url: piece.url ?? '',
    })),
    () => ({ title: '', body: '', url: '' }),
  );
  const [sending, setSending] = useState(0);
  const extras = useBlockExtras(editing, true);
  const { problems, setProblems, submit, clear } = useSubmit(props, editing, extras);
  const draft: BentoDraft = {
    kind: 'work',
    title,
    items: rows.rows.map((row) => ({
      title: row.title,
      body: row.body,
      url: row.url,
      ...(row.picture === undefined ? {} : { image: row.picture.image }),
    })),
    ...extras.draft,
  };
  return (
    <CardModal
      props={props}
      isNew={editing === undefined}
      titles={[words.newWork, words.editWork]}
      isWaiting={sending > 0}
      preview={{
        kind: 'work',
        id: editing?.id ?? 'draft',
        items: rows.rows.map((row) => ({
          title: row.title.trim() === '' ? words.workTitlePlaceholder : row.title.trim(),
          ...(row.body.trim() === '' ? {} : { body: row.body.trim() }),
          ...(row.picture === undefined
            ? {}
            : { image: { src: row.picture.src, width: row.picture.width, height: row.picture.height } }),
        })),
        ...(title.trim() === '' ? {} : { title: title.trim() }),
      }}
      onSubmit={() => submit(draft)}
    >
      <CardTitleField
        value={title}
        onChange={(next) => {
          setTitle(next);
          clear('title');
        }}
        placeholder={words.addWork}
        problems={problems}
      />
      <RowList
        label={words.workPieces}
        rows={rows}
        most={6}
        addLabel={words.workAdd}
        removeLabel={words.workRemove}
        titleOf={(row) => row.title}
        noteOf={(row) => row.body}
        problems={problems}
        onChange={() => {
          setProblems({});
        }}
        render={(row, at) => (
          <>
            <PictureField
              label={words.workPicture}
              linkPage={props.linkPage}
              slug={props.slug}
              shape="dish"
              isRemovable
              {...(row.picture === undefined ? {} : { value: row.picture })}
              onChange={(picture) => {
                rows.set(row.id, picture === undefined ? { picture: undefined } : { picture });
              }}
              onSendingChange={(isSending) => {
                setSending((held) => Math.max(0, held + (isSending ? 1 : -1)));
              }}
            />
            <Field
              label={words.workTitle}
              name={`work-${row.id}`}
              autoComplete="off"
              isRequired
              maxLength={60}
              placeholder={words.workTitlePlaceholder}
              value={row.title}
              onChange={(next) => {
                rows.set(row.id, { title: next });
                clear(`items.${String(at)}.title`);
              }}
              {...rowError(problems, at, 'title')}
            />
            <Field
              label={words.workBody}
              name={`work-body-${row.id}`}
              autoComplete="off"
              maxLength={160}
              showCounter
              value={row.body}
              onChange={(next) => {
                rows.set(row.id, { body: next });
                clear(`items.${String(at)}.body`);
              }}
              {...rowError(problems, at, 'body')}
            />
            <Field
              label={words.workUrl}
              name={`work-url-${row.id}`}
              type="url"
              inputMode="url"
              autoComplete="off"
              isVerbatim
              maxLength={2_000}
              hint={words.workUrlHint}
              value={row.url}
              onChange={(next) => {
                rows.set(row.id, { url: next });
                clear(`items.${String(at)}.url`);
              }}
              {...rowError(problems, at, 'url')}
            />
          </>
        )}
      />
      {extras.fields}
    </CardModal>
  );
}

/** Events: one to eight, each a name, when it starts, where and an optional link. */
export function EventsEditor(props: BlockEditorProps) {
  const editing = props.item?.kind === 'events' ? props.item : undefined;
  const [title, setTitle] = useState(editing?.title ?? '');
  const rows = useRows(
    (editing?.items ?? []).map((event) => ({
      title: event.title,
      at: event.at,
      place: event.place ?? '',
      url: event.url ?? '',
    })),
    () => ({ title: '', at: '', place: '', url: '' }),
  );
  const extras = useBlockExtras(editing, true);
  const { problems, setProblems, submit, clear } = useSubmit(props, editing, extras);
  const draft: BentoDraft = { kind: 'events', title, items: plain(rows.rows), ...extras.draft };
  return (
    <CardModal
      props={props}
      isNew={editing === undefined}
      titles={[words.newEvents, words.editEvents]}
      preview={{
        kind: 'events',
        id: editing?.id ?? 'draft',
        items: rows.rows
          .filter((row) => !Number.isNaN(Date.parse(row.at)))
          .map((row) => ({
            title: row.title.trim() === '' ? words.eventTitlePlaceholder : row.title.trim(),
            at: new Date(row.at).toISOString(),
            ...(row.place.trim() === '' ? {} : { place: row.place.trim() }),
          })),
        ...(title.trim() === '' ? {} : { title: title.trim() }),
      }}
      onSubmit={() => submit(draft)}
    >
      <CardTitleField
        value={title}
        onChange={(next) => {
          setTitle(next);
          clear('title');
        }}
        placeholder={words.addEvents}
        problems={problems}
      />
      <RowList
        label={words.eventsList}
        rows={rows}
        most={8}
        addLabel={words.eventsAdd}
        removeLabel={words.eventsRemove}
        titleOf={(row) => row.title}
        noteOf={(row) => row.place}
        problems={problems}
        onChange={() => {
          setProblems({});
        }}
        render={(row, at) => (
          <>
            <Field
              label={words.eventTitle}
              name={`event-${row.id}`}
              autoComplete="off"
              isRequired
              maxLength={60}
              placeholder={words.eventTitlePlaceholder}
              value={row.title}
              onChange={(next) => {
                rows.set(row.id, { title: next });
                clear(`items.${String(at)}.title`);
              }}
              {...rowError(problems, at, 'title')}
            />
            <AttributeEditor
              attribute={{
                id: `at-${row.id}`,
                name: words.eventAt,
                type: 'timestamp',
                allowMultiple: false,
                isRequired: true,
                isUnique: false,
                isReadOnly: false,
              }}
              surface="form"
              value={row.at === '' ? null : row.at}
              onCommit={(next) => {
                rows.set(row.id, { at: typeof next === 'string' ? next : '' });
                clear(`items.${String(at)}.at`);
              }}
              {...rowError(problems, at, 'at')}
            />
            <Field
              label={words.eventPlace}
              name={`event-place-${row.id}`}
              autoComplete="off"
              maxLength={60}
              value={row.place}
              onChange={(next) => {
                rows.set(row.id, { place: next });
                clear(`items.${String(at)}.place`);
              }}
              {...rowError(problems, at, 'place')}
            />
            <Field
              label={words.eventUrl}
              name={`event-url-${row.id}`}
              type="url"
              inputMode="url"
              autoComplete="off"
              isVerbatim
              maxLength={2_000}
              value={row.url}
              onChange={(next) => {
                rows.set(row.id, { url: next });
                clear(`items.${String(at)}.url`);
              }}
              {...rowError(problems, at, 'url')}
            />
          </>
        )}
      />
      <Callout tone="info">{words.eventsHint}</Callout>
      {extras.fields}
    </CardModal>
  );
}
