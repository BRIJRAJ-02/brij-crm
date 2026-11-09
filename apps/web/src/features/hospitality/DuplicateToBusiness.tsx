// Brief
// Purpose: copy a menu or a service to another business (spec 0065 H7, AC-6591).
// Main task: pick the business, see at once when its currency differs (the copy keeps its numbers), and copy.
// Leaves out: converting prices (nothing ever does), moving the original, and anything while there is one business.
import type { DataError, PropertySummary } from '@crm/data';
import { Button, Callout, Modal, Radio, RadioGroup, type Toasts } from '@crm/ui';
import { useState } from 'react';
import { strings } from './strings.ts';

/** Props for DuplicateToBusiness. */
export interface DuplicateToBusinessProps {
  readonly isOpen: boolean;
  readonly onOpenChange: (isOpen: boolean) => void;
  /** The menu's or the service's name, for the title and the toast. */
  readonly name: string;
  /** Every business but the one shown, in order. */
  readonly others: readonly PropertySummary[];
  /** The shown business's currency, to compare with the one picked. */
  readonly currency: string | undefined;
  readonly onDuplicate: (to: string) => Promise<DataError | undefined>;
  readonly toasts: Toasts;
}

/**
 * Duplicate to: the other businesses as choices, a warning while the one picked prices in another currency, and
 * Duplicate. The dialog stays open on a refusal, saying why; done, it closes and a toast says where the copy went.
 */
export function DuplicateToBusiness({
  isOpen,
  onOpenChange,
  name,
  others,
  currency,
  onDuplicate,
  toasts,
}: DuplicateToBusinessProps) {
  const [to, setTo] = useState<string | undefined>(others.length === 1 ? others[0]?.id : undefined);
  const [isBusy, setBusy] = useState(false);
  const [refusal, setRefusal] = useState<string | undefined>();
  const picked = others.find((each) => each.id === to);
  const differs = picked !== undefined && (picked.currency ?? 'USD') !== (currency ?? 'USD');
  const duplicate = () => {
    if (to === undefined || isBusy) return;
    setBusy(true);
    setRefusal(undefined);
    void onDuplicate(to).then((refused) => {
      setBusy(false);
      if (refused !== undefined) {
        setRefusal(refused.message);
        return;
      }
      onOpenChange(false);
      toasts.toast({ tone: 'success', message: strings.duplicated(name, picked?.name ?? strings.otherBusiness) });
    });
  };
  return (
    <Modal
      title={strings.duplicateTitle(name)}
      isOpen={isOpen}
      onOpenChange={onOpenChange}
      actions={
        <>
          <Button slot="close">{strings.cancel}</Button>
          <Button variant="primary" isDisabled={to === undefined} isPending={isBusy} onPress={duplicate}>
            {strings.duplicate}
          </Button>
        </>
      }
    >
      <RadioGroup label={strings.duplicateTo} value={to ?? null} onChange={setTo}>
        {others.map((each) => (
          <Radio key={each.id} value={each.id} description={each.currency}>
            {each.name ?? strings.otherBusiness}
          </Radio>
        ))}
      </RadioGroup>
      {differs ? (
        <Callout tone="warning">{strings.currencyDiffers(currency ?? 'USD', picked.currency ?? 'USD')}</Callout>
      ) : null}
      {refusal === undefined ? null : <Callout tone="danger">{refusal}</Callout>}
    </Modal>
  );
}
