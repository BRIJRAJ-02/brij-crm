import { Icon } from '../../atoms/Icon/Icon.tsx';
import { Button } from '../../atoms/Button/Button.tsx';
import { ProgressBar } from '../../atoms/ProgressBar/ProgressBar.tsx';
import { Skeleton } from '../../atoms/Skeleton/Skeleton.tsx';
import { VisuallyHidden } from '../../atoms/VisuallyHidden/VisuallyHidden.tsx';
import type { LoadStatus } from '../../lib/load-status.ts';
import { Callout } from '../../molecules/Callout/Callout.tsx';
import { Card } from '../../molecules/Card/Card.tsx';
import { Disclosure } from '../../molecules/Disclosure/Disclosure.tsx';
import { EmptyState } from '../../molecules/EmptyState/EmptyState.tsx';
import { Menu, MenuItem, MenuTrigger } from '../../molecules/Menu/Menu.tsx';
import { strings } from './strings.ts';
import styles from './SetupChecklist.module.css';

/** One setup step. */
export interface SetupChecklistStep {
  readonly id: string;
  /** What to do, as a verb ("Connect your calendar"). */
  readonly title: string;
  /** The state of the thing it names, never a hint ("Not connected", "2 forms"). */
  readonly detail?: string;
  readonly isDone: boolean;
  /** The open step's button, a short verb ("Connect"). A done step shows none. */
  readonly action?: string;
}

/** Props for SetupChecklist. */
export interface SetupChecklistProps {
  /** The card's title ("Finish setting up"). */
  readonly title: string;
  readonly steps: readonly SetupChecklistStep[];
  /** `loading` draws skeleton rows, `error` an EmptyState with Try again. */
  readonly status?: LoadStatus;
  readonly onRetry?: () => void;
  /** An open step's button was pressed. */
  readonly onAction: (id: string) => void;
  /** Puts the checklist away: the ⋯ menu's Hide setup, and the all set note's Dismiss. Without it, neither shows. */
  readonly onHide?: () => void;
  /** Opens the done steps' fold at first (a story's expanded state). */
  readonly defaultDoneExpanded?: boolean;
}

/**
 * Home's setup checklist: a progress bar, the open steps with their buttons
 * (the first one primary), and the done steps folded into one "3 done" line.
 * With one step left it is one row with that step's button; when every step
 * is done it is one quiet "You're all set" line to dismiss.
 */
export function SetupChecklist({
  title,
  steps,
  status = 'ready',
  onRetry,
  onAction,
  onHide,
  defaultDoneExpanded = false,
}: SetupChecklistProps) {
  if (status === 'ready' && steps.length === 0) return null;
  const open = steps.filter((step) => !step.isDone);
  const done = steps.filter((step) => step.isDone);
  if (status === 'ready' && steps.length > 0 && open.length === 0) {
    return (
      <Callout
        tone="success"
        {...(onHide === undefined
          ? {}
          : {
              actions: (
                <Button variant="ghost" onPress={onHide}>
                  {strings.dismiss}
                </Button>
              ),
            })}
      >
        {strings.allSet}
      </Callout>
    );
  }
  const menu =
    onHide === undefined ? undefined : (
      <MenuTrigger>
        <Button variant="ghost" icon="ellipsis" label={strings.more} />
        <Menu
          label={strings.more}
          onAction={(key) => {
            if (key === 'hide') onHide();
          }}
        >
          <MenuItem id="hide" icon="eye-off">
            {strings.hide}
          </MenuItem>
        </Menu>
      </MenuTrigger>
    );
  const last = open[0];
  // One step left: a single row with that step's button, not the whole card (the owner, 22 October 2026).
  if (status === 'ready' && open.length === 1 && last !== undefined) {
    return (
      <Callout
        tone="info"
        actions={
          <>
            {last.action !== undefined && (
              <Button
                variant="primary"
                label={strings.actionName(last.action, last.title)}
                onPress={() => {
                  onAction(last.id);
                }}
              >
                {last.action}
              </Button>
            )}
            {menu}
          </>
        }
      >
        {strings.oneLeft(last.title)}
      </Callout>
    );
  }
  return (
    <Card title={title} isBusy={status === 'loading'} {...(menu === undefined ? {} : { actions: menu })}>
      {status === 'loading' ? (
        <div className={styles.root}>
          <VisuallyHidden>{strings.loading}</VisuallyHidden>
          <Skeleton width="short" />
          <Skeleton lines={3} />
        </div>
      ) : status === 'no-access' ? (
        <EmptyState tone="locked" title={strings.noAccess} layout="row" />
      ) : status === 'error' ? (
        <EmptyState tone="error" title={strings.failed} layout="row" {...(onRetry === undefined ? {} : { onRetry })}>
          {strings.failedBody}
        </EmptyState>
      ) : (
        <div className={styles.root}>
          <ProgressBar
            label={strings.progress(done.length, steps.length)}
            value={done.length}
            maxValue={Math.max(steps.length, 1)}
          />
          <ul className={styles.list} aria-label={title}>
            {open.map((step, index) => (
              <Row key={step.id} step={step} isNext={index === 0} onAction={onAction} />
            ))}
          </ul>
          {done.length > 0 && (
            <Disclosure title={strings.doneCount(done.length)} defaultExpanded={defaultDoneExpanded} headingLevel={4}>
              <ul className={styles.list} aria-label={strings.doneCount(done.length)}>
                {done.map((step) => (
                  <Row key={step.id} step={step} isNext={false} onAction={onAction} />
                ))}
              </ul>
            </Disclosure>
          )}
        </div>
      )}
    </Card>
  );
}

/** One step's row: its mark, its title and detail, and an open step's button. */
function Row({
  step,
  isNext,
  onAction,
}: {
  readonly step: SetupChecklistStep;
  readonly isNext: boolean;
  readonly onAction: (id: string) => void;
}) {
  return (
    <li className={styles.row} data-done={step.isDone || undefined}>
      <span className={styles.mark}>
        <Icon name={step.isDone ? 'circle-check' : 'circle'} tone={step.isDone ? 'success' : 'muted'} />
      </span>
      <span className={styles.text}>
        <span className={styles.title}>
          {step.title}
          <VisuallyHidden>{step.isDone ? strings.isDone : strings.isOpen}</VisuallyHidden>
        </span>
        {step.detail !== undefined && <span className={styles.detail}>{step.detail}</span>}
      </span>
      {!step.isDone && step.action !== undefined && (
        <Button
          variant={isNext ? 'primary' : 'secondary'}
          label={strings.actionName(step.action, step.title)}
          onPress={() => {
            onAction(step.id);
          }}
        >
          {step.action}
        </Button>
      )}
    </li>
  );
}
