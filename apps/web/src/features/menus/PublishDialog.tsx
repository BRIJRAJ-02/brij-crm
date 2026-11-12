// Brief
// Purpose: Review and publish (checklabs' first publish sheet): what still keeps the menu from guests, each with Fix,
// then Publish & go live; once live, the library's ShareSheet with the link and its QR code (spec 0074, AC-7405),
// which the split Publish's Share opens too.
// Main task: publish a menu guests can use, then share it.
// Leaves out: a QR code per table (H2, the Menu QR app) and choosing only some changes (everything publishes at once).
import type { MenuDraft, MenuPlace, MenuStore } from '@crm/data';
import { Button, ButtonLink, Callout, Modal, SetupChecklist, type Toasts } from '@crm/ui';
import { useEffect, useState } from 'react';
import { publicMenuUrl } from '../booking/links.ts';
import { lazyShareSheet } from '../share/LazyShareSheet.tsx';
import { goingLive, homelessMenus, unpricedDishes, type publishBlocker } from './preview.ts';
import { strings } from './strings.ts';

/** The share sheet, loaded apart from the screen's first paint (spec 0074, AC-7419). */
const { ShareSheet, usePreload } = lazyShareSheet(() => import('../share/share-sheet.ts'));

/** Loads the share sheet's code once the Menus screen is idle, so a first Share or publish never waits on it. */
export const usePreloadShareSheet = usePreload;

/** Where a Fix takes the person. */
export type PublishFix =
  | { readonly kind: 'hours' }
  | { readonly kind: 'dishes' }
  | { readonly kind: 'item'; readonly itemId: string }
  | { readonly kind: 'menu'; readonly menuId: string };

/** The review, then the live link. */
export function PublishDialog({
  store,
  slug,
  draft,
  place,
  hasHours,
  blocker,
  startsOn = 'review',
  toasts,
  onClose,
  onFix,
}: {
  readonly store: MenuStore;
  readonly slug: string;
  readonly draft: MenuDraft;
  readonly place?: MenuPlace;
  readonly hasHours: boolean;
  readonly blocker: ReturnType<typeof publishBlocker>;
  /** `live` opens on the share sheet (Share); `review` (the default) on the checks. */
  readonly startsOn?: 'review' | 'live';
  readonly toasts: Toasts;
  readonly onClose: () => void;
  readonly onFix: (fix: PublishFix) => void;
}) {
  const isLive = draft.publishedAt !== undefined;
  const link = place === undefined ? undefined : publicMenuUrl(place.menuKey);
  // Share, or a live menu with nothing new, opens on the share sheet; a publish just now says it is live. With no
  // place there is no address, so it opens on the review.
  const [stage, setStage] = useState<'review' | 'live' | 'published'>(
    link !== undefined && ((startsOn === 'live' && isLive) || (isLive && draft.changes === 0)) ? 'live' : 'review',
  );
  // The place gone while the sheet is open (a live change): nothing is left to share, so the dialog closes.
  const isStranded = stage !== 'review' && link === undefined;
  useEffect(() => {
    if (isStranded) onClose();
  }, [isStranded, onClose]);
  const [isPublishing, setPublishing] = useState(false);
  const [refusal, setRefusal] = useState<string>();
  const placed = draft.sections.some((section) => section.itemIds.length > 0);
  const unpriced = unpricedDishes(draft);
  const homeless = homelessMenus(draft);
  const live = goingLive(draft);

  // An open check's title says exactly what to fix (the checklist folds to its title when one step is left).
  const checks = [
    {
      id: 'hours',
      title: hasHours ? strings.checkHours : strings.checkHoursTodo,
      isDone: hasHours,
      action: strings.fixIt,
    },
    {
      id: 'dishes',
      title: placed ? strings.checkDishes : strings.checkDishesTodo,
      isDone: placed,
      action: strings.fixIt,
    },
    {
      id: 'prices',
      title: unpriced[0] === undefined ? strings.checkPrices : strings.unpricedBlocker(unpriced[0].name),
      isDone: unpriced.length === 0,
      action: strings.fixIt,
    },
    {
      id: 'places',
      title: homeless[0] === undefined ? strings.checkPlaces : strings.checkPlacesTodo(homeless[0].name),
      isDone: homeless.length === 0,
      action: strings.fixIt,
    },
  ];

  const isReady = checks.every((check) => check.isDone) && live.length > 0;

  const publish = async () => {
    setPublishing(true);
    setRefusal(undefined);
    const refused = await store.publish(slug);
    setPublishing(false);
    if (refused !== undefined) {
      setRefusal(refused.message);
      return;
    }
    // With no place there is no address to share: the publish says it in a toast instead (AC-7405).
    if (link === undefined) {
      toasts.toast({ tone: 'success', message: strings.liveTitle });
      onClose();
      return;
    }
    setStage('published');
  };

  // The review and the sheet are two dialogs side by side, so after a publish one plays its exit while the other
  // enters, rather than the scrim dropping for a frame between them.
  return (
    <>
      <Modal
        variant="form"
        title={strings.reviewTitle}
        isOpen={stage === 'review'}
        isBusy={isPublishing}
        onOpenChange={(isOpen) => {
          if (!isOpen) onClose();
        }}
        actions={
          <>
            <Button slot="close" isDisabled={isPublishing}>
              {strings.keepEditing}
            </Button>
            <Button
              variant="primary"
              isPending={isPublishing}
              isDisabled={blocker !== undefined || (isLive && draft.changes === 0)}
              onPress={() => void publish()}
            >
              {isLive ? strings.publishNow : strings.publishGoLive}
            </Button>
          </>
        }
      >
        <>
          {isReady ? strings.readyLine : strings.reviewLine}
          {isReady ? (
            // Every check passes: say what goes live, keeping the count of changes in view (UX review must-fix 4).
            <Callout
              tone="success"
              title={isLive && draft.changes === 0 ? strings.nothingToPublish : strings.changes(draft.changes)}
            >
              {strings.goesLive(live)}
            </Callout>
          ) : (
            <SetupChecklist
              title={isLive && draft.changes === 0 ? strings.nothingToPublish : strings.changes(draft.changes)}
              steps={checks}
              onAction={(id) => {
                if (id === 'hours') onFix({ kind: 'hours' });
                else if (id === 'dishes') onFix({ kind: 'dishes' });
                else if (id === 'prices' && unpriced[0] !== undefined) onFix({ kind: 'item', itemId: unpriced[0].id });
                else if (id === 'places' && homeless[0] !== undefined) onFix({ kind: 'menu', menuId: homeless[0].id });
              }}
            />
          )}
          {refusal === undefined ? null : <Callout tone="danger">{refusal}</Callout>}
        </>
      </Modal>
      {link === undefined || place === undefined ? null : (
        <ShareSheet
          isOpen={stage !== 'review'}
          onOpenChange={(isOpen) => {
            if (!isOpen) onClose();
          }}
          title={stage === 'published' ? strings.liveTitle : strings.shareTitle}
          url={link}
          name={strings.shareName(place.name)}
          invite={strings.shareInvite}
          extra={
            <ButtonLink variant="ghost" href={link} isExternal icon="external-link">
              {strings.openGuest}
            </ButtonLink>
          }
        />
      )}
    </>
  );
}
