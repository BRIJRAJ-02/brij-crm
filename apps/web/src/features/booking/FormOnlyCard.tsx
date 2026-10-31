// Brief
// Purpose: a team page's Only through a form (spec 0037, AC-1388), under its Routing card: on, the page books only when a form sends the visitor here.
// Main task: turn it on or off; it saves at once, as the Hosts card's switches do, and a refusal puts it back.
// Leaves out: which forms send here (their own Settings) and the rules themselves (the Routing card above).
import { isDataError, type BookingPageView, type DataLayer } from '@crm/data';
import { Callout, Card, Switch } from '@crm/ui';
import { useState } from 'react';
import { strings } from '../routing/strings.ts';

/** Props for the card. */
export interface FormOnlyCardProps {
  readonly data: DataLayer;
  readonly slug: string;
  readonly page: BookingPageView;
  readonly isLocked: boolean;
  /** Saved: the page as the server now has it. */
  readonly onSaved: (page: BookingPageView) => void;
}

/** Only through a form: one switch, saved at once. */
export function FormOnlyCard({ data, slug, page, isLocked, onSaved }: FormOnlyCardProps) {
  const [isSaving, setSaving] = useState(false);
  const [shown, setShown] = useState<boolean | undefined>(undefined);
  const [failure, setFailure] = useState<string | undefined>(undefined);
  const isOn = shown ?? page.formOnly;
  return (
    <Card>
      {failure !== undefined && (
        <Callout tone="danger" isAnnounced>
          {failure}
        </Callout>
      )}
      <Switch
        label={strings.formOnly}
        isSelected={isOn}
        isReadOnly={isLocked}
        isDisabled={isSaving}
        onChange={(next) => {
          setShown(next);
          setSaving(true);
          setFailure(undefined);
          data.bookingPages.update(slug, page.id, { formOnly: next }).then(
            (saved) => {
              setSaving(false);
              setShown(undefined);
              onSaved(saved);
            },
            (error: unknown) => {
              setSaving(false);
              setShown(undefined);
              setFailure(isDataError(error) ? error.message : strings.formOnlyFailed);
            },
          );
        }}
      />
    </Card>
  );
}
