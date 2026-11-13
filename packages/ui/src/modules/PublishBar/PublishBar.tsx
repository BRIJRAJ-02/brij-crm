import { useId, useState } from 'react';
import { Button, ButtonLink } from '../../atoms/Button/Button.tsx';
import { Icon } from '../../atoms/Icon/Icon.tsx';
import { Skeleton } from '../../atoms/Skeleton/Skeleton.tsx';
import { Menu, MenuItem, MenuTrigger } from '../../molecules/Menu/Menu.tsx';
import { Modal, ModalTrigger } from '../../molecules/Modal/Modal.tsx';
import styles from './PublishBar.module.css';
import { strings } from './strings.ts';

/**
 * Where a page stands against what guests see: `live` (nothing to publish), `draft` (changes not published),
 * `publishing`, `published` (said for a moment after Publish lands) or `error` (Publish was refused; `problem` says
 * why and where to fix it).
 */
export type PublishBarStatus = 'live' | 'draft' | 'publishing' | 'published' | 'error';

/** One published version, as the versions menu lists it. */
export interface PublishBarVersion {
  readonly version: number;
  /** Who and when, worded by the caller ("Ada · 2 Nov, 14:30"). */
  readonly label: string;
  readonly isCurrent: boolean;
}

/** Why Publish was refused, in one line, and the way to the setting to fix. */
export interface PublishBarProblem {
  readonly message: string;
  /** Shows the setting to fix ("Go to Hours"). */
  readonly fix?: { readonly label: string; readonly onFix: () => void };
}

/** Props for PublishBar. */
export interface PublishBarProps {
  readonly status: PublishBarStatus;
  /** Each change guests don't see yet, in a plain sentence ("Length 30 min → 45 min"). */
  readonly changes: readonly string[];
  readonly problem?: PublishBarProblem;
  /**
   * The page is paused (guests can't book it): with nothing to publish the bar says so in place of "Live", and nothing
   * in the bar claims the page is live.
   */
  readonly isPaused?: boolean;
  /**
   * What the bar says while `isPaused` with nothing to publish, for a page that isn't booked ("Hidden: guests see
   * that the menu isn't available"). Default: "Paused: guests can't book this page".
   */
  readonly pausedText?: string;
  /**
   * How many changes guests don't see, for an editor that knows the count but not each change (a menu's draft). The
   * count is said and Publish offered; Changes is offered only for the sentences in `changes`. Default:
   * `changes.length`.
   */
  readonly changeCount?: number;
  readonly onPublish: () => void;
  /**
   * Drops the changes, once the person says so in Discard's confirm. Left out, no Discard draft: a page never
   * published has nothing to go back to.
   */
  readonly onDiscard?: () => void;
  /** The draft as a guest would see it, signed in only: a link that opens in a new tab. Left out, no Preview. */
  readonly previewHref?: string;
  /** The last published versions, newest first; undefined while they load. Left out with `onVersions`, no menu. */
  readonly versions?: readonly PublishBarVersion[];
  /** The versions menu opened: the caller reads them. */
  readonly onVersions?: () => void;
  /** A version picked to bring back as the draft. */
  readonly onRestore?: (version: number) => void;
}

/**
 * A public page's publish bar (spec 0068, AC-6811, AC-6812), at the head of its editor: how many changes guests don't
 * see yet, the changes themselves under Changes, then Versions, Preview, Discard draft and Publish. Publish asks
 * nothing (it is reversible); Discard draft asks first. A refused Publish says why in one line with the way to fix it,
 * and Publish keeps its name; one that lands says Published with a plain check (the dashboard's look: an icon and words
 * that crossfade, no public page motion), and the caller puts the bar back to `live`. With nothing to publish it says
 * the page is live, or paused (`isPaused`), and keeps Versions.
 */
export function PublishBar({
  status,
  changes,
  problem,
  isPaused = false,
  pausedText = strings.paused,
  changeCount,
  onPublish,
  onDiscard,
  previewHref,
  versions,
  onVersions,
  onRestore,
}: PublishBarProps) {
  const [isShowingChanges, setShowingChanges] = useState(false);
  const [isAsking, setAsking] = useState(false);
  const listId = useId();
  const count = changeCount ?? changes.length;
  const hasChanges = count > 0 && status !== 'published';
  const hasList = hasChanges && changes.length > 0;
  const isBusy = status === 'publishing';
  const said = status === 'published' ? 'published' : hasChanges ? 'draft' : isPaused ? 'paused' : 'live';
  return (
    <section
      className={styles.root}
      aria-label={strings.label}
      data-status={status}
      data-said={said}
      data-open={(isShowingChanges && hasList) || undefined}
    >
      <div className={styles.row}>
        <p className={styles.status} role="status">
          {/* Keyed by what it says, so a change of state crossfades in (the icon and words swap, nothing moves). */}
          <span key={said} className={styles.said} data-said={said}>
            {said === 'published' ? (
              <>
                <Icon name="circle-check" size="sm" />
                <span>{strings.published}</span>
              </>
            ) : said === 'draft' ? (
              <>
                <span className={styles.dot} aria-hidden="true" />
                <span>{strings.notPublished(count)}</span>
              </>
            ) : said === 'paused' ? (
              <>
                <Icon name="pause" size="sm" />
                <span>{pausedText}</span>
              </>
            ) : (
              <>
                <Icon name="circle-check" size="sm" />
                <span>{strings.live}</span>
              </>
            )}
          </span>
        </p>
        <span className={styles.actions}>
          {hasList && (
            <Button
              variant="ghost"
              icon={isShowingChanges ? 'chevron-up' : 'chevron-down'}
              isExpanded={isShowingChanges}
              controls={listId}
              onPress={() => setShowingChanges((shown) => !shown)}
            >
              {strings.changes}
            </Button>
          )}
          {onVersions !== undefined && onRestore !== undefined && (
            <MenuTrigger
              onOpenChange={(isOpen) => {
                if (isOpen) onVersions();
              }}
            >
              <Button variant="ghost" icon="clock">
                {strings.versions}
              </Button>
              <Menu
                label={strings.versions}
                emptyLabel={versions === undefined ? strings.versionsLoading : strings.versionsNone}
                onAction={(key) => onRestore(Number(key))}
                disabledKeys={(versions ?? []).filter((one) => one.isCurrent).map((one) => String(one.version))}
              >
                {(versions ?? []).map((one) => (
                  <MenuItem
                    key={one.version}
                    id={String(one.version)}
                    description={one.label}
                    meta={one.isCurrent ? (isPaused ? strings.currentPaused : strings.current) : strings.restore}
                  >
                    {strings.version(one.version)}
                  </MenuItem>
                ))}
              </Menu>
            </MenuTrigger>
          )}
          {previewHref !== undefined && hasChanges && (
            <ButtonLink variant="ghost" icon="eye" href={previewHref} isExternal>
              {strings.preview}
            </ButtonLink>
          )}
          {hasChanges && onDiscard !== undefined && (
            <ModalTrigger isOpen={isAsking} onOpenChange={setAsking}>
              <Button variant="ghost" isDisabled={isBusy}>
                {strings.discard}
              </Button>
              <Modal
                title={strings.discardTitle}
                variant="confirm"
                tone="danger"
                actions={
                  <>
                    <Button slot="close">{strings.keep}</Button>
                    <Button
                      variant="danger-solid"
                      onPress={() => {
                        setAsking(false);
                        onDiscard();
                      }}
                    >
                      {strings.discardDraft}
                    </Button>
                  </>
                }
              >
                {strings.discardText}
              </Modal>
            </ModalTrigger>
          )}
          {(hasChanges || status === 'published') && (
            <Button variant="primary" isPending={isBusy} isDisabled={status === 'published'} onPress={onPublish}>
              {status === 'published' ? strings.published : strings.publish}
            </Button>
          )}
        </span>
      </div>
      {status === 'error' && problem !== undefined && (
        <p className={styles.problem} role="alert">
          <Icon name="circle-alert" size="sm" />
          <span>{problem.message}</span>
          {problem.fix !== undefined && (
            <Button variant="link" onPress={problem.fix.onFix}>
              {problem.fix.label}
            </Button>
          )}
        </p>
      )}
      {hasList && (
        <ul className={styles.changes} id={listId} hidden={!isShowingChanges}>
          {changes.map((change) => (
            <li key={change} className={styles.change}>
              {change}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/**
 * The bar standing in while its editor loads: the same strip and height, its status a skeleton line, so the editor
 * below lands where the loading state put it.
 */
export function PublishBarSkeleton() {
  return (
    <div className={styles.root} data-loading="" aria-hidden="true">
      <div className={styles.row}>
        <Skeleton width="short" />
      </div>
    </div>
  );
}
