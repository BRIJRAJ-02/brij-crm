// Brief
// Purpose: let an owner or admin let people at their own company's email domain ask to join (spec 0031, AC-819).
// Main task: switch it on or off; each request then waits on the Join requests tab.
// Leaves out: other domains (only the admin's own verified one may go on), and answering requests (the tab).
import { isDataError, type DataLayer, type WorkspaceDomainsView } from '@crm/data';
import { Card, SettingsRow, Switch } from '@crm/ui';
import { useState } from 'react';
import { strings } from './members-strings.ts';

/** Props for the email domain card. */
export interface EmailDomainCardProps {
  readonly data: DataLayer;
  readonly slug: string;
  /** The domains as the route read them, with the one the reader may turn on. */
  readonly domains: WorkspaceDomainsView;
  /** A change landed: the page reads the domains again. */
  readonly onChanged: () => Promise<void>;
  /** A change was refused: the page says why in a toast. */
  readonly onFailed: (message: string) => void;
}

/**
 * One SettingsRow: the reader's own domain and a switch. Its one quiet line
 * says what it does, or why it can't be turned on (a public or unverified
 * address). Waits for the server, the switch disabled meanwhile.
 */
export function EmailDomainCard({ data, slug, domains, onChanged, onFailed }: EmailDomainCardProps) {
  const [isBusy, setBusy] = useState(false);
  const mine = domains.yourDomain;
  const isOn = mine !== undefined && domains.domains.includes(mine);
  const set = (next: readonly string[]) => {
    setBusy(true);
    data.joinRequests
      .setDomains(slug, next)
      .then(onChanged)
      .catch((error: unknown) => {
        onFailed(isDataError(error) ? error.message : strings.somethingWrong);
      })
      .finally(() => {
        setBusy(false);
      });
  };
  const description =
    mine === undefined
      ? domains.isPublic
        ? strings.domainPublic
        : strings.domainUnverified
      : isOn
        ? strings.domainOn(mine)
        : strings.domainOff(mine);
  return (
    <Card>
      <SettingsRow title={strings.domainTitle} description={description}>
        <Switch
          label={strings.domainTitle}
          isLabelHidden
          isSelected={isOn}
          isDisabled={isBusy || mine === undefined}
          onChange={(on) => {
            if (mine === undefined) return;
            set(on ? [...domains.domains, mine] : domains.domains.filter((domain) => domain !== mine));
          }}
        />
      </SettingsRow>
    </Card>
  );
}
