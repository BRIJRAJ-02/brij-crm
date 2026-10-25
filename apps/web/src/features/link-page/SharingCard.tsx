// Brief
// Purpose: what happens when the page is shared or looked up (spec 0055), in one place beside Appearance.
// Main task: let the owner say whether search engines may show their page.
// Leaves out: the share card itself, which is drawn on the server and arrives with its own slice.
import { Card, Switch } from '@crm/ui';
import type { DataError } from '@crm/data';
import { strings } from './strings.ts';

/** Props for SharingCard. */
export interface SharingCardProps {
  /** Whether search engines may show the page, as it stands now, a change on its way already shown. */
  readonly indexable: boolean;
  /** A change: shown at once by the caller, then saved. A refusal puts the switch back and says why. */
  readonly onChange: (indexable: boolean) => void;
  /** Why the last change didn't save, said on the card until the next one. */
  readonly refusal?: DataError;
}

/**
 * Sharing and search (spec 0055, AC-5506). One switch today, on for everybody: a page is made to be found, and
 * turning it off is the deliberate choice, not the default. The switch moves the moment it is pressed, as every
 * other setting here does, and the reason for a refusal stays on this card rather than passing in a toast.
 */
export function SharingCard({ indexable, onChange, refusal }: SharingCardProps) {
  return (
    <Card
      title={strings.sharing}
      description={strings.sharingText}
      {...(refusal === undefined ? {} : { footerNote: refusal.message })}
    >
      <Switch
        label={strings.indexable}
        description={strings.indexableText}
        isSelected={indexable}
        onChange={onChange}
      />
    </Card>
  );
}
