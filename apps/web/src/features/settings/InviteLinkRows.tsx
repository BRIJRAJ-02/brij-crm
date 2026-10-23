// Brief
// Purpose: let an owner or admin share one link anyone can join the workspace through (spec 0031, AC-818).
// Main task: turn the link on, copy it, and limit how long and how many; reset or turn it off (both ask first).
// The first rows of Members › Joining › Other ways to join, its Card shared with Company email after it.
// Leaves out: guests (slice 9), email domains (the row after it), and who joined (the Members tab).
import {
  INVITE_LINK_DAYS,
  isDataError,
  type DataLayer,
  type InviteLinkDays,
  type InviteLinkView,
  type Notice,
} from '@crm/data';
import { Button, Callout, Field, InfoTip, Select, SettingsRow, Switch } from '@crm/ui';
import { useRef, useState } from 'react';
import type { MemberQuestion } from './MemberConfirm.tsx';
import { strings } from './members-strings.ts';
import { savedToast } from './toast.ts';

/** The caps the "Most uses" Select offers, besides none. */
const USE_CAPS = [10, 25, 50, 100] as const;

/** A change to the link, as the data layer takes it. */
type LinkChange = Parameters<DataLayer['invitations']['setLink']>[1];

/** Which control a change came from: it waits for the server meanwhile. */
type Busy = 'enabled' | 'expiry' | 'uses';

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
  /** Expires or Most uses saved: the page says so in a toast, with Undo when it can put the old value back. */
  readonly onSaved: (notice: Notice) => void;
  /** A change was refused: the page says why in a toast. */
  readonly onFailed: (message: string) => void;
}

/**
 * SettingsRows for a Card the page holds: the switch first (with Reset beside it while on), then, while on, the
 * link to copy (Field's copy variant, whole on its own line), when it stops working and how many it may let in.
 * Every change waits for the server (a setting, not CRM data), the changed control disabled meanwhile. Expires and
 * Most uses then say "Invite link saved." with Undo (the save rule); turning it off and Reset end the current
 * link, so they ask first.
 */
export function InviteLinkRows({ data, slug, link, ask, onChanged, onSaved, onFailed }: InviteLinkRowsProps) {
  const [busy, setBusy] = useState<Busy | undefined>(undefined);
  // Each change's turn: an Undo puts its value back only while no later change has landed since.
  const turn = useRef(0);
  const failed = (error: unknown) => {
    onFailed(isDataError(error) ? error.message : strings.somethingWrong);
  };
  /** Puts a limit back as it was before the change whose Undo was pressed. */
  const undo = (what: Busy, before: LinkChange) => {
    setBusy(what);
    turn.current += 1;
    data.invitations
      .setLink(slug, before)
      .then(onChanged)
      .then(() => {
        onSaved(savedToast(strings.undone));
      }, failed)
      .finally(() => {
        setBusy(undefined);
      });
  };
  /** Saves `settings`; a limit changed then says so, with Undo putting `before` back while it is still the latest. */
  const change = (what: Busy, settings: LinkChange, before?: LinkChange) => {
    setBusy(what);
    turn.current += 1;
    const mine = turn.current;
    data.invitations
      .setLink(slug, settings)
      .then(onChanged)
      .then(() => {
        if (what === 'enabled') return;
        onSaved(
          savedToast(
            strings.linkSaved,
            before === undefined
              ? undefined
              : {
                  label: strings.undo,
                  onUndo: () => {
                    if (turn.current === mine) undo(what, before);
                  },
                },
          ),
        );
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
                run: () => data.invitations.setLink(slug, { enabled: true, reset: true }).then(() => undefined),
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
              run: () => data.invitations.setLink(slug, { enabled: false }).then(() => undefined),
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
          <SettingsRow
            title={strings.linkMostUses}
            meta={<InfoTip label={strings.linkMostUses}>{strings.linkMostUsesInfo}</InfoTip>}
          >
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
        </>
      )}
    </>
  );
}
