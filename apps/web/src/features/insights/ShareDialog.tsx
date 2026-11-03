// Brief
// Purpose: share the numbers on screen with a client or partner (spec 0067, AC-6720): a signed link, numbers only,
//   with an optional expiry, and the links already made, each revocable.
// Main task: make a link and copy it.
// Leaves out: who the visitors were, ever (a shared page never shows a session, name, email, Other's sites or a
//   free text answer), editing a link after it is made (revoke and make another), and sending it from here.
import type { DataLayer, InsightPages, InsightRange, InsightShare } from '@crm/data';
import { useInsightRead } from '@crm/data/react';
import {
  Button,
  Callout,
  DescriptionList,
  EmptyState,
  Field,
  Modal,
  SegmentedControl,
  Table,
  useFormatSettings,
} from '@crm/ui';
import { useRouteContext } from '@tanstack/react-router';
import { useMemo, useState } from 'react';
import { strings } from './strings.ts';

/** Props for the share dialog. */
export interface ShareDialogProps {
  readonly data: DataLayer;
  readonly slug: string;
  readonly pages: InsightPages;
  readonly range: InsightRange;
  readonly onClose: () => void;
}

/** When a new link stops working, from now. */
type Expiry = 'never' | 'week' | 'month';

/** A refusal's sentence: the data layer's message, else the screen's own. */
function messageOf(refused: unknown): string {
  return typeof refused === 'object' && refused !== null && 'message' in refused && typeof refused.message === 'string'
    ? refused.message
    : strings.failedTitle;
}

/** The address a share token opens: on the app's own origin, outside any workspace. */
export const sharedHref = (token: string) => `${globalThis.location.origin}/public/insights#t=${token}`;

/** The share dialog: make a link (shown once, to copy), and the links already made. */
export function ShareDialog({ data, slug, pages, range, onClose }: ShareDialogProps) {
  const { toasts } = useRouteContext({ from: '__root__' });
  const { locale, timeZone } = useFormatSettings();
  const list = useMemo(() => data.insights.shares(slug), [data, slug]);
  const shares = useInsightRead(list);
  const [label, setLabel] = useState('');
  const [expiry, setExpiry] = useState<Expiry>('month');
  const [isMaking, setMaking] = useState(false);
  const [made, setMade] = useState<string | undefined>(undefined);
  const [error, setError] = useState<string | undefined>(undefined);
  const [revoking, setRevoking] = useState<InsightShare | undefined>(undefined);
  const day = useMemo(() => new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeZone }), [locale, timeZone]);

  const make = () => {
    if (label.trim() === '') {
      setError(strings.shareNamePlaceholder);
      return;
    }
    setMaking(true);
    setError(undefined);
    const days = expiry === 'week' ? 7 : expiry === 'month' ? 30 : undefined;
    void data.insights
      .createShare(slug, {
        label: label.trim(),
        pages,
        range,
        ...(days === undefined ? {} : { expiresAt: new Date(Date.now() + days * 86_400_000).toISOString() }),
      })
      .then(
        (answer) => {
          setMade(sharedHref(answer.token));
          setLabel('');
        },
        (refused: unknown) => {
          setError(messageOf(refused));
        },
      )
      .finally(() => setMaking(false));
  };

  const copy = (href: string) => {
    navigator.clipboard.writeText(href).then(
      () => toasts.toast({ tone: 'success', message: strings.shareCopied }),
      () => toasts.toast({ tone: 'danger', message: strings.shareCopyFailed }),
    );
  };

  return (
    <>
      <Modal
        title={strings.shareTitle}
        hint={strings.shareHint}
        isOpen={revoking === undefined}
        isBusy={isMaking}
        onOpenChange={(isOpen) => {
          if (!isOpen && !isMaking) onClose();
        }}
        actions={
          <>
            <Button slot="close">{strings.done}</Button>
            {made === undefined && (
              <Button variant="primary" isPending={isMaking} onPress={make}>
                {strings.shareCreate}
              </Button>
            )}
          </>
        }
      >
        {made === undefined ? (
          <>
            <Field
              label={strings.shareName}
              placeholder={strings.shareNamePlaceholder}
              value={label}
              maxLength={80}
              onChange={setLabel}
              {...(error === undefined ? {} : { error })}
            />
            <SegmentedControl
              label={strings.shareExpiry}
              value={expiry}
              onChange={(next) => {
                if (next === 'never' || next === 'week' || next === 'month') setExpiry(next);
              }}
              segments={[
                { value: 'week', label: strings.expiryWeek },
                { value: 'month', label: strings.expiryMonth },
                { value: 'never', label: strings.expiryNever },
              ]}
            />
          </>
        ) : (
          <Callout
            tone="success"
            title={strings.shareCreated}
            actions={
              <Button icon="copy" onPress={() => copy(made)}>
                {strings.shareCopy}
              </Button>
            }
          >
            <DescriptionList
              items={[
                { term: strings.shareLinkLabel, description: made, copy: { value: made, label: strings.shareCopy } },
              ]}
            />
          </Callout>
        )}
        {shares.status === 'ready' && shares.shares.length > 0 ? (
          <Table
            label={strings.shareLinks}
            columns={[
              { id: 'label', label: strings.shareName, isRowHeader: true },
              { id: 'state', label: strings.shareExpiry },
              { id: 'revoke', label: strings.shareRevoke, isLabelHidden: true, align: 'end', size: 'fit' },
            ]}
            rows={shares.shares}
            getRowId={(row) => row.id}
            renderCell={(row, column) => {
              if (column === 'label') return `${row.label} · ${strings.shareCovers(row.pageCount)}`;
              if (column === 'state') {
                if (row.revokedAt !== undefined) return strings.shareRevoked;
                return row.expiresAt === undefined
                  ? strings.expiryNever
                  : strings.shareExpires(day.format(new Date(row.expiresAt)));
              }
              return row.revokedAt === undefined && row.isMine ? (
                <Button variant="ghost-danger" onPress={() => setRevoking(row)}>
                  {strings.shareRevoke}
                </Button>
              ) : null;
            }}
          />
        ) : shares.status === 'error' ? (
          <EmptyState tone="error" layout="row" title={shares.message} onRetry={() => list.reload()} />
        ) : null}
      </Modal>
      <Modal
        title={revoking === undefined ? '' : strings.shareRevokeTitle(revoking.label)}
        variant="confirm"
        tone="danger"
        isOpen={revoking !== undefined}
        onOpenChange={(isOpen) => {
          if (!isOpen) setRevoking(undefined);
        }}
        actions={
          <>
            <Button slot="close">{strings.cancel}</Button>
            <Button
              variant="danger-solid"
              onPress={() => {
                const target = revoking;
                setRevoking(undefined);
                if (target === undefined) return;
                void data.insights.revokeShare(slug, target.id).catch((refused: unknown) => {
                  toasts.toast({
                    tone: 'danger',
                    message: messageOf(refused),
                  });
                });
              }}
            >
              {strings.shareRevoke}
            </Button>
          </>
        }
      >
        {strings.shareRevokeText}
      </Modal>
    </>
  );
}
