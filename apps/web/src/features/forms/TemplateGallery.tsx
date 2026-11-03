// Brief
// Purpose: New form opens a gallery of ready forms (spec 0063, AC-6323), so nobody starts from an empty page they then have to understand.
// Main task: see what each template makes, press one, and land in its editor with the questions already filed into the CRM.
// Leaves out: editing the template (that is the builder), making templates of your own.
import {
  isDataError,
  type DataLayer,
  type FormTemplateSummary,
  type FormView,
  type OfferedFormTemplateId,
} from '@crm/data';
import { Button, Callout, EmptyState, FormLayoutThumbnail, Modal, TileGrid, type ChoiceTile } from '@crm/ui';
import { useEffect, useState } from 'react';
import { strings } from './strings.ts';

/** What the gallery is doing: reading its tiles, showing them, or a read that failed. */
type Phase =
  | { readonly kind: 'loading' }
  | { readonly kind: 'ready'; readonly items: readonly FormTemplateSummary[] }
  | { readonly kind: 'failed'; readonly message: string };

/** What one read answered, and which read it was: anything older than the read in hand is still loading. */
interface Read {
  readonly read: number;
  readonly phase: Exclude<Phase, { readonly kind: 'loading' }>;
}

/** One template as a tile: its preview, its name, and the one line that says what it is for (AC-6323). */
function tileOf(template: FormTemplateSummary): ChoiceTile {
  return {
    id: template.id,
    name: template.name,
    thumbnail: <FormLayoutThumbnail layout={template.preview.layout} rows={template.preview.rows} />,
    description: template.purpose,
  };
}

/** Props for the gallery. */
export interface TemplateGalleryProps {
  readonly data: DataLayer;
  readonly slug: string;
  readonly isOpen: boolean;
  readonly onClose: () => void;
  /** The draft exists: the caller opens its editor. */
  readonly onCreated: (form: FormView) => void;
}

/**
 * The gallery: a window of picture tiles, Blank form first, each one press to
 * a draft. The tiles are read through the data layer when it opens, and the id
 * is minted once per press, so a retry makes one form. While one is being
 * made, the pressed tile stays on and says so while the others turn off, so a
 * second press can't make a second form and a keyboard keeps its place. A read
 * that failed still offers a blank form, because a blank one needs nothing
 * from the catalog and New form could always make one before this existed.
 */
export function TemplateGallery({ data, slug, isOpen, onClose, onCreated }: TemplateGalleryProps) {
  const [making, setMaking] = useState<string | undefined>(undefined);
  const [failure, setFailure] = useState<string | undefined>(undefined);
  // Read once per opening: the list is the same on every workspace and changes only when we ship a new template.
  // Try again moves `readCount`, which is what makes the read in hand older than the one being waited for; the
  // phase is worked out from the two rather than set in the effect, so the effect only ever answers its own read.
  const [readCount, setReadCount] = useState(0);
  const [loaded, setLoaded] = useState<Read | undefined>(undefined);
  const phase: Phase = loaded?.read === readCount ? loaded.phase : { kind: 'loading' };
  useEffect(() => {
    if (!isOpen) return;
    let isCurrent = true;
    data.forms.templates(slug).then(
      (items) => {
        if (isCurrent) setLoaded({ read: readCount, phase: { kind: 'ready', items } });
      },
      (error: unknown) => {
        if (isCurrent) {
          setLoaded({
            read: readCount,
            phase: { kind: 'failed', message: isDataError(error) ? error.message : strings.failedText },
          });
        }
      },
    );
    return () => {
      isCurrent = false;
    };
  }, [isOpen, readCount, data, slug]);

  const isBusy = making !== undefined;
  /** The name of the template being made, for the status line; the blank one is named even when no tiles loaded. */
  const makingName =
    (phase.kind === 'ready' ? phase.items.find((each) => each.id === making)?.name : undefined) ??
    strings.galleryBlankName;

  /**
   * Makes the draft. `blank` is always allowed, even when the tiles never
   * loaded: a blank form needs nothing from the catalog, and before this
   * gallery existed New form made one with no read at all. A flaky read must
   * not leave somebody unable to make a form.
   */
  const start = (templateId: OfferedFormTemplateId) => {
    if (isBusy) return;
    if (templateId !== 'blank' && !(phase.kind === 'ready' && phase.items.some((each) => each.id === templateId))) {
      return;
    }
    const id = data.forms.newId();
    setMaking(templateId);
    setFailure(undefined);
    data.forms.createFromTemplate(slug, { id, templateId }).then(
      (form) => {
        setMaking(undefined);
        onCreated(form);
      },
      (error: unknown) => {
        setMaking(undefined);
        // Focus is still on the tile that was pressed: it stays enabled while it works (below), so a refusal
        // lands with the keyboard already where the person left it.
        setFailure(`${strings.createFailed} ${isDataError(error) ? error.message : strings.failedText}`);
      },
    );
  };

  /**
   * Closed is cancelled, and it works while a create is in flight too: a
   * request that never settles must not be a modal only a reload escapes. A
   * draft that lands after this is harmless, since it is unpublished and sits
   * on Forms like any other draft.
   */
  const close = () => {
    setMaking(undefined);
    setFailure(undefined);
    // A failed read is not shown again on the next opening: it reads once more first.
    if (phase.kind === 'failed') setReadCount((count) => count + 1);
    onClose();
  };

  /** Make a blank form: the way out of a failed or empty read, where there are no tiles to press. */
  const blankAction = (
    <Button
      variant="primary"
      isPending={making === 'blank'}
      onPress={() => {
        start('blank');
      }}
    >
      {strings.galleryBlank}
    </Button>
  );

  return (
    <Modal
      variant="window"
      icon="clipboard-list"
      title={strings.galleryTitle}
      isOpen={isOpen}
      onOpenChange={(open) => {
        if (!open) close();
      }}
      // `status`, not `hint`: Modal announces it politely, so a screen reader hears that a form is being made.
      // A plain hint is drawn and never spoken. It names the template, because "Making your form…" beside ten
      // faded tiles told nobody which one they had pressed (UX review, slice 8).
      {...(making === undefined ? {} : { status: strings.galleryMakingOne(makingName) })}
      actions={
        <Button variant="secondary" onPress={close}>
          {strings.cancel}
        </Button>
      }
    >
      {failure !== undefined && (
        <Callout tone="danger" isPolite>
          {failure}
        </Callout>
      )}
      {/* One EmptyState for all three: it holds its own loading delay and draws the tile and lines where the title
          and line will be, so the tiles, the empty line and a failure all land in the same place and the window
          never jumps as the read lands. */}
      {phase.kind === 'loading' && <EmptyState title={strings.galleryLoading} isLoading />}
      {phase.kind === 'failed' && (
        <EmptyState
          tone="error"
          title={strings.galleryFailedTitle}
          onRetry={() => {
            setReadCount((count) => count + 1);
          }}
          actions={blankAction}
        >
          {phase.message}
        </EmptyState>
      )}
      {phase.kind === 'ready' && phase.items.length === 0 && (
        <EmptyState title={strings.galleryEmpty} icon="clipboard-list" actions={blankAction}>
          {strings.galleryEmptyText}
        </EmptyState>
      )}
      {phase.kind === 'ready' && phase.items.length > 0 && (
        <TileGrid
          variant="choice"
          mode="action"
          label={strings.galleryTitle}
          // Each tile owes the person both a preview of the form it makes and the line saying what it is for.
          showsDescription
          keepsPicture
          tiles={phase.items.map((template) =>
            // While one is being made, the pressed tile stays on and the other nine turn off, so the one still
            // lit is the one being made. Turning the pressed one off too threw a keyboard's focus to the
            // document, and ten identically faded tiles said nothing about which had been pressed.
            isBusy && making !== template.id ? { ...tileOf(template), isDisabled: true } : tileOf(template),
          )}
          onAction={(id) => {
            const picked = phase.items.find((each) => each.id === id);
            if (picked !== undefined) start(picked.id);
          }}
        />
      )}
    </Modal>
  );
}
