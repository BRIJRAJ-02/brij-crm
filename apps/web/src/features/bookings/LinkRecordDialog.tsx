// Link to a record (polish F2), the booking card's More: its own module, loaded when the dialog first opens, since
// the field set's record picker brings every field editor with it (load time, bookings redesign step 1).
import { isDataError, type BookingListItem, type RecordRefDisplay } from '@crm/data';
import { AttributeEditor, Button, Form, Modal, type FieldAttribute } from '@crm/ui';
import { useId, useState } from 'react';
import { editorSearch, useRecordSearch } from '../records/links.ts';
import type { BookingLinking, HostBookingActions } from './BookingActions.tsx';
import { strings } from './strings.ts';

/** The record picker's field in Link to a record: one record, of the object the switcher names. */
const LINKED_RECORD: FieldAttribute = {
  id: 'booking-linked-record',
  name: strings.linkedRecordField,
  type: 'record_reference',
  allowMultiple: false,
  cardinality: 'one',
  isRequired: false,
  isUnique: false,
  isReadOnly: false,
};

/** The record a picker committed (one ref, or the first of a list), or undefined once cleared. */
function refOf(value: unknown): { readonly objectId: string; readonly recordId: string } | undefined {
  const picked: unknown = Array.isArray(value) ? (value as readonly unknown[])[0] : value;
  if (typeof picked !== 'object' || picked === null || !('objectId' in picked) || !('recordId' in picked)) {
    return undefined;
  }
  const { objectId, recordId } = picked;
  return typeof objectId === 'string' && typeof recordId === 'string' ? { objectId, recordId } : undefined;
}

/** Props for LinkRecordDialog. */
export interface LinkRecordDialogProps {
  readonly booking: BookingListItem;
  readonly linking: BookingLinking;
  readonly notify: HostBookingActions['notify'];
  readonly isOpen: boolean;
  readonly onClose: () => void;
}

/**
 * Link to a record (polish F2): the record picker over the objects a booking may be linked to (Deals first, the
 * switcher in its menu as on a task's Records), then Link (⌘↵ from anywhere in it). It starts on the record linked
 * now, if the member may change it; starting empty, its search opens at once, since picking one is the dialog's whole
 * task. The picker holds still while Link is out. A refusal stays under the picker; linked, it closes and says so,
 * and the card shows the record.
 */
export function LinkRecordDialog({ booking, linking, notify, isOpen, onClose }: LinkRecordDialogProps) {
  const now = booking.linkedRecord;
  const [objectId, setObjectId] = useState(
    linking.objects.find((object) => object.id === now?.objectId)?.id ?? linking.objects[0]?.id ?? '',
  );
  // The record linked now, when it is on an object the member may link from (else the picker starts empty).
  const [picked, setPicked] = useState<RecordRefDisplay | undefined>(
    linking.objects.some((object) => object.id === now?.objectId) ? now : undefined,
  );
  // Whether the picker started empty, kept from the first draw: clearing a pick later doesn't open the search again.
  const [startsEmpty] = useState(picked === undefined);
  const formId = useId();
  const [error, setError] = useState<string | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const search = useRecordSearch(linking.slug, objectId);
  const isSame = picked !== undefined && picked.recordId === now?.recordId;
  const link = () => {
    if (busy || picked === undefined || isSame) return;
    setBusy(true);
    setError(undefined);
    linking.link(booking.id, picked).then(
      () => {
        setBusy(false);
        notify('success', strings.linkedToast(picked.name));
        onClose();
      },
      (caught: unknown) => {
        setBusy(false);
        setError(isDataError(caught) && caught.message !== '' ? caught.message : strings.linkFailed);
      },
    );
  };
  const shownError = error ?? (search.failed ? strings.searchFailed : undefined);
  return (
    <Modal
      title={strings.linkTitle(booking.pageTitle, booking.visitorName)}
      isOpen={isOpen}
      isBusy={busy}
      onOpenChange={(open) => {
        if (!open && !busy) onClose();
      }}
      actions={
        <>
          <Button slot="close" isDisabled={busy}>
            {strings.cancel}
          </Button>
          <Button
            variant="primary"
            icon="link"
            type="submit"
            form={formId}
            kbd="⌘↵"
            isPending={busy}
            isDisabled={picked === undefined || isSame}
          >
            {busy ? strings.linking : strings.linkIt}
          </Button>
        </>
      }
    >
      <Form id={formId} isBusy={busy} onSubmit={link} label={strings.linkTitle(booking.pageTitle, booking.visitorName)}>
        <AttributeEditor
          attribute={LINKED_RECORD}
          value={picked === undefined ? null : { objectId: picked.objectId, recordId: picked.recordId }}
          {...(picked === undefined ? {} : { display: picked })}
          surface="form"
          autoOpen={startsEmpty}
          isDisabled={busy}
          onSearch={editorSearch(search.onSearch)}
          objectSwitcher={{
            objects: linking.objects.map((object) => ({
              id: object.id,
              label: object.pluralName,
              icon: object.icon,
              hue: object.hue,
            })),
            objectId,
            // Another object: a record picked in the last one goes, so Link never sends one the list no longer shows.
            onObjectChange: (next) => {
              setObjectId(next);
              setError(undefined);
              if (picked !== undefined && picked.objectId !== next) setPicked(undefined);
            },
          }}
          onCommit={(value) => {
            setError(undefined);
            const ref = refOf(value);
            setPicked(
              ref === undefined ? undefined : (search.displayOf(ref.recordId) ?? { ...ref, name: '', kind: 'other' }),
            );
          }}
          {...(shownError === undefined ? {} : { error: shownError })}
        />
      </Form>
    </Modal>
  );
}
