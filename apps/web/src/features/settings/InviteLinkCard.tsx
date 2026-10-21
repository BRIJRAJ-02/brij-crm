// Brief
// Purpose: let an owner or admin share one link anyone can join the workspace through (spec 0031, AC-818).
// Main task: turn the link on, copy it, and limit how long and how many; reset or turn it off (both ask first).
// Leaves out: guests (slice 9), email domains (the card after it), and who joined (the Members tab).
import { INVITE_LINK_DAYS, isDataError, type DataLayer, type InviteLinkDays, type InviteLinkView } from '@crm/data';
import { Button, Callout, Card, Field, Select, SettingsRow, Switch } from '@crm/ui';
import { useState } from 'react';
import type { MemberQuestion } from './MemberConfirm.tsx';
import { strings } from './members-strings.ts';

/** The caps the "Most uses" Select offers, besides none. */
const USE_CAPS = [10, 25, 50, 100] as const;

/** Props for the invite link card. */
export interface InviteLinkCardProps {
  readonly data: DataLayer;
  readonly slug: string;
  /** The link as the route read it. */
  readonly link: InviteLinkView;
  /** Asks first (the page's confirm), for Reset and turning it off; the page reloads once the server agrees. */
  readonly ask: (question: MemberQuestion & { readonly done: string }) => void;
  /** A change landed: the page reads the link again. */
  readonly onChanged: () => Promise<void>;
  /** A change was refused: the page says why in a toast. */
  readonly onFailed: (message: string) => void;
}

/**
 * A Card of SettingsRows: the switch first, then, while on, the link to copy
 * (Field's copy variant, whole on its own line), when it stops working and
 * how many it may let in. Every change waits for the server (a setting, not
 * CRM data), the changed control disabled meanwhile; turning it off and
 * Reset end the current link, so they ask first.
 */
export function InviteLinkCard({ data, slug, link, ask, onChanged, onFailed }: InviteLinkCardProps) {
  const [busy, setBusy] = useState<'enabled' | 'expiry' | 'uses' | undefined>(undefined);
  const change = (
    what: 'enabled' | 'expiry' | 'uses',
    settings: Parameters<DataLayer['invitations']['setLink']>[1],
  ) => {
    setBusy(what);
    data.invitations
      .setLink(slug, settings)
      .then(onChanged)
      .catch((error: unknown) => {
        onFailed(isDataError(error) ? error.message : strings.somethingWrong);
      })
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
    <Card
      title={strings.linkTitle}
      {...(link.enabled
        ? {
            actions: (
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
            ),
          }
        : {})}
    >
      <SettingsRow title={strings.linkTitle} description={strings.linkDescription}>
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
          <SettingsRow title={strings.linkExpires} description={strings.linkExpiresHint}>
            <Select
              label={strings.linkExpires}
              isLabelHidden
              size="sm"
              items={expiryItems}
              value={expiry === undefined ? 'never' : 'current'}
              isDisabled={busy !== undefined}
              onChange={(id) => {
                if (id === null || id === 'current') return;
                change('expiry', {
                  enabled: true,
                  expiresInDays: id === 'never' ? null : (Number(id) as InviteLinkDays),
                });
              }}
            />
          </SettingsRow>
          <SettingsRow title={strings.linkMostUses} description={strings.linkMostUsesHint}>
            <Select
              label={strings.linkMostUses}
              isLabelHidden
              size="sm"
              items={usesItems}
              value={link.maxUses === undefined ? 'none' : String(link.maxUses)}
              isDisabled={busy !== undefined}
              onChange={(id) => {
                if (id === null) return;
                change('uses', { enabled: true, maxUses: id === 'none' ? null : Number(id) });
              }}
            />
          </SettingsRow>
        </>
      )}
    </Card>
  );
}
