// Brief
// Purpose: a booking page's one-time links (spec 0062, AC-6204): addresses that book the page a set number of times, then stop.
// Main task: make one (a label, how many bookings, when it expires), copy it once, and revoke one that should stop now.
// Leaves out: who booked through each link (Bookings shows the bookings) and editing a link (make a new one instead).
import { isDataError, type BookingPageView, type DataLayer, type OneOffLinkView } from '@crm/data';
import {
  Button,
  Callout,
  Card,
  EmptyState,
  Field,
  Menu,
  MenuItem,
  MenuTrigger,
  Modal,
  Select,
  Switch,
  Table,
  useFormatSettings,
  type SelectItem,
  type TableColumn,
} from '@crm/ui';
import { useCallback, useEffect, useState } from 'react';
import { strings } from './strings.ts';

// The same shape as the Requests card's table above it, so the two read as one family: a filling first column, the
// facts, and an actions column fitted to its button.
const COLUMNS: readonly TableColumn[] = [
  { id: 'label', label: strings.linkLabel, isRowHeader: true, size: 'fill' },
  { id: 'left', label: strings.linkUses, size: 'fit' },
  { id: 'expires', label: strings.linkExpires, size: 'fit' },
  { id: 'actions', label: strings.revoke, isLabelHidden: true, align: 'end', isInline: true, size: 'fit' },
];

const USES: SelectItem[] = [1, 2, 3, 5, 10, 25, 50].map((value) => ({ id: String(value), label: String(value) }));
const EXPIRIES: SelectItem[] = [
  { id: 'never', label: strings.linkNever },
  ...[1, 7, 30, 90, 365].map((value) => ({ id: String(value), label: strings.days(value) })),
];

/** Props for the card. */
export interface OneOffLinksCardProps {
  readonly data: DataLayer;
  readonly slug: string;
  readonly page: BookingPageView;
  /** The page's own `/b/<key>` address, which a link's token rides on after `#o=`. */
  readonly pageUrl: string;
  readonly isReadOnly: boolean;
  /** Books only through these links saved: the page as the server now has it. */
  readonly onSaved: (page: BookingPageView) => void;
}

type Loaded =
  | { readonly status: 'loading' }
  | { readonly status: 'error' }
  | { readonly status: 'ready'; readonly links: readonly OneOffLinkView[] };

/** The card: the page's links, newest first, and New link. */
export function OneOffLinksCard({ data, slug, page, pageUrl, isReadOnly, onSaved }: OneOffLinksCardProps) {
  const pageId = page.id;
  const { locale, timeZone } = useFormatSettings();
  const [loaded, setLoaded] = useState<Loaded>({ status: 'loading' });
  const [isMaking, setMaking] = useState(false);
  const [revoking, setRevoking] = useState<OneOffLinkView | undefined>(undefined);
  const [failure, setFailure] = useState<string | undefined>(undefined);
  // Books only through these links (AC-6204): guest facing, so it goes into the page's draft and waits for Publish
  // (spec 0068, AC-6810), shown at once and put back if refused.
  const [linksOnly, setLinksOnly] = useState<boolean | undefined>(undefined);
  const [isSaving, setSaving] = useState(false);
  const saveLinksOnly = (next: boolean) => {
    setLinksOnly(next);
    setSaving(true);
    setFailure(undefined);
    data.bookingPages.saveDraft(slug, pageId, { linksOnly: next }).then(
      (saved) => {
        setSaving(false);
        setLinksOnly(undefined);
        onSaved(saved);
      },
      (error: unknown) => {
        setSaving(false);
        setLinksOnly(undefined);
        setFailure(isDataError(error) ? error.message : strings.linkFailed);
      },
    );
  };
  const read = useCallback(() => {
    data.bookingFlow.links(slug, pageId).then(
      (links) => setLoaded({ status: 'ready', links }),
      () => setLoaded({ status: 'error' }),
    );
  }, [data, slug, pageId]);
  useEffect(() => read(), [read]);
  const day = (iso: string) =>
    new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short', year: 'numeric', timeZone }).format(
      new Date(iso),
    );
  const leftOf = (link: OneOffLinkView) =>
    link.state === 'open'
      ? strings.linkUsesLeft(link.maxUses - link.uses, link.maxUses)
      : strings.linkStates[link.state];
  return (
    <Card
      title={strings.oneOffLinks}
      description={strings.oneOffLinksLine}
      {...(failure === undefined ? {} : { footerNote: failure })}
      {...(isReadOnly
        ? {}
        : {
            actions: (
              <Button icon="plus" size="sm" onPress={() => setMaking(true)}>
                {strings.newLink}
              </Button>
            ),
          })}
    >
      <Switch
        label={strings.linksOnly}
        description={strings.linksOnlyHint}
        isSelected={linksOnly ?? page.linksOnly}
        isReadOnly={isReadOnly}
        isDisabled={isSaving}
        onChange={saveLinksOnly}
      />
      {loaded.status === 'loading' && <EmptyState layout="row" isLoading title={strings.oneOffLinks} />}
      {loaded.status === 'error' && <EmptyState layout="row" tone="error" title={strings.linksFailed} onRetry={read} />}
      {loaded.status === 'ready' &&
        (loaded.links.length === 0 ? (
          <EmptyState layout="row" icon="link" title={strings.noLinks} />
        ) : (
          <Table
            label={strings.oneOffLinks}
            columns={isReadOnly ? COLUMNS.filter((column) => column.id !== 'actions') : COLUMNS}
            rows={loaded.links}
            isHeaderHidden
            getRowId={(link) => link.id}
            renderCell={(link, column) =>
              column === 'label' ? (
                (link.label ?? strings.linkUntitled)
              ) : column === 'left' ? (
                leftOf(link)
              ) : column === 'expires' ? (
                link.expiresAt === undefined ? (
                  strings.linkNever
                ) : (
                  day(link.expiresAt)
                )
              ) : link.state === 'open' ? (
                <MenuTrigger>
                  <Button variant="ghost" icon="ellipsis" label={strings.revoke} />
                  <Menu label={strings.revoke} onAction={() => setRevoking(link)}>
                    <MenuItem id="revoke" icon="unlink" isDanger>
                      {strings.revoke}
                    </MenuItem>
                  </Menu>
                </MenuTrigger>
              ) : null
            }
          />
        ))}
      <MakeLink
        data={data}
        slug={slug}
        pageId={pageId}
        pageUrl={pageUrl}
        isOpen={isMaking}
        onClose={() => setMaking(false)}
        onMade={read}
      />
      <RevokeLink
        link={revoking}
        onClose={() => setRevoking(undefined)}
        onRevoke={(link) =>
          data.bookingFlow.revokeLink(slug, pageId, link.id).then(
            () => {
              setRevoking(undefined);
              read();
            },
            (error: unknown) => {
              setRevoking(undefined);
              setFailure(isDataError(error) ? error.message : strings.linkFailed);
            },
          )
        }
      />
    </Card>
  );
}

/** New link: its label, how many bookings and when it expires; once made, the address to copy, shown once. */
function MakeLink({
  data,
  slug,
  pageId,
  pageUrl,
  isOpen,
  onClose,
  onMade,
}: {
  readonly data: DataLayer;
  readonly slug: string;
  readonly pageId: string;
  readonly pageUrl: string;
  readonly isOpen: boolean;
  readonly onClose: () => void;
  readonly onMade: () => void;
}) {
  const [label, setLabel] = useState('');
  const [uses, setUses] = useState('1');
  const [expires, setExpires] = useState('never');
  const [isBusy, setBusy] = useState(false);
  const [made, setMade] = useState<string | undefined>(undefined);
  const [failure, setFailure] = useState<string | undefined>(undefined);
  const close = () => {
    onClose();
    setLabel('');
    setUses('1');
    setExpires('never');
    setMade(undefined);
    setFailure(undefined);
  };
  const make = () => {
    if (isBusy) return;
    setBusy(true);
    setFailure(undefined);
    const trimmed = label.trim();
    data.bookingFlow
      .createLink(slug, {
        pageId,
        maxUses: Number(uses),
        ...(trimmed === '' ? {} : { label: trimmed }),
        ...(expires === 'never'
          ? {}
          : { expiresAt: new Date(Date.now() + Number(expires) * 86_400_000).toISOString() }),
      })
      .then(
        (answer) => {
          setBusy(false);
          setMade(`${pageUrl}#o=${answer.token}`);
          onMade();
        },
        (error: unknown) => {
          setBusy(false);
          setFailure(isDataError(error) ? error.message : strings.linkFailed);
        },
      );
  };
  return (
    <Modal
      title={strings.newLink}
      isOpen={isOpen}
      isBusy={isBusy}
      onOpenChange={(open) => {
        if (!open && !isBusy) close();
      }}
      {...(made === undefined ? {} : { hint: strings.linkMade })}
      actions={
        made === undefined ? (
          <>
            <Button slot="close" kbd="ESC" isDisabled={isBusy}>
              {strings.cancel}
            </Button>
            <Button variant="primary" isPending={isBusy} onPress={make}>
              {strings.makeLink}
            </Button>
          </>
        ) : (
          <Button slot="close" variant="primary">
            {strings.done}
          </Button>
        )
      }
    >
      {made === undefined ? (
        <>
          {failure !== undefined && (
            <Callout tone="danger" isAnnounced>
              {failure}
            </Callout>
          )}
          <Field
            label={strings.linkLabel}
            placeholder={strings.linkLabelPlaceholder}
            maxLength={60}
            value={label}
            onChange={setLabel}
          />
          <Select label={strings.linkUses} items={USES} value={uses} onChange={(id) => setUses(id ?? '1')} />
          <Select
            label={strings.linkExpires}
            items={EXPIRIES}
            value={expires}
            onChange={(id) => setExpires(id ?? 'never')}
          />
        </>
      ) : (
        <Field label={strings.oneOffLinks} variant="copy" copyLabel={strings.copyLink} value={made} />
      )}
    </Modal>
  );
}

/** "Revoke this link?": a danger Modal, Cancel then Revoke (the owner's confirm rule). */
function RevokeLink({
  link,
  onClose,
  onRevoke,
}: {
  readonly link: OneOffLinkView | undefined;
  readonly onClose: () => void;
  readonly onRevoke: (link: OneOffLinkView) => Promise<void>;
}) {
  const [isBusy, setBusy] = useState(false);
  const [last, setLast] = useState(link);
  if (link !== undefined && link !== last) setLast(link);
  const shown = link ?? last;
  if (shown === undefined) return null;
  return (
    <Modal
      title={strings.revokeTitle}
      tone="danger"
      isOpen={link !== undefined}
      isBusy={isBusy}
      onOpenChange={(open) => {
        if (!open && !isBusy) onClose();
      }}
      actions={
        <>
          <Button slot="close" kbd="ESC" isDisabled={isBusy}>
            {strings.cancel}
          </Button>
          <Button
            variant="danger-solid"
            icon="unlink"
            isPending={isBusy}
            onPress={() => {
              if (isBusy) return;
              setBusy(true);
              void onRevoke(shown).finally(() => setBusy(false));
            }}
          >
            {strings.revoke}
          </Button>
        </>
      }
    >
      {strings.revokeBody}
    </Modal>
  );
}
