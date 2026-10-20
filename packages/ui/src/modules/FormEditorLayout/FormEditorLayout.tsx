import { useId, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { Disclosure } from '../../molecules/Disclosure/Disclosure.tsx';
import styles from './FormEditorLayout.module.css';
import { strings } from './strings.ts';

/** Where a form stands, as its status line shows it. */
export type FormEditorTone = 'live' | 'changed' | 'draft' | 'paused';

/** Props for FormEditorLayout. */
export interface FormEditorLayoutProps {
  /**
   * The status line: `live` (a filled dot in the success colour: "Published ·
   * v7"), `changed` (filled, the warning colour: "Published · Unpublished
   * changes"), `draft` and `paused` (a hollow dot: "Not published", "Not
   * accepting"). Absent on the forms list, which uses the same page column.
   */
  readonly status?: { readonly tone: FormEditorTone; readonly text: string };
  /** At the top, at the end of the row: a page's own action (the forms list's New form, under the Captures tabs). */
  readonly actions?: ReactNode;
  /** Under the status line: the Tabs strip (Form, Settings, Install, Submissions), once the form was published. */
  readonly tabs?: ReactNode;
  /** Above the body: a refused publish's Callout, a teammate's change. */
  readonly notices?: ReactNode;
  /** The live preview, sticky in a 400px column beside the body; under it, in "Show preview", when they don't both fit. */
  readonly preview?: ReactNode;
  /**
   * The look's Selects (Colour, Corners), at the end of the preview's header
   * row beside its "Preview" heading, level with the body's first header.
   * Give them hidden labels and `size="sm"`; their values say what they set.
   */
  readonly previewControls?: ReactNode;
  /** The tab's content: the questions, the settings, the install cards, the submissions. */
  readonly children: ReactNode;
}

/**
 * The status line on its own: for the TopBar's meta, beside the form's name,
 * so the header stays one line ("● Published · v7", "○ Not published").
 */
export function FormEditorStatus({ tone, text }: { readonly tone: FormEditorTone; readonly text: string }) {
  return (
    <span className={styles.status}>
      <span className={styles.dot} data-tone={tone} aria-hidden="true" />
      {text}
    </span>
  );
}

/** The narrowest width that holds the body beside the 400px preview. */
const TWO_COLUMNS_MIN = 880;

/**
 * FormEditorLayout: the form builder's page under the TopBar (which holds the
 * name, Preview, Publish and the menu): the status line, the tabs, any
 * notices, then the body with the live preview beside it, or under it in a
 * Disclosure on a narrow page.
 */
export function FormEditorLayout({
  status,
  actions,
  tabs,
  notices,
  preview,
  previewControls,
  children,
}: FormEditorLayoutProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const previewHeadingId = useId();
  const [isWide, setWide] = useState(true);

  useLayoutEffect(() => {
    const root = rootRef.current;
    if (root === null) return;
    const measure = () => {
      setWide(root.getBoundingClientRect().width >= TWO_COLUMNS_MIN);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(root);
    return () => {
      observer.disconnect();
    };
  }, []);

  // Beside the body, the preview's header names it; under it, in "Show preview", the Disclosure already does.
  const previewBody = (
    <div className={styles.preview}>
      {(isWide || previewControls !== undefined) && (
        <div className={styles.previewHead}>
          {isWide && (
            <h2 className={styles.previewHeading} id={previewHeadingId}>
              {strings.preview}
            </h2>
          )}
          {previewControls !== undefined && <div className={styles.controls}>{previewControls}</div>}
        </div>
      )}
      <div className={styles.frame}>{preview}</div>
    </div>
  );

  return (
    <div ref={rootRef} className={styles.root}>
      {actions !== undefined && <div className={styles.actions}>{actions}</div>}
      {status !== undefined && <FormEditorStatus tone={status.tone} text={status.text} />}
      {tabs !== undefined && <div className={styles.tabs}>{tabs}</div>}
      {notices}
      <div className={styles.body} data-columns={(preview !== undefined && isWide) || undefined}>
        <div className={styles.main}>{children}</div>
        {preview !== undefined && isWide && (
          <aside className={styles.aside} aria-labelledby={previewHeadingId}>
            {previewBody}
          </aside>
        )}
      </div>
      {preview !== undefined && !isWide && <Disclosure title={strings.showPreview}>{previewBody}</Disclosure>}
    </div>
  );
}
