// Brief
// Purpose: let an owner or admin let people at their own company's email domain ask to join (spec 0031, AC-819).
// Main task: switch it on or off; each request then waits on the Join requests tab.
// Leaves out: other domains (only the admin's own verified one may go on), and answering requests (the tab).
import { isDataError, type DataLayer, type WorkspaceDomainsView } from '@crm/data';
import { Card, SettingsRow, Switch } from '@crm/ui';
import { useState } from 'react';
import type { MemberQuestion } from './MemberConfirm.tsx';
import { strings } from './members-strings.ts';

/** Props for the email domain card. */
export interface EmailDomainCardProps {
  readonly data: DataLayer;
  readonly slug: string;
  /** The domains as the route read them, with the one the reader may turn on. */
  readonly domains: WorkspaceDomainsView;
  /** Asks first in the page's confirm: turning the domain off is an ending action. */
  readonly ask: (question: MemberQuestion & { readonly done: string }) => void;
  /** A change landed: the page reads the domains again. */
  readonly onChanged: () => Promise<void>;
  /** The domain was turned on: the page says so in a toast, as it does for turning it off. */
  readonly onTurnedOn: (message: string) => void;
  /** A change was refused: the page says why in a toast. */
  readonly onFailed: (message: string) => void;
}

/**
 * One SettingsRow: the reader's own domain and a switch. Its one quiet line
 * says what it does, or why it can't be turned on (a public or unverified
 * address). Waits for the server: meanwhile the switch stands where it is
 * going, disabled, the line says so and the card is busy. Turning it off asks
 * first (the confirm shows its own wait), since it closes the open requests
 * from that domain.
 */
export function EmailDomainCard({ data, slug, domains, ask, onChanged, onTurnedOn, onFailed }: EmailDomainCardProps) {
  const [isBusy, setBusy] = useState(false);
  const mine = domains.yourDomain;
  const isOn = mine !== undefined && domains.domains.includes(mine);
  const turnOn = (domain: string) => {
    setBusy(true);
    data.joinRequests
      .setDomains(slug, [...domains.domains, domain])
      .then(onChanged)
      .then(() => {
        onTurnedOn(strings.domainTurnedOn(domain));
      })
      .catch((error: unknown) => {
        onFailed(isDataError(error) ? error.message : strings.somethingWrong);
      })
      .finally(() => {
        setBusy(false);
      });
  };
  const description =
    isBusy && mine !== undefined
      ? strings.domainSaving(mine)
      : mine === undefined
        ? domains.isPublic
          ? strings.domainPublic
          : strings.domainUnverified
        : isOn
          ? strings.domainOn(mine)
          : strings.domainOff(mine);
  return (
    <Card isBusy={isBusy}>
      <SettingsRow title={strings.domainTitle} description={description}>
        <Switch
          label={strings.domainTitle}
          isLabelHidden
          isSelected={isOn || isBusy}
          isDisabled={isBusy || mine === undefined}
          onChange={(on) => {
            if (mine === undefined) return;
            if (on) {
              turnOn(mine);
              return;
            }
            ask({
              title: strings.domainOffTitle,
              text: strings.domainOffText(mine),
              action: strings.domainOffAction,
              run: () =>
                data.joinRequests
                  .setDomains(
                    slug,
                    domains.domains.filter((domain) => domain !== mine),
                  )
                  .then(() => undefined),
              done: strings.domainTurnedOff,
            });
          }}
        />
      </SettingsRow>
    </Card>
  );
}
