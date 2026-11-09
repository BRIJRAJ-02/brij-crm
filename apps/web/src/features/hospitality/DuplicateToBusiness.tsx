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
  /** What is copied: a menu lands in the other business's draft, a service in its catalogue. */
  readonly kind: 'menu' | 'service';
  /** The menu's or the service's name, for the title and the toast. */
  readonly name: string;
  /** Every business but the one shown, in order. */
  readonly others: readonly PropertySummary[];
  /** The shown business's currency, to compare with the one picked; unknown on either side, nothing is said. */
  readonly currency: string | undefined;
  readonly onDuplicate: (to: string) => Promise<DataError | undefined>;
  /** Shows the other business, from the toast's Show. */
  readonly onShow: (to: string) => void;
  readonly toasts: Toasts;
}

/**
 * Copy to another business: the other businesses as choices, a warning while the one picked prices in another
 * currency, and Copy. The dialog holds while the copy runs and stays open on a refusal, saying why; done, it closes
 * and a toast says where the copy went, with Show to go there.
 */
export function DuplicateToBusiness({
  isOpen,
  onOpenChange,
  kind,
  name,
  others,
  currency,
  onDuplicate,
  onShow,
  toasts,
}: DuplicateToBusinessProps) {
  const [to, setTo] = useState<string | undefined>(others.length === 1 ? others[0]?.id : undefined);
  const [isBusy, setBusy] = useState(false);
  const [refusal, setRefusal] = useState<string | undefined>();
  const picked = others.find((each) => each.id === to);
  const differs =
    picked?.currency !== undefined && currency !== undefined && picked.currency !== currency
      ? { from: currency, to: picked.currency }
      : undefined;
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
      const where = picked?.name ?? strings.otherBusiness;
      toasts.toast({
        tone: 'success',
        message: kind === 'menu' ? strings.copiedMenu(name, where) : strings.copiedService(name, where),
        action: { label: strings.show, onAction: () => onShow(to) },
      });
    });
  };
  return (
    <Modal
      title={strings.copyTitle(name)}
      isOpen={isOpen}
      isBusy={isBusy}
      onOpenChange={onOpenChange}
      actions={
        <>
          <Button slot="close" isDisabled={isBusy}>
            {strings.cancel}
          </Button>
          <Button variant="primary" isDisabled={to === undefined} isPending={isBusy} onPress={duplicate}>
            {strings.copy}
          </Button>
        </>
      }
    >
      <RadioGroup label={strings.copyTo} value={to ?? null} onChange={setTo}>
        {others.map((each) => (
          <Radio key={each.id} value={each.id} {...(each.currency === undefined ? {} : { description: each.currency })}>
            {each.name ?? strings.otherBusiness}
          </Radio>
        ))}
      </RadioGroup>
      {differs === undefined ? null : (
        <Callout tone="warning">{strings.currencyDiffers(differs.from, differs.to)}</Callout>
      )}
      {refusal === undefined ? null : <Callout tone="danger">{refusal}</Callout>}
    </Modal>
  );
}
