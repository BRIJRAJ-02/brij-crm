import type { PublicForm } from '@crm/contracts/forms';
import { useLayoutEffect, useRef, useState } from 'react';
import { Button as AriaButton } from 'react-aria-components';
import { Field } from '../../molecules/Field/Field.tsx';
import { Popover } from '../../molecules/Popover/Popover.tsx';
import { HostedForm } from '../../public-form/HostedForm.tsx';
import { HostedFormSteps } from '../../public-form/HostedFormSteps.tsx';
import type { PreviewEnding } from '../../public-form/use-hosted-form.ts';
import type { ProductLogo } from '../AuthLayout/AuthLayout.tsx';
import type { PageBrand } from '../BookingFrame/BookingFrame.tsx';
import styles from './HostedFormPreview.module.css';
import { strings } from './strings.ts';

/** A change a builder makes on the preview itself: the headline, the line under it, or the button's words. */
export interface PreviewTextChange {
  readonly headline?: string;
  readonly subheading?: string;
  readonly buttonText?: string;
}

/** Props for HostedFormPreview. */
export interface HostedFormPreviewProps {
  /** The form as a visitor gets it: the builder's draft, turned into the public shape. */
  readonly form: PublicForm;
  /**
   * `preview` (the default) is the builder's column: inert, never focusable or
   * submittable, hidden from assistive tech but for a note that it is a
   * preview. `page` draws it as its own page that checks answers and thanks,
   * but sends nothing: a draft opened to try.
   */
  readonly mode?: 'preview' | 'page';
  /** The Timefix wordmark under the form; defaults to the web app's own files, as on the hosted page. */
  readonly logo?: ProductLogo;
  /**
   * Steps and One at a time: which step, or which question, the preview shows (from 0), the one being edited beside
   * it (spec 0063). The inert preview can't be stepped through, so the builder points it.
   */
  readonly step?: number;
  /** A brand kit to wear in place of the one the form's read names (Settings › Brand's preview, spec 0060). */
  readonly brand?: PageBrand;
  /**
   * Makes the headline and the button editable where they are (T21, 5 November 2026, as Tally edits on the form):
   * pressing either opens a small popover by it with its words. The rest stays inert. Left out, nothing is editable.
   */
  readonly onTextChange?: (change: PreviewTextChange) => void;
  /**
   * The thank you (`{}`) or an ending (its heading and line), drawn in the form's place while the owner has it
   * open in the builder (5 November 2026), so the preview shows what the visitor will read after sending.
   */
  readonly ending?: PreviewEnding;
}

/** Where an editable part sits over the ground, in pixels from its corner. */
interface Spot {
  readonly top: number;
  readonly left: number;
  readonly width: number;
  readonly height: number;
}

/**
 * The form a visitor fills in, drawn by the hosted page's own component, so
 * the builder shows exactly what goes live: the same tree, the same controls,
 * in the form's own layout (Classic, Steps or One at a time, spec 0063). It
 * sits on the form's own ground, which fills whatever height it is given.
 */
export function HostedFormPreview({
  form,
  mode = 'preview',
  logo,
  step,
  brand,
  onTextChange,
  ending,
}: HostedFormPreviewProps) {
  const layout = form.layout ?? 'classic';
  const shared = {
    form,
    mode,
    ...(logo === undefined ? {} : { logo }),
    ...(brand === undefined ? {} : { brand }),
    ...(ending === undefined || mode !== 'preview' ? {} : { previewEnding: ending }),
  };
  // The ground in the form's own look, so a short form's colour fills the phone to its foot (spec 0058). A change
  // of layout starts the preview again, from its first step.
  return (
    <div className={styles.ground} data-theme={form.look.colour}>
      {layout === 'classic' ? (
        <HostedForm key={`${mode}-${layout}`} {...shared} />
      ) : (
        <HostedFormSteps key={`${mode}-${layout}`} {...shared} {...(step === undefined ? {} : { previewStep: step })} />
      )}
      {onTextChange !== undefined && mode === 'preview' && (
        <TextEditing form={form} step={step} onTextChange={onTextChange} />
      )}
    </div>
  );
}

/** The two parts of the preview a builder edits in place. */
type Part = 'headline' | 'button';

/**
 * The headline and the button made editable over the inert preview: a quiet press target laid exactly over each
 * (measured, and again as the preview resizes), so the hosted page's own tree, which every visitor loads, carries
 * nothing for it. The button is editable where it says the form's own words: the last step, or Classic.
 */
function TextEditing({
  form,
  step,
  onTextChange,
}: {
  readonly form: PublicForm;
  readonly step: number | undefined;
  readonly onTextChange: (change: PreviewTextChange) => void;
}) {
  const layer = useRef<HTMLDivElement>(null);
  const [spots, setSpots] = useState<{ readonly headline?: Spot; readonly button?: Spot }>({});
  const [editing, setEditing] = useState<Part | undefined>(undefined);
  const headlineRef = useRef<HTMLButtonElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);

  useLayoutEffect(() => {
    const ground = layer.current?.parentElement;
    if (ground === null || ground === undefined) return undefined;
    const measure = () => {
      const base = ground.getBoundingClientRect();
      const spotOf = (element: Element | null | undefined): Spot | undefined => {
        if (element === null || element === undefined) return undefined;
        const box = element.getBoundingClientRect();
        if (box.width === 0 || box.height === 0) return undefined;
        return { top: box.top - base.top, left: box.left - base.left, width: box.width, height: box.height };
      };
      // The headline is the preview's one h2 (the hosted page's FormHeader), with the line under it in its header.
      const heading = ground.querySelector('h2');
      const header = heading?.closest('header') ?? heading;
      const words = form.buttonText.trim();
      const button = [...ground.querySelectorAll('button[type="button"]')].find(
        (each) => !layer.current?.contains(each) && each.textContent.trim() === words,
      );
      setSpots({ headline: spotOf(header), button: spotOf(button) });
    };
    measure();
    const watcher = new ResizeObserver(measure);
    watcher.observe(ground);
    return () => {
      watcher.disconnect();
    };
  }, [form, step]);

  const px = (value: number) => `${String(value)}px`;
  return (
    <div ref={layer} className={styles.edits}>
      {spots.headline !== undefined && (
        <AriaButton
          ref={headlineRef}
          className={styles.spot}
          // Position only, from the measured box: custom properties alone, as a token can't know where it sits.
          style={{
            '--spot-top': px(spots.headline.top),
            '--spot-left': px(spots.headline.left),
            '--spot-width': px(spots.headline.width),
            '--spot-height': px(spots.headline.height),
          }}
          aria-label={strings.editHeadline}
          data-open={editing === 'headline' || undefined}
          onPress={() => {
            setEditing('headline');
          }}
        />
      )}
      {spots.button !== undefined && (
        <AriaButton
          ref={buttonRef}
          className={styles.spot}
          style={{
            '--spot-top': px(spots.button.top),
            '--spot-left': px(spots.button.left),
            '--spot-width': px(spots.button.width),
            '--spot-height': px(spots.button.height),
          }}
          aria-label={strings.editButton}
          data-open={editing === 'button' || undefined}
          onPress={() => {
            setEditing('button');
          }}
        />
      )}
      <Popover
        label={editing === 'button' ? strings.editButton : strings.editHeadline}
        triggerRef={editing === 'button' ? buttonRef : headlineRef}
        isOpen={editing !== undefined}
        onOpenChange={(isOpen) => {
          if (!isOpen) setEditing(undefined);
        }}
        placement="bottom start"
        width="menu"
      >
        {editing === 'button' ? (
          <Field
            label={strings.buttonText}
            value={form.buttonText}
            maxLength={40}
            onChange={(buttonText) => {
              onTextChange({ buttonText });
            }}
            onSubmit={() => {
              setEditing(undefined);
            }}
          />
        ) : (
          <>
            <Field
              label={strings.headline}
              value={form.headline}
              maxLength={120}
              onChange={(headline) => {
                onTextChange({ headline });
              }}
              onSubmit={() => {
                setEditing(undefined);
              }}
            />
            <Field
              label={strings.subheading}
              placeholder={strings.subheadingPlaceholder}
              value={form.subheading ?? ''}
              maxLength={240}
              onChange={(subheading) => {
                onTextChange({ subheading });
              }}
              onSubmit={() => {
                setEditing(undefined);
              }}
            />
          </>
        )}
      </Popover>
    </div>
  );
}
