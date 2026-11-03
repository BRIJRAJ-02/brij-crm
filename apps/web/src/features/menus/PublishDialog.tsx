// Brief
// Purpose: Review and publish (checklabs' first publish sheet and its "You're live" QR dialog, in one): what still
// keeps the menu from guests, each with Fix, then Publish; once live, the link and its QR code to share.
// Main task: publish a menu guests can use, then share it.
// Leaves out: a QR code per table (H2, the Menu QR app) and choosing only some changes (everything publishes at once).
import type { MenuDraft, MenuPlace, MenuStore } from '@crm/data';
import { Button, ButtonLink, Callout, CopyButton, Modal, QrCode, SetupChecklist } from '@crm/ui';
import { useState } from 'react';
import { publicMenuUrl } from '../booking/links.ts';
import { homelessMenus, unpricedDishes, type publishBlocker } from './preview.ts';
import { strings } from './strings.ts';

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
  onClose,
  onPublished,
  onFix,
}: {
  readonly store: MenuStore;
  readonly slug: string;
  readonly draft: MenuDraft;
  readonly place?: MenuPlace;
  readonly hasHours: boolean;
  readonly blocker: ReturnType<typeof publishBlocker>;
  readonly onClose: () => void;
  readonly onPublished: () => void;
  readonly onFix: (fix: PublishFix) => void;
}) {
  const isLive = draft.publishedAt !== undefined;
  // Opened on a live menu with nothing new (Show QR code), it opens on the link.
  const [stage, setStage] = useState<'review' | 'live'>(isLive && draft.changes === 0 ? 'live' : 'review');
  const [isPublishing, setPublishing] = useState(false);
  const [refusal, setRefusal] = useState<string>();
  const placed = draft.sections.some((section) => section.itemIds.length > 0);
  const unpriced = unpricedDishes(draft);
  const homeless = homelessMenus(draft);
  const link = place === undefined ? undefined : publicMenuUrl(place.menuKey);

  const checks = [
    {
      id: 'hours',
      title: strings.checkHours,
      ...(hasHours ? {} : { detail: strings.checkHoursTodo }),
      isDone: hasHours,
      action: strings.fixIt,
    },
    {
      id: 'dishes',
      title: strings.checkDishes,
      ...(placed ? {} : { detail: strings.checkDishesTodo }),
      isDone: placed,
      action: strings.fixIt,
    },
    {
      id: 'prices',
      title: strings.checkPrices,
      ...(unpriced[0] === undefined ? {} : { detail: strings.unpricedBlocker(unpriced[0].name) }),
      isDone: unpriced.length === 0,
      action: strings.fixIt,
    },
    {
      id: 'places',
      title: strings.checkPlaces,
      ...(homeless[0] === undefined ? {} : { detail: strings.checkPlacesTodo(homeless[0].name) }),
      isDone: homeless.length === 0,
      action: strings.fixIt,
    },
  ];

  const publish = async () => {
    setPublishing(true);
    setRefusal(undefined);
    const refused = await store.publish(slug);
    setPublishing(false);
    if (refused !== undefined) {
      setRefusal(refused.message);
      return;
    }
    onPublished();
    setStage('live');
  };

  return (
    <Modal
      variant="form"
      title={stage === 'live' ? strings.liveTitle : strings.reviewTitle}
      isOpen
      isBusy={isPublishing}
      onOpenChange={(isOpen) => {
        if (!isOpen) onClose();
      }}
      actions={
        stage === 'live' ? (
          <>
            {link === undefined ? null : (
              <ButtonLink href={link} isExternal icon="external-link">
                {strings.openGuest}
              </ButtonLink>
            )}
            <Button variant="primary" slot="close">
              {strings.done}
            </Button>
          </>
        ) : (
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
              {strings.publishNow}
            </Button>
          </>
        )
      }
    >
      {stage === 'live' ? (
        <>
          {strings.liveLine}
          {link === undefined ? null : (
            <>
              <Callout tone="info" actions={<CopyButton value={link} label={strings.copyLink} />}>
                {link}
              </Callout>
              <QrCode value={link} label={strings.qrLabel(place?.name ?? '')} size="md" />
            </>
          )}
        </>
      ) : (
        <>
          {strings.reviewLine}
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
          {refusal === undefined ? null : <Callout tone="danger">{refusal}</Callout>}
        </>
      )}
    </Modal>
  );
}
