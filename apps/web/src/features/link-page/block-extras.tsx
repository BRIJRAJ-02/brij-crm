// The pieces every block editor shares since spec 0061 (R4): a block's window (AC-6111), its tile size on a grid
// page (AC-6103), and a picture picked, made smaller in the browser and uploaded (AC-6101, AC-6108). Each is built
// from the library's own controls: the window is the field set's Date and time, so a schedule reads and types as
// every other date and time in the CRM does.
import type { DraftWindow, LinkPageStore, ProfileItem, StoredPicture } from '@crm/data';
import { AttributeEditor, Button, Disclosure, FileDrop, TileGrid, type IconName } from '@crm/ui';
import { useRouteContext } from '@tanstack/react-router';
import { useEffect, useState, type ReactNode } from 'react';
import { usePageLayout } from './draft-look.tsx';
import { PICTURE_PICK_MAX_BYTES, preparePicture } from './photo-prep.ts';
import { reachStrings as strings } from './reach-strings.ts';

/** The picture types a block may pick: what the server takes. SVG is refused (it runs scripts). */
const PICTURE_TYPES: readonly string[] = ['image/jpeg', 'image/png', 'image/webp'];

/** Props for ScheduleFields. */
export interface ScheduleFieldsProps {
  readonly value: DraftWindow;
  readonly onChange: (next: DraftWindow) => void;
  /** Each end's refusal, as the store's check words it. */
  readonly problems?: { readonly showFrom?: string | undefined; readonly hideAfter?: string | undefined };
}

/**
 * "Show from" and "Hide after" (AC-6111), folded away until wanted: most blocks always show, so the fold opens by
 * itself only on a block that already has a window, or a refusal to show. Both are the owner's own time zone (the
 * provider's), stored as the moment in UTC.
 */
export function ScheduleFields({ value, onChange, problems }: ScheduleFieldsProps) {
  const isSet = value.showFrom !== undefined || value.hideAfter !== undefined;
  const hasProblem = problems?.showFrom !== undefined || problems?.hideAfter !== undefined;
  const [isOpen, setOpen] = useState(isSet);
  const end = (key: 'showFrom' | 'hideAfter', next: unknown) => {
    const { [key]: _was, ...rest } = value;
    onChange(typeof next === 'string' ? { ...rest, [key]: next } : rest);
  };
  return (
    <Disclosure
      title={strings.schedule}
      variant="fields"
      headingLevel={4}
      isExpanded={isOpen || hasProblem}
      onExpandedChange={setOpen}
    >
      <AttributeEditor
        attribute={{
          id: 'showFrom',
          name: strings.showFrom,
          type: 'timestamp',
          allowMultiple: false,
          isRequired: false,
          isUnique: false,
          isReadOnly: false,
        }}
        surface="form"
        value={value.showFrom ?? null}
        onCommit={(next) => end('showFrom', next)}
        {...(problems?.showFrom === undefined ? {} : { error: problems.showFrom })}
      />
      <AttributeEditor
        attribute={{
          id: 'hideAfter',
          name: strings.hideAfter,
          type: 'timestamp',
          allowMultiple: false,
          isRequired: false,
          isUnique: false,
          isReadOnly: false,
        }}
        surface="form"
        value={value.hideAfter ?? null}
        onCommit={(next) => end('hideAfter', next)}
        {...(problems?.hideAfter === undefined ? {} : { error: problems.hideAfter })}
      />
    </Disclosure>
  );
}

/** A tile's three sizes, each a picture of its shape (AC-6103). */
const SIZES: readonly { readonly id: 'small' | 'wide' | 'large'; readonly icon: IconName }[] = [
  { id: 'small', icon: 'square' },
  { id: 'wide', icon: 'rectangle-horizontal' },
  { id: 'large', icon: 'layout-grid' },
];

/** Props for SizePicker. */
export interface SizePickerProps {
  readonly value: 'small' | 'wide' | 'large';
  readonly onChange: (size: 'small' | 'wide' | 'large') => void;
}

/**
 * How big a block's tile is on a grid page (AC-6103): three tiles to pick from by sight, one tab stop, the arrows
 * move and pick. A list page draws every block as a row whatever its size.
 */
export function SizePicker({ value, onChange }: SizePickerProps) {
  const words = {
    small: [strings.sizeSmall, strings.sizeSmallText],
    wide: [strings.sizeWide, strings.sizeWideText],
    large: [strings.sizeLarge, strings.sizeLargeText],
  } as const;
  return (
    <TileGrid
      variant="choice"
      label={strings.size}
      value={value}
      tiles={SIZES.map((size) => ({
        id: size.id,
        name: words[size.id][0],
        icon: size.icon,
        description: words[size.id][1],
      }))}
      onChange={(chosen) => {
        const size = SIZES.find((each) => each.id === chosen);
        if (size !== undefined) onChange(size.id);
      }}
    />
  );
}

/** A picture the editor holds: its stored id, and where the owner's browser reads it. */
export interface HeldPicture {
  readonly image: string;
  readonly src: string;
  readonly width: number;
  readonly height: number;
}

/** The size a stored picture draws at in the editor until it loads: its box only, never its shape. */
const UNKNOWN_SIZE = { width: 4, height: 3 } as const;

/** A stored picture's id as the editor draws it. Its size is known only for one uploaded in this editor. */
export function heldPicture(linkPage: LinkPageStore, slug: string, image: string, known?: StoredPicture): HeldPicture {
  return { image, src: linkPage.reach.pictureSrc(slug, image), ...(known ?? UNKNOWN_SIZE) };
}

/**
 * Picks pictures, makes each at most 1,600 pixels and 1.5 MB in the browser (which leaves a photo's location
 * behind), and uploads them one after another. Answers how it stands: what is on its way, and the last refusal.
 */
export function usePictureUpload(linkPage: LinkPageStore, slug: string) {
  const { toasts } = useRouteContext({ from: '__root__' });
  const [sending, setSending] = useState(0);
  const upload = async (files: readonly File[]): Promise<readonly HeldPicture[]> => {
    setSending((was) => was + files.length);
    const stored: HeldPicture[] = [];
    for (const file of files) {
      try {
        const prepared = await preparePicture(file).catch(() => undefined);
        if (prepared === undefined) {
          toasts.toast({ tone: 'danger', message: strings.pictureUnreadable });
          continue;
        }
        const saved = await linkPage.reach.uploadPicture(slug, prepared.picture);
        stored.push(heldPicture(linkPage, slug, saved.image, saved));
      } catch (error) {
        toasts.toast({
          tone: 'danger',
          message: error instanceof Error && error.message !== '' ? error.message : strings.pictureFailed,
        });
      } finally {
        setSending((was) => was - 1);
      }
    }
    return stored;
  };
  return { upload, isSending: sending > 0 };
}

/** Props for PictureField. */
export interface PictureFieldProps {
  readonly label: string;
  readonly linkPage: LinkPageStore;
  readonly slug: string;
  readonly value?: HeldPicture;
  readonly onChange: (picture: HeldPicture | undefined) => void;
  /** Its refusal ("Add a picture."), in the drop zone's own refusal line. */
  readonly error?: string;
  /** Under the zone, its own row: a link's "Use the site's picture". */
  readonly extra?: ReactNode;
  /** Whether Remove is offered (a link's picture may go; an image block's is replaced instead). */
  readonly isRemovable?: boolean;
  /** Said as an upload starts and ends, so the editor holds its submit until the picture is there. */
  readonly onSendingChange?: (isSending: boolean) => void;
}

/**
 * One picture: the drop area showing the picture there now (so its owner sees what they replace), busy in place
 * while the next one uploads (focus stays on its browse button), with Remove where the block may have none.
 */
export function PictureField({
  label,
  linkPage,
  slug,
  value,
  onChange,
  error,
  extra,
  isRemovable = false,
  onSendingChange,
}: PictureFieldProps) {
  const { upload, isSending } = usePictureUpload(linkPage, slug);
  useEffect(() => {
    onSendingChange?.(isSending);
  }, [isSending, onSendingChange]);
  return (
    <>
      <FileDrop
        label={label}
        acceptedTypes={PICTURE_TYPES}
        maxSize={PICTURE_PICK_MAX_BYTES}
        isPending={isSending}
        {...(error === undefined ? {} : { error })}
        {...(value === undefined ? {} : { preview: { src: value.src, alt: strings.pictureAlt } })}
        onFiles={(files) => {
          const [file] = files;
          if (file === undefined) return;
          void upload([file]).then((stored) => {
            const [first] = stored;
            if (first !== undefined) onChange(first);
          });
        }}
      />
      {extra}
      {isRemovable && value !== undefined && (
        <Button variant="ghost" size="md" icon="trash" onPress={() => onChange(undefined)}>
          {strings.thumbRemove}
        </Button>
      )}
    </>
  );
}

export { PICTURE_TYPES };

/** A block's window as stored: its two ends, when set. A heading has none. */
export function windowOfItem(item: ProfileItem | undefined): DraftWindow {
  if (item === undefined || item.kind === 'heading') return {};
  return {
    ...(item.showFrom === undefined ? {} : { showFrom: item.showFrom }),
    ...(item.hideAfter === undefined ? {} : { hideAfter: item.hideAfter }),
  };
}

/** A block's tile size as stored; absent is `small`. */
export function sizeOfItem(item: ProfileItem | undefined): 'small' | 'wide' | 'large' {
  return item !== undefined && 'size' in item && item.size !== undefined ? item.size : 'small';
}

/**
 * The window and tile size an editor holds for its block (AC-6103, AC-6111), and the fields that change them: a
 * sized kind's SizePicker, then the folded Schedule. `draft` is what goes into the block's draft.
 */
export function useBlockExtras(item: ProfileItem | undefined, isSized: boolean) {
  const isGrid = usePageLayout() === 'grid';
  const [window, setWindow] = useState<DraftWindow>(() => windowOfItem(item));
  const [size, setSize] = useState(() => sizeOfItem(item));
  const [problems, setProblems] = useState<{ showFrom?: string; hideAfter?: string; size?: string }>({});
  const draft = { ...window, ...(isSized && size !== 'small' ? { size } : {}) };
  /** The window's and size's own problems, from the store's check. */
  const take = (found: Readonly<Partial<Record<string, string>>>) => {
    setProblems({
      ...(found.showFrom === undefined ? {} : { showFrom: found.showFrom }),
      ...(found.hideAfter === undefined ? {} : { hideAfter: found.hideAfter }),
    });
  };
  const fields = (
    <>
      {/* Only where it changes something a visitor sees: a list page draws every block as a row. The size a block
          already has is kept whatever the layout, so switching to a grid brings it back. */}
      {isSized && isGrid && <SizePicker value={size} onChange={setSize} />}
      <ScheduleFields
        value={window}
        onChange={(next) => {
          setWindow(next);
          setProblems({});
        }}
        problems={problems}
      />
    </>
  );
  return { draft, size, take, fields };
}
