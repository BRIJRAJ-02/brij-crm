import { useEffect, useId, useRef, useState } from 'react';
import { Button as AriaButton, DropZone, FileTrigger, Text } from 'react-aria-components';
import { Button } from '../../atoms/Button/Button.tsx';
import { Icon } from '../../atoms/Icon/Icon.tsx';
import { useFormatSettings } from '../../provider/context.ts';
import { formatFileSize } from '../FileItem/FileItem.tsx';
import { safeImageSrc } from '../../lib/safe-image-src.ts';
import styles from './FileDrop.module.css';
import { strings } from './strings.ts';

/** Props for FileDrop. */
export interface FileDropProps {
  /** What it takes ("Upload a CSV"). */
  readonly label: string;
  /** MIME types or extensions it accepts (`text/csv`, `.xlsx`). Leave it out to take any file. */
  readonly acceptedTypes?: readonly string[];
  /**
   * The accepted types as people name them ("PNG, JPG or WebP"), shown in the hint and the refusal in place of the
   * raw `acceptedTypes` (`image/png, image/jpeg`). Leave it out where the raw list already reads well (`.csv`).
   */
  readonly typesText?: string;
  /** The largest file it takes, in bytes. */
  readonly maxSize?: number;
  readonly allowsMultiple?: boolean;
  /** Called with the files that passed the checks. */
  readonly onFiles: (files: readonly File[]) => void;
  /**
   * The picture that is there already, for a single file picker that replaces one (an avatar, a logo, a page's
   * share image): drawn above the label, so somebody sees what they are about to replace. It comes from our own
   * origin like every other image here (`safeImageSrc`), and goes quietly if it won't load.
   */
  readonly preview?: { readonly src: string; readonly alt: string };
  readonly isDisabled?: boolean;
  /**
   * Shows what is there with no way to change it (a member's view of the workspace's logo): `preview` alone, drawn
   * at a control's height, and nothing that looks or announces as a control. Without a preview it draws nothing,
   * so the screen says there is none.
   */
  readonly isReadOnly?: boolean;
  /**
   * `zone` (the default) is the drop area with its browse button. `button` is the browse button alone, with
   * `label` as its words, for a picker that sits beside what it changes (first run's avatar, 27 October 2026),
   * where a drop area would draw the picture twice. Same checks, same refusal line; nothing to drop onto.
   * `row` (5 November 2026) is one row's height: a small picture of what is there (or the upload mark), the label,
   * and Upload or Change, Adjust crop and Remove at its end. Still a drop target; the accepted types and size are
   * said only in its refusal. For an optional picture in a settings card (a link page's cover, its share picture),
   * where the zone's dashed box outweighed the page.
   */
  /**
   * `photo` (6 November 2026) is one picture a screen has to show well (a menu item's): with nothing there, a whole
   * box to press, drop on or paste into, and a picture pasted anywhere in the dialog around it lands here too; with a
   * picture there, the picture at a size you can check it by (`size-column` wide, 4:3), Change, Adjust crop and Remove
   * beside it. `label` names the picture ("Photo").
   */
  readonly variant?: 'zone' | 'button' | 'row' | 'photo';
  /**
   * With `variant="row"`, the picture's tile: `wide` (the default) for a logo or a banner, `square` for a picture you
   * have to recognise, which a wide strip would cut to its middle (a menu item's photo).
   */
  readonly thumb?: 'wide' | 'square';
  /**
   * With `variant="row"`, one short line under the label saying what the picture is for ("The wide banner across the
   * top"), for a card holding several pictures that would otherwise read alike (a link page's three photos). It
   * describes the row's Upload or Change button, the control people reach it by.
   */
  readonly description?: string;
  /**
   * What was picked is on its way: with `variant="button"` the button spins and takes no second press; on the zone
   * (spec 0061, a link page's picture) the zone stays where it is, says so, and its browse button keeps focus but
   * takes no second pick, so a keyboard never loses its place while a picture uploads.
   */
  readonly isPending?: boolean;
  /**
   * The screen's own refusal about what was picked or what is missing ("Add a picture."), drawn in the zone's own
   * refusal line, so it reads as the control's error rather than a note beside it. Its own type and size checks
   * take its place while they speak.
   */
  readonly error?: string;
  /**
   * The screen's own refusal for a file of a type it doesn't take, when it has a better one than "Choose .csv"
   * (an Excel file: how to save it as CSV); undefined keeps the built in sentence.
   */
  readonly wrongTypeText?: (fileName: string) => string | undefined;
  /**
   * Crops the picture there now again (spec 0068, AC-6809): an "Adjust crop" button beside browse while `preview`
   * shows (beside the button with `variant="button"`), which opens the screen's PhotoCrop on it.
   */
  readonly onAdjust?: () => void;
  /**
   * Takes the picture there away (`variant="row"` and `"photo"`): a quiet remove button while `preview` shows. The
   * screen asks first, as every ending action does, unless the removal itself waits for a Save.
   */
  readonly onRemove?: () => void;
}

function accepts(file: File, types: readonly string[] | undefined): boolean {
  if (types === undefined || types.length === 0) return true;
  const name = file.name.toLowerCase();
  return types.some((type) => (type.startsWith('.') ? name.endsWith(type.toLowerCase()) : file.type === type));
}

/**
 * Drop files here or browse for them: an import's CSV, a record's files. It
 * says which types and sizes it takes, and refuses others with a sentence on
 * what to do. Built on React Aria's DropZone and FileTrigger, so it works by
 * keyboard and screen reader too.
 */
export function FileDrop({
  label,
  acceptedTypes,
  typesText,
  maxSize,
  allowsMultiple = false,
  onFiles,
  preview,
  isDisabled = false,
  isReadOnly = false,
  variant = 'zone',
  thumb = 'wide',
  description,
  isPending = false,
  error: given,
  wrongTypeText,
  onAdjust,
  onRemove,
}: FileDropProps) {
  const { locale } = useFormatSettings();
  const describedBy = useId();
  const [error, setError] = useState<string | undefined>(undefined);
  const [failed, setFailed] = useState<string | undefined>(undefined);
  const shown = safeImageSrc(preview?.src);
  const types = typesText ?? acceptedTypes?.join(', ');
  const take = (files: readonly File[]) => {
    const wrongType = files.find((file) => !accepts(file, acceptedTypes));
    if (wrongType !== undefined) {
      setError(wrongTypeText?.(wrongType.name) ?? strings.wrongType(wrongType.name, types ?? ''));
      return;
    }
    const tooBig = maxSize === undefined ? undefined : files.find((file) => file.size > maxSize);
    if (tooBig !== undefined && maxSize !== undefined) {
      setError(strings.tooBig(tooBig.name, formatFileSize(maxSize, locale)));
      return;
    }
    setError(undefined);
    onFiles(allowsMultiple ? files : files.slice(0, 1));
  };
  // `photo` takes a picture pasted anywhere in its own dialog: nothing to focus first. Text pasted into a field stays
  // that field's, and a dialog opened over this one (the cropper) keeps its own paste.
  const ownRef = useRef<HTMLDivElement>(null);
  const takesPaste = variant === 'photo' && !isDisabled && !isReadOnly && !isPending;
  // The listener goes on once per opening, reading the latest checks through a ref, not again after every render.
  const takeRef = useRef(take);
  useEffect(() => {
    takeRef.current = take;
  });
  useEffect(() => {
    // React Aria's drop target keeps a hidden button of its own for the keyboard (the first button in the box,
    // react-aria-components 1.21); here the box itself and the paste do that job, so Tab doesn't stop twice on one
    // photo. Again after each render, since the box remounts as a picture comes and goes.
    if (variant === 'photo') ownRef.current?.querySelector('button')?.setAttribute('tabindex', '-1');
  });
  useEffect(() => {
    const own = ownRef.current;
    if (!takesPaste || own === null) return;
    const doc = own.ownerDocument;
    const onPaste = (event: ClipboardEvent) => {
      const files = [...(event.clipboardData?.files ?? [])];
      if (files.length === 0 || (event.clipboardData?.getData('text/plain') ?? '') !== '') return;
      const dialog = '[role="dialog"], [role="alertdialog"]';
      const target = event.target instanceof Element ? event.target : null;
      if (target?.closest(dialog) !== own.closest(dialog)) return;
      event.preventDefault();
      takeRef.current(files);
    };
    doc.addEventListener('paste', onPaste);
    return () => {
      doc.removeEventListener('paste', onPaste);
    };
  }, [takesPaste]);
  const limits = [types, maxSize === undefined ? undefined : strings.upTo(formatFileSize(maxSize, locale))].filter(
    (part) => part !== undefined,
  );
  const said = error ?? given;
  const refusal =
    said === undefined ? undefined : (
      <span className={styles.error} role="alert">
        <Icon name="circle-alert" size="xs" />
        {said}
      </span>
    );
  if (isReadOnly && variant === 'photo') {
    return shown !== undefined && failed !== shown ? (
      <img
        className={styles.photoImage}
        src={shown}
        alt={preview?.alt ?? ''}
        onError={() => {
          setFailed(shown);
        }}
      />
    ) : null;
  }
  if (isReadOnly) {
    return shown !== undefined && failed !== shown ? (
      <img
        className={styles.preview}
        data-read-only=""
        src={shown}
        alt={preview?.alt ?? ''}
        onError={() => {
          setFailed(shown);
        }}
      />
    ) : null;
  }
  if (variant === 'button') {
    return (
      <div className={styles.field}>
        <FileTrigger
          allowsMultiple={allowsMultiple}
          {...(acceptedTypes === undefined ? {} : { acceptedFileTypes: [...acceptedTypes] })}
          onSelect={(list) => {
            if (list !== null) take([...list]);
          }}
        >
          <Button icon="upload" isPending={isPending} isDisabled={isDisabled}>
            {label}
          </Button>
        </FileTrigger>
        {onAdjust !== undefined && (
          <Button variant="ghost" isDisabled={isDisabled || isPending} onPress={onAdjust}>
            {strings.adjust}
          </Button>
        )}
        {refusal}
      </div>
    );
  }
  if (variant === 'photo') {
    const hasPicture = shown !== undefined && failed !== shown;
    const pick = {
      ...(acceptedTypes === undefined ? {} : { acceptedFileTypes: [...acceptedTypes] }),
      onSelect: (list: FileList | null) => {
        if (list !== null) take([...list]);
      },
    };
    return (
      <div className={styles.field} ref={ownRef}>
        <DropZone
          className={styles.photo}
          isDisabled={isDisabled || isPending}
          aria-label={label}
          aria-busy={isPending || undefined}
          onDrop={(event) => {
            void Promise.all(event.items.flatMap((item) => (item.kind === 'file' ? [item.getFile()] : []))).then(take);
          }}
        >
          {hasPicture ? (
            <>
              <img
                className={styles.photoImage}
                src={shown}
                alt={preview?.alt ?? ''}
                onError={() => {
                  setFailed(shown);
                }}
              />
              <span className={styles.photoActions}>
                <FileTrigger {...pick}>
                  <Button isPending={isPending} isDisabled={isDisabled} label={strings.changeNamed(label)}>
                    {strings.change}
                  </Button>
                </FileTrigger>
                {onAdjust !== undefined && (
                  <Button variant="ghost" isDisabled={isDisabled || isPending} onPress={onAdjust}>
                    {strings.adjust}
                  </Button>
                )}
                {onRemove !== undefined && (
                  <Button
                    variant="ghost"
                    label={strings.remove(label)}
                    isDisabled={isDisabled || isPending}
                    onPress={onRemove}
                  >
                    {strings.removeShort}
                  </Button>
                )}
              </span>
            </>
          ) : (
            <FileTrigger {...pick}>
              <AriaButton className={styles.photoAdd} isDisabled={isDisabled} isPending={isPending}>
                <span className={styles.photoMark}>
                  <Icon name="image" size="sm" tone="muted" />
                </span>
                <span className={styles.photoWords}>
                  <Text slot="label" className={styles.label}>
                    {strings.addNamed(label)}
                  </Text>
                  {isPending ? (
                    <span className={styles.limits}>{strings.sending}</span>
                  ) : (
                    <span className={`${styles.limits ?? ''} ${styles.photoHow ?? ''}`}>
                      {strings.dropPasteOrPress}
                    </span>
                  )}
                </span>
              </AriaButton>
            </FileTrigger>
          )}
        </DropZone>
        {refusal}
      </div>
    );
  }
  if (variant === 'row') {
    const hasPicture = shown !== undefined && failed !== shown;
    const name = (
      <Text slot="label" className={styles.rowLabel}>
        {label}
      </Text>
    );
    return (
      <div className={styles.field}>
        <DropZone
          className={styles.row}
          isDisabled={isDisabled || isPending}
          aria-label={label}
          aria-busy={isPending || undefined}
          onDrop={(event) => {
            void Promise.all(event.items.flatMap((item) => (item.kind === 'file' ? [item.getFile()] : []))).then(take);
          }}
        >
          <span className={styles.thumb} data-shape={thumb === 'square' ? 'square' : undefined}>
            {hasPicture ? (
              <img
                className={styles.thumbImage}
                src={shown}
                alt={preview?.alt ?? ''}
                onError={() => {
                  setFailed(shown);
                }}
              />
            ) : (
              <Icon name="upload" size="sm" tone="muted" />
            )}
          </span>
          {description === undefined ? (
            name
          ) : (
            <span className={styles.rowText}>
              {name}
              <span id={describedBy} className={styles.rowHint}>
                {description}
              </span>
            </span>
          )}
          <span className={styles.rowActions}>
            <FileTrigger
              {...(acceptedTypes === undefined ? {} : { acceptedFileTypes: [...acceptedTypes] })}
              onSelect={(list) => {
                if (list !== null) take([...list]);
              }}
            >
              <Button
                isPending={isPending}
                isDisabled={isDisabled}
                label={hasPicture ? strings.changeNamed(label) : strings.uploadNamed(label)}
                {...(description === undefined ? {} : { 'aria-describedby': describedBy })}
              >
                {hasPicture ? strings.change : strings.upload}
              </Button>
            </FileTrigger>
            {onAdjust !== undefined && hasPicture && (
              <Button variant="ghost" isDisabled={isDisabled || isPending} onPress={onAdjust}>
                {strings.adjust}
              </Button>
            )}
            {onRemove !== undefined && hasPicture && (
              <Button
                variant="ghost"
                // The base set's x: the hosted form draws FileDrop with no icon registry around it.
                icon="x"
                label={strings.remove(label)}
                isDisabled={isDisabled || isPending}
                onPress={onRemove}
              />
            )}
          </span>
        </DropZone>
        {refusal}
      </div>
    );
  }
  return (
    <div className={styles.field}>
      <DropZone
        className={styles.root}
        isDisabled={isDisabled || isPending}
        aria-label={label}
        aria-busy={isPending || undefined}
        onDrop={(event) => {
          void Promise.all(event.items.flatMap((item) => (item.kind === 'file' ? [item.getFile()] : []))).then(take);
        }}
      >
        {shown !== undefined && failed !== shown ? (
          <img
            className={styles.preview}
            src={shown}
            alt={preview?.alt ?? ''}
            onError={() => {
              setFailed(shown);
            }}
          />
        ) : (
          <Icon name="upload" size="md" tone="muted" />
        )}
        <Text slot="label" className={styles.label}>
          {label}
        </Text>
        <span className={styles.hint}>
          {allowsMultiple ? strings.dragOr : strings.dragOneOr}{' '}
          <FileTrigger
            allowsMultiple={allowsMultiple}
            {...(acceptedTypes === undefined ? {} : { acceptedFileTypes: [...acceptedTypes] })}
            onSelect={(list) => {
              if (list !== null) take([...list]);
            }}
          >
            <AriaButton className={styles.browse} isDisabled={isDisabled} isPending={isPending}>
              {isPending ? strings.sending : strings.browse}
            </AriaButton>
          </FileTrigger>
        </span>
        {onAdjust !== undefined && shown !== undefined && failed !== shown && (
          <span className={styles.hint}>
            <AriaButton className={styles.browse} isDisabled={isDisabled || isPending} onPress={onAdjust}>
              {strings.adjust}
            </AriaButton>
          </span>
        )}
        {limits.length > 0 && <span className={styles.limits}>{limits.join(' · ')}</span>}
      </DropZone>
      {refusal}
    </div>
  );
}
