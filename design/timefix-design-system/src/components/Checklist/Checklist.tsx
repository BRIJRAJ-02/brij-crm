import { Button as AriaButton, Disclosure, DisclosurePanel, Heading } from 'react-aria-components';
import { useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { ChevronDown, X } from 'lucide-react';
import { cx } from '../../lib/cx.ts';
import { Button, IconButton } from '../Button/Button.tsx';
import { motionMs } from '../FloatingBar/FloatingBar.tsx';
import { SuccessCheck } from '../Motion/Motion.tsx';
import { ProgressBar } from '../Progress/Progress.tsx';
import './Checklist.css';

/** One setup step. */
export interface ChecklistStep {
  readonly id: string;
  /** What to do, as a verb ("Connect your calendar"). */
  readonly title: string;
  /** One line on why it helps, or the state of the thing it names ("Not connected"). */
  readonly description?: string;
  /** Lucide icon at 16px for the step's well. */
  readonly icon: ReactNode;
  /** The open step's soft button, a short verb ("Connect"). */
  readonly actionLabel: string;
  readonly isDone: boolean;
}

/** Props for Checklist. */
export interface ChecklistProps {
  /** The card's title ("Finish setting up"). */
  readonly title: string;
  /** Four to six steps. Done steps move below the open ones. */
  readonly steps: readonly ChecklistStep[];
  readonly onAction: (id: string) => void;
  /** Puts the checklist away (× in the head, and the all-set row's button). */
  readonly onHide?: () => void;
  readonly defaultExpanded?: boolean;
}

/** A setup checklist in a shell: "2 of 6" and a thin bar, open steps with an icon well and a soft action, done steps with a round blue check and a struck title that slide below. Folds away with accordion motion. */
export function Checklist({ title, steps, onAction, onHide, defaultExpanded = true }: ChecklistProps) {
  const done = steps.filter((s) => s.isDone).length;
  const ordered = [...steps.filter((s) => !s.isDone), ...steps.filter((s) => s.isDone)];
  const allDone = done === steps.length;
  // Done steps fold into one quiet line once there are a few, so what's left stays in view.
  const [showDone, setShowDone] = useState(false);
  const foldDone = done >= 2 && !showDone;
  const list = useRef<HTMLOListElement>(null);
  const tops = useRef(new Map<string, number>());
  const order = ordered.map((s) => s.id).join(',');
  // FLIP: a step that changed place glides from where it was (350ms).
  useLayoutEffect(() => {
    const el = list.current;
    if (!el || el.offsetHeight === 0) return;
    const ms = motionMs('--duration-medium', 350);
    const easing = getComputedStyle(document.documentElement).getPropertyValue('--ease-smooth-out').trim() || 'ease-out';
    el.querySelectorAll<HTMLElement>('[data-step]').forEach((row) => {
      const id = row.dataset.step ?? '';
      const top = row.offsetTop;
      const before = tops.current.get(id);
      tops.current.set(id, top);
      if (before !== undefined && before !== top && ms > 0) row.animate([{ transform: `translateY(${before - top}px)` }, { transform: 'none' }], { duration: ms, easing });
    });
  }, [order]);
  return (
    <Disclosure className="tf-checklist" defaultExpanded={defaultExpanded}>
      <div className="tf-checklist__head">
        <Heading className="tf-checklist__heading">
          <AriaButton slot="trigger" className="tf-checklist__trigger">
            <span className="tf-checklist__title">{title}</span>
            <span className="tf-checklist__count tf-num">{done} of {steps.length}</span>
            <ChevronDown className="tf-checklist__chevron" size={16} strokeWidth={1.75} aria-hidden="true" />
          </AriaButton>
        </Heading>
        {onHide && <IconButton label="Hide setup" size="sm" onPress={onHide}><X size={14} strokeWidth={1.75} /></IconButton>}
      </div>
      <div className="tf-checklist__bar"><ProgressBar size="sm" value={done} maxValue={steps.length} aria-label={`${done} of ${steps.length} steps done`} /></div>
      <DisclosurePanel className="tf-checklist__panel">
        <div className="tf-checklist__inner">
          {allDone ? (
            <div className="tf-checklist__alldone">
              <span className="tf-checklist__well tf-checklist__well--done" aria-hidden="true"><SuccessCheck size={16} /></span>
              <div className="tf-checklist__text"><p className="tf-checklist__step-title">You're all set</p><p className="tf-checklist__desc">Guests can book you now. Share your link to get the first one.</p></div>
              {onHide && <Button variant="soft" size="sm" onPress={onHide}>Hide</Button>}
            </div>
          ) : (
            <ol className="tf-checklist__steps" ref={list}>
              {ordered.filter((s) => !(foldDone && s.isDone)).map((s) => (
                <li key={s.id} data-step={s.id} className={cx('tf-checklist__step', s.isDone && 'is-done')}>
                  {s.isDone
                    ? <span className="tf-checklist__tick" aria-hidden="true"><SuccessCheck size={14} /></span>
                    : <span className="tf-checklist__well" aria-hidden="true">{s.icon}</span>}
                  <div className="tf-checklist__text">
                    <p className="tf-checklist__step-title">{s.title}{s.isDone && <span className="tf-sr-only"> (done)</span>}</p>
                    {!s.isDone && s.description !== undefined && <p className="tf-checklist__desc">{s.description}</p>}
                  </div>
                  {!s.isDone && <Button variant="soft" size="sm" onPress={() => onAction(s.id)}>{s.actionLabel}</Button>}
                </li>
              ))}
              {done >= 2 && <li className="tf-checklist__fold"><AriaButton className="tf-checklist__foldbtn" onPress={() => setShowDone((v) => !v)} aria-expanded={showDone}>
                <span className="tf-checklist__tick" aria-hidden="true"><SuccessCheck size={14} /></span>{showDone ? 'Hide done steps' : `${done} done`}<ChevronDown className="tf-checklist__foldchev" data-open={showDone || undefined} size={14} strokeWidth={1.75} aria-hidden="true" />
              </AriaButton></li>}
            </ol>
          )}
        </div>
      </DisclosurePanel>
    </Disclosure>
  );
}
