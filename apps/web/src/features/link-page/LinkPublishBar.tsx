// Publish for the link page (spec 0068, AC-6810 to AC-6812), at the head of its screen: what guests don't see yet,
// Changes, Versions, Preview (the draft in a new tab, signed in only), Discard draft (asks first) and Publish.
// Restore over unpublished changes asks first too. The bar's state is read from the data layer's link page store
// after each edit settles; Discard and Restore change the rows under the editor, so the route reads again after them.
import { isDataError, type LinkPageStore } from '@crm/data';
import { Button, Modal, PublishBar, type PublishBarStatus, type PublishBarVersion } from '@crm/ui';
import { useRouter } from '@tanstack/react-router';
import { useEffect, useRef, useState } from 'react';
import { publishStrings } from '../booking/publish-strings.ts';

/** Where the page stands, as the store answers it. */
type LinkPagePublication = Awaited<ReturnType<LinkPageStore['publication']['read']>>;

/** How long "Published" stays before the bar says the page is live. */
const PUBLISHED_MS = 1600;
/** An edit's save lands, then the bar reads where the page stands; edits in a burst read once. */
const SETTLE_MS = 400;

/** Props for LinkPublishBar. */
export interface LinkPublishBarProps {
  readonly linkPage: LinkPageStore;
  readonly slug: string;
  /** The page's own address, `/<handle>`: Preview opens it with `?draft=1`. */
  readonly address: string;
  /** Private (the Live switch off): the bar says so rather than live. */
  readonly isPaused: boolean;
  /** What changes when the page's draft may have: the blocks' state, the look and the profile, each by identity. */
  readonly blocks: unknown;
  readonly look: unknown;
  readonly profile: unknown;
}

/** The link page's publish bar, connected to the data layer. */
export function LinkPublishBar({ linkPage, slug, address, isPaused, blocks, look, profile }: LinkPublishBarProps) {
  const router = useRouter();
  const [publication, setPublication] = useState<LinkPagePublication | undefined>(undefined);
  const [status, setStatus] = useState<PublishBarStatus | undefined>(undefined);
  const [problem, setProblem] = useState<string | undefined>(undefined);
  const [versions, setVersions] = useState<readonly PublishBarVersion[] | undefined>(undefined);
  const [restoreAsked, setRestoreAsked] = useState<number | undefined>(undefined);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);

  // Read again once an edit has had time to land, and whenever the tab comes back into view.
  useEffect(() => {
    let isCurrent = true;
    const read = () =>
      void linkPage.publication.read(slug).then(
        (next) => {
          if (isCurrent) setPublication(next);
        },
        () => undefined,
      );
    const settle = setTimeout(read, SETTLE_MS);
    const onShow = () => {
      if (document.visibilityState === 'visible') read();
    };
    document.addEventListener('visibilitychange', onShow);
    return () => {
      isCurrent = false;
      clearTimeout(settle);
      document.removeEventListener('visibilitychange', onShow);
    };
  }, [linkPage, slug, blocks, look, profile]);

  const changes = publication?.changes ?? [];
  const took = (next: LinkPagePublication) => {
    setPublication(next);
    setVersions(undefined);
  };
  const failed = (error: unknown) => {
    setStatus('error');
    setProblem(isDataError(error) ? error.message : publishStrings.publishFailed);
  };
  const publish = () => {
    setStatus('publishing');
    setProblem(undefined);
    linkPage.publication.publish(slug).then((next) => {
      took(next);
      setStatus('published');
      clearTimeout(timer.current);
      timer.current = setTimeout(() => setStatus(undefined), PUBLISHED_MS);
    }, failed);
  };
  const discard = () => {
    linkPage.publication.discard(slug).then((next) => {
      took(next);
      setStatus(undefined);
      void router.invalidate();
    }, failed);
  };
  const restore = (version: number) => {
    linkPage.publication.restore(slug, version).then((next) => {
      took(next);
      setStatus(undefined);
      void router.invalidate();
    }, failed);
  };
  const readVersions = () => {
    linkPage.publication.versions(slug).then(
      (list) =>
        setVersions(
          list.versions.map((one) => ({
            version: one.version,
            isCurrent: one.isCurrent,
            label: publishStrings.versionLabel(one.publishedBy, new Date(one.publishedAt)),
          })),
        ),
      failed,
    );
  };
  const shown: PublishBarStatus = status ?? (changes.length > 0 ? 'draft' : 'live');
  return (
    <>
      <PublishBar
        status={shown}
        changes={changes}
        {...(problem === undefined || shown !== 'error' ? {} : { problem: { message: problem } })}
        onPublish={publish}
        onDiscard={discard}
        previewHref={`${address}?draft=1`}
        isPaused={isPaused}
        {...(versions === undefined ? {} : { versions })}
        onVersions={readVersions}
        onRestore={(version) => {
          if (changes.length > 0) setRestoreAsked(version);
          else restore(version);
        }}
      />
      <Modal
        title={publishStrings.restoreTitle(restoreAsked ?? 0)}
        variant="confirm"
        tone="danger"
        isOpen={restoreAsked !== undefined}
        onOpenChange={(open) => {
          if (!open) setRestoreAsked(undefined);
        }}
        actions={
          <>
            <Button slot="close">{publishStrings.restoreKeep}</Button>
            <Button
              variant="danger-solid"
              onPress={() => {
                if (restoreAsked !== undefined) restore(restoreAsked);
                setRestoreAsked(undefined);
              }}
            >
              {publishStrings.restoreConfirm}
            </Button>
          </>
        }
      >
        {publishStrings.restoreText}
      </Modal>
    </>
  );
}
