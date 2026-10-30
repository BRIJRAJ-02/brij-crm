// Brief
// Purpose: let an owner or admin share one link anyone can join the workspace through (spec 0031, AC-818).
// Main task: turn the link on, copy it, and (folded under Link settings) limit how long and how many; reset or turn it
// off (both ask first).
// The first Card of Members › Joining › Other ways to join, Company email's after it.
// Leaves out: guests (slice 9), email domains (the row after it), and who joined (the Members tab).
import { INVITE_LINK_DAYS, isDataError, type DataLayer, type InviteLinkDays, type InviteLinkView } from '@crm/data';
import { Button, Callout, Disclosure, Field, Select, SettingsRow, Switch, type Toasts } from '@crm/ui';
import { useEffect, useRef, useState } from 'react';
import { UNDO_MS } from '../tasks/undo-delete.ts';
import type { MemberQuestion } from './MemberConfirm.tsx';
import { strings } from './members-strings.ts';
import { savedToast } from './toast.ts';

/** The caps the "Most uses" Select offers, besides none. */
const USE_CAPS = [10, 25, 50, 100] as const;

/** A change to the link, as the data layer takes it. */
type LinkChange = Parameters<DataLayer['invitations']['setLink']>[1];

/** Which control a change came from: it waits for the server meanwhile. */
type Busy = 'enabled' | 'expiry' | 'uses';

/**
 * Whether the link still reads as `settings` left it: on, and the limit that change set unchanged. An Undo acts only
 * then, so it never turns a link back on that was turned off since, or overwrites a newer limit (another admin's too).
 */
export function linkStillReads(link: InviteLinkView, settings: LinkChange): boolean {
  if (!link.enabled) return false;
  if (settings.maxUses !== undefined && (link.maxUses ?? null) !== settings.maxUses) return false;
  if (settings.expiresInDays !== undefined && (settings.expiresInDays === null) !== (link.expiresAt === undefined)) {
    return false;
  }
  return true;
}

/** Props for the invite link's rows. */
export interface InviteLinkRowsProps {
  readonly data: DataLayer;
  readonly slug: string;
  /** The link as the route read it. */
  readonly link: InviteLinkView;
  /** Asks first (the page's confirm), for Reset and turning it off; the page reloads once the server agrees. */
  readonly ask: (question: MemberQuestion & { readonly done: string }) => void;
  /** A change landed: the page reads the link again. */
  readonly onChanged: () => Promise<void>;
  /** The app's toasts: "Invite link saved." (with Undo when the old value can come back), and closing a stale one. */
  readonly toasts: Pick<Toasts, 'toast' | 'dismiss'>;
  /** A change was refused: the page says why in a toast. */
  readonly onFailed: (message: string) => void;
}

/**
 * SettingsRows for a Card the page holds: the switch first (with Reset beside it while on), then, while on, the
 * link to copy (Field's copy variant, whole on its own line), when it stops working and how many it may let in.
 * Every change waits for the server (a setting, not CRM data), the changed control disabled meanwhile, then says
 * "Invite link saved." (the save rule). Expires and Most uses add Undo, for 10 seconds; turning it off and Reset end
 * the current link, so they ask first. Any later change, and leaving the rows, closes an open Undo, and an Undo
 * acts only while the link still reads as its change left it.
 */
export function InviteLinkRows({ data, slug, link, ask, onChanged, toasts, onFailed }: InviteLinkRowsProps) {
  const [busy, setBusy] = useState<Busy | undefined>(undefined);
  // The open "Invite link saved." toast with Undo, if any: the next change closes it, so an old Undo can't act.
  const undoKey = useRef<string | undefined>(undefined);
  // The link as last read, for an Undo pressed later: the route reloads it after every change, any admin's.
  const latest = useRef(link);
  useEffect(() => {
    latest.current = link;
  }, [link]);
  /** Closes the open Undo, if any: a newer change is on its way. */
  const closeUndo = () => {
    if (undoKey.current !== undefined) toasts.dismiss(undoKey.current);
    undoKey.current = undefined;
  };
  // Leaving the rows (another tab, another page) closes the Undo too, since these rows are what guard it.
  useEffect(
    () => () => {
      if (undoKey.current !== undefined) toasts.dismiss(undoKey.current);
    },
    [toasts],
  );
  const failed = (error: unknown) => {
    onFailed(isDataError(error) ? error.message : strings.somethingWrong);
  };
  /** Puts a limit back as it was before the change whose Undo was pressed. */
  const undo = (what: Busy, before: LinkChange) => {
    setBusy(what);
    data.invitations
      .setLink(slug, before)
      .then(onChanged)
      .then(() => {
        toasts.toast(savedToast(strings.undone));
      }, failed)
      .finally(() => {
        setBusy(undefined);
      });
  };
  /** Saves `settings`, then says so; a limit changed offers Undo, which puts `before` back while nothing newer has. */
  const change = (what: Busy, settings: LinkChange, before?: LinkChange) => {
    closeUndo();
    setBusy(what);
    data.invitations
      .setLink(slug, settings)
      .then(onChanged)
      .then(() => {
        if (before === undefined) {
          toasts.toast(savedToast(strings.linkSaved));
          return;
        }
        const key = toasts.toast(
          savedToast(strings.linkSaved, {
            label: strings.undo,
            onUndo: () => {
              if (undoKey.current === key) undoKey.current = undefined;
              if (linkStillReads(latest.current, settings)) undo(what, before);
              else toasts.toast({ tone: 'info', message: strings.undoStale });
            },
          }),
          { timeout: UNDO_MS },
        );
        undoKey.current = key;
      }, failed)
      .finally(() => {
        setBusy(undefined);
      });
  };
  const url = link.token === undefined ? '' : new URL(`/invite/${link.token}`, globalThis.location.origin).href;
  const expiry =
    link.expiresAt === undefined
      ? undefined
      : new Intl.DateTimeFormat(navigator.languages[0] ?? 'en-US', { dateStyle: 'medium', timeStyle: 'short' }).format(
          new Date(link.expiresAt),
        );
  const expiryItems = [
    { id: 'never', label: strings.linkNever },
    ...INVITE_LINK_DAYS.map((days) => ({ id: String(days), label: strings.linkDays(days) })),
    ...(expiry === undefined ? [] : [{ id: 'current', label: strings.linkUntil(expiry) }]),
  ];
  const caps: readonly number[] = USE_CAPS;
  const usesItems = [
    { id: 'none', label: strings.linkNoCap },
    ...USE_CAPS.map((cap) => ({ id: String(cap), label: strings.linkCap(cap) })),
    ...(link.maxUses === undefined || caps.includes(link.maxUses)
      ? []
      : [{ id: String(link.maxUses), label: strings.linkCap(link.maxUses) }]),
  ];
  return (
    <>
      {/* One quiet line: what the link does while it is off, then (on) how many joined with it, under the link. */}
      <SettingsRow title={strings.linkTitle} {...(link.enabled ? {} : { description: strings.linkDescription })}>
        {link.enabled && (
          <Button
            icon="refresh-cw"
            isDisabled={busy !== undefined}
            onPress={() => {
              ask({
                title: strings.linkResetTitle,
                text: strings.linkResetText,
                action: strings.linkResetAction,
                run: () => {
                  closeUndo();
                  return data.invitations.setLink(slug, { enabled: true, reset: true }).then(() => undefined);
                },
                done: strings.linkWasReset,
              });
            }}
          >
            {strings.linkReset}
          </Button>
        )}
        <Switch
          label={strings.linkTitle}
          isLabelHidden
          isSelected={link.enabled}
          isDisabled={busy !== undefined}
          onChange={(isOn) => {
            if (isOn) {
              change('enabled', { enabled: true });
              return;
            }
            ask({
              title: strings.linkOffTitle,
              text: strings.linkOffText,
              action: strings.linkOffAction,
              run: () => {
                closeUndo();
                return data.invitations.setLink(slug, { enabled: false }).then(() => undefined);
              },
              done: strings.linkTurnedOff,
            });
          }}
        />
      </SettingsRow>
      {link.enabled && (
        <>
          {link.isSpent && <Callout tone="warning">{strings.linkSpent}</Callout>}
          <Field
            variant="copy"
            label={strings.linkField}
            value={url}
            copyLabel={strings.linkCopy}
            hint={strings.linkUses(link.uses)}
          />
          {/* The limits most links never need, folded (the owner, 30 October 2026: fewer choices). */}
          <Disclosure title={strings.linkSettings} variant="quiet">
            <SettingsRow title={strings.linkExpires}>
              <Select
                label={strings.linkExpires}
                isLabelHidden
                size="sm"
                items={expiryItems}
                value={expiry === undefined ? 'never' : 'current'}
                isDisabled={busy !== undefined}
                onChange={(id) => {
                  if (id === null || id === 'current') return;
                  change(
                    'expiry',
                    { enabled: true, expiresInDays: id === 'never' ? null : (Number(id) as InviteLinkDays) },
                    // An expiry counts from now, so only Never comes back exactly; a date already set can't.
                    expiry === undefined ? { enabled: true, expiresInDays: null } : undefined,
                  );
                }}
              />
            </SettingsRow>
            <SettingsRow title={strings.linkMostUses}>
              <Select
                label={strings.linkMostUses}
                isLabelHidden
                size="sm"
                items={usesItems}
                value={link.maxUses === undefined ? 'none' : String(link.maxUses)}
                isDisabled={busy !== undefined}
                onChange={(id) => {
                  if (id === null) return;
                  change(
                    'uses',
                    { enabled: true, maxUses: id === 'none' ? null : Number(id) },
                    { enabled: true, maxUses: link.maxUses ?? null },
                  );
                }}
              />
            </SettingsRow>
          </Disclosure>
        </>
      )}
    </>
  );
}
