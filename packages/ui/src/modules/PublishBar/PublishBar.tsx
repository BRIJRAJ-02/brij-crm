import { useId, useState } from 'react';
import { Button, ButtonLink } from '../../atoms/Button/Button.tsx';
import { Icon } from '../../atoms/Icon/Icon.tsx';
import { NumberPop } from '../../atoms/NumberPop/NumberPop.tsx';
import { SuccessCheck } from '../../atoms/SuccessCheck/SuccessCheck.tsx';
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
  readonly onPublish: () => void;
  /** Drops the changes, once the person says so in Discard's confirm. */
  readonly onDiscard: () => void;
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
 * see yet (the count pops as it changes), the changes themselves under Changes, then Versions, Preview, Discard and
 * Publish. Publish asks nothing (it is reversible); Discard asks first. A refused Publish says why in one line with
 * the way to fix it; one that lands draws its check and says Published, and the caller puts the bar back to `live`.
 * With nothing to publish it says the page is live, and keeps Versions.
 */
export function PublishBar({
  status,
  changes,
  problem,
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
  const hasChanges = changes.length > 0 && status !== 'published';
  const isBusy = status === 'publishing';
  return (
    <section
      className={styles.root}
      aria-label={strings.label}
      data-status={status}
      data-open={(isShowingChanges && hasChanges) || undefined}
    >
      <div className={styles.row}>
        <p className={styles.status} role="status">
          {status === 'published' ? (
            <>
              <SuccessCheck />
              <span>{strings.published}</span>
            </>
          ) : hasChanges ? (
            <>
              <span className={styles.dot} aria-hidden="true" />
              <span>
                <NumberPop value={String(changes.length)} /> {strings.notPublished(changes.length)}
              </span>
            </>
          ) : (
            <>
              <Icon name="circle-check" size="sm" />
              <span>{strings.live}</span>
            </>
          )}
        </p>
        <span className={styles.actions}>
          {hasChanges && (
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
                    meta={one.isCurrent ? strings.current : strings.restore}
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
          {hasChanges && (
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
                      {strings.discardChanges}
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
              {status === 'published' ? strings.published : status === 'error' ? strings.tryAgain : strings.publish}
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
      {hasChanges && (
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
