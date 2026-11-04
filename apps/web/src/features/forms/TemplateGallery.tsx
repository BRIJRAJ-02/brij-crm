// Brief
// Purpose: New form opens a gallery of ready forms (spec 0063, AC-6323), so nobody starts from an empty page they then have to understand.
// Main task: pick one from the list, see the form it makes beside it, and Use it (or Enter, or a double click) to
// land in its editor.
// Leaves out: editing the template (that is the builder), making templates of your own.
import {
  isDataError,
  type DataLayer,
  type FormTemplateSummary,
  type FormView,
  type OfferedFormTemplateId,
} from '@crm/data';
import { Button, Callout, EmptyState, Modal, TileGrid, Separator, type ChoiceTile, type IconName } from '@crm/ui';
import { Fragment, useEffect, useState } from 'react';
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

/**
 * Each template's mark: a small Lucide icon beside its name, as Tally's and Typeform's template lists draw them. The
 * grey wireframe thumbnails all looked the same (the owner's team, 4 November 2026: "Dont need thumbnails here").
 */
const TEMPLATE_ICONS: Readonly<Record<OfferedFormTemplateId, IconName>> = {
  blank: 'plus',
  contact_us: 'mail',
  demo_request: 'presentation',
  event_signup: 'ticket',
  feedback: 'message-square',
  nps: 'chart-bar',
  job_application: 'briefcase',
  booking_intake: 'calendar-check',
  newsletter: 'newspaper',
  support_request: 'headset',
  customer_onboarding: 'rocket',
  lead_qualification: 'target',
};

/** One template as a compact tile: its mark, its name, and the one short line that says what it is for (AC-6323). */
function tileOf(template: FormTemplateSummary): ChoiceTile {
  return {
    id: template.id,
    name: template.name,
    // Its mark and words alone: the small pictures of each form went (the owner, 5 November 2026).
    icon: TEMPLATE_ICONS[template.id],
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
 * The gallery: a wide window listing the templates, Blank form first and
 * picked as it opens, with a big preview of the picked one beside the list
 * (the form as a visitor sees it), and Use <name> to make it. The tiles are
 * read through the data layer when it opens, and the id is minted once per
 * Use, so a retry makes one form. While one is being made, its tile stays on
 * while the others turn off, so a second Use can't make a second form and a
 * keyboard keeps its place. A read
 * that failed still offers a blank form, because a blank one needs nothing
 * from the catalog and New form could always make one before this existed.
 */
export function TemplateGallery({ data, slug, isOpen, onClose, onCreated }: TemplateGalleryProps) {
  const [making, setMaking] = useState<string | undefined>(undefined);
  // The template picked in the list, shown beside it (Blank, the first, until another is picked).
  const [picked, setPicked] = useState<OfferedFormTemplateId | undefined>(undefined);
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
    setPicked(undefined);
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

  const items = phase.kind === 'ready' ? phase.items : [];
  const chosen = items.find((each) => each.id === picked) ?? items[0];
  return (
    <Modal
      variant="window"
      isWide
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
        <>
          <Button variant="secondary" onPress={close}>
            {strings.cancel}
          </Button>
          {chosen !== undefined && (
            <Button
              variant="primary"
              isPending={making === chosen.id}
              isDisabled={isBusy && making !== chosen.id}
              onPress={() => {
                start(chosen.id);
              }}
            >
              {strings.galleryUse(chosen.name)}
            </Button>
          )}
        </>
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
        <EmptyState title={strings.galleryEmpty} actions={blankAction}>
          {strings.galleryEmptyText}
        </EmptyState>
      )}
      {phase.kind === 'ready' && phase.items.length > 0 && (
        <>
          {/* Blank form first, on its own, then the ready ones under a "Templates" line (the owner, 5 November 2026:
              "simple tiles", no pictures). Two grids share one choice, so Use <name> uses whichever was picked last. */}
          {[items.filter((each) => each.id === 'blank'), items.filter((each) => each.id !== 'blank')].map(
            (group, at) =>
              group.length === 0 ? null : (
                <Fragment key={at === 0 ? 'blank' : 'templates'}>
                  {at === 1 && <Separator label={strings.galleryTemplates} />}
                  <TileGrid
                    variant="choice"
                    label={at === 0 ? strings.galleryTitle : strings.galleryTemplates}
                    // One simple tile shape for both: the mark beside the name, the line under it.
                    tileWidth="wide"
                    showsDescription
                    keepsPicture
                    // The gallery's first step is this choice: focus starts on the picked template (the owner's ask).
                    // eslint-disable-next-line jsx-a11y-x/no-autofocus
                    autoFocus={group.some((each) => each.id === chosen?.id)}
                    value={chosen?.id ?? null}
                    tiles={group.map((template) =>
                      // While one is being made, the chosen tile stays on and the others turn off, so the one still lit
                      // is the one being made and a keyboard keeps its place on it.
                      isBusy && making !== template.id ? { ...tileOf(template), isDisabled: true } : tileOf(template),
                    )}
                    onChange={(id) => {
                      const next = items.find((each) => each.id === id);
                      if (next !== undefined) setPicked(next.id);
                    }}
                    // Enter on a template, or a double click, uses it, as Use <name> does (forms fixes 3).
                    onConfirm={(id) => {
                      const next = items.find((each) => each.id === id);
                      if (next === undefined) return;
                      setPicked(next.id);
                      start(next.id);
                    }}
                  />
                </Fragment>
              ),
          )}
        </>
      )}
    </Modal>
  );
}
