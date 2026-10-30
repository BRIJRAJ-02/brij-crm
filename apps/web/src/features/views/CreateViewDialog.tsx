// Brief
// Purpose: make a view of an object for yourself (spec 0020, AC-472), or save a draft as one.
// Main task: name it, pick Table or Board, then Create view; it starts from this view, private.
// Leaves out: sharing (the view's menu shares it), the board's own settings (spec 0021's defaults), and later changes.
import { isDataError, type BoardSettings, type NewView, type View, type ViewConfig, type ViewKind } from '@crm/data';
import { Button, Field, Form, Modal, Radio, RadioGroup, type FormRefusal } from '@crm/ui';
import { useId, useState } from 'react';
import { strings } from './strings.ts';

/** The form's field names, as the server names them on its refusals. */
const FIELDS = ['name'] as const;

/** Props for the create dialog. */
export interface CreateViewDialogProps {
  /** Open as "Create view", or as "Save as new view" (the draft, from this view, the name empty); closed when undefined. */
  readonly mode: 'create' | 'save-as' | undefined;
  readonly onClose: () => void;
  readonly objectId: string;
  /** Mints the view's id, once per opening: a second press after a lost answer sends the same one. */
  readonly newId: () => string;
  /** The config starting from this view's columns and filters (true), or afresh (false, no view to start from). */
  readonly configFor: (fromThisView: boolean) => ViewConfig;
  /** Whether there is a view to start from (none on an object with no view for this person). */
  readonly canStartFromView: boolean;
  /** The kind of the view open now: Save as new view keeps it. */
  readonly currentKind: ViewKind;
  /** A new board's settings when it starts with none (spec 0021, AC-492); undefined when nothing can group. */
  readonly boardDefaults: BoardSettings | undefined;
  /** Makes it and waits for the server; rejects with the refusal. */
  readonly onCreate: (input: NewView) => Promise<View>;
  /** The server made it: close, and open it. */
  readonly onCreated: (view: View) => void;
}

/**
 * "Create view" (Modal + Form): Name and Type, nothing else (30 October 2026: fewer choices). A new view is the
 * person's own and starts from this one; sharing it is one step in the view's menu. Create waits for the server.
 */
export function CreateViewDialog({ mode, onClose, ...rest }: CreateViewDialogProps) {
  const formId = useId();
  const [isBusy, setBusy] = useState(false);
  const title = mode === 'save-as' ? strings.saveAsNewTitle : strings.createViewTitle;
  return (
    <Modal
      title={title}
      isOpen={mode !== undefined}
      // While the server answers, the dialog stays: a refusal has to land on its field.
      onOpenChange={(open) => {
        if (!open && !isBusy) onClose();
      }}
      actions={
        <>
          <Button slot="close" isDisabled={isBusy} kbd="ESC">
            {strings.cancel}
          </Button>
          <Button variant="primary" type="submit" form={formId} isPending={isBusy} kbd="⌘↵">
            {isBusy ? strings.creatingView : mode === 'save-as' ? strings.saveAsNew : strings.createView}
          </Button>
        </>
      }
    >
      {mode !== undefined && (
        <CreateViewForm formId={formId} mode={mode} title={title} isBusy={isBusy} onBusyChange={setBusy} {...rest} />
      )}
    </Modal>
  );
}

/** Props for the dialog's form, mounted afresh with each opening. */
interface CreateViewFormProps extends Omit<CreateViewDialogProps, 'mode' | 'onClose'> {
  readonly mode: 'create' | 'save-as';
  readonly formId: string;
  readonly title: string;
  readonly isBusy: boolean;
  readonly onBusyChange: (isBusy: boolean) => void;
}

function CreateViewForm({
  mode,
  formId,
  title,
  isBusy,
  onBusyChange,
  objectId,
  newId,
  configFor,
  canStartFromView,
  currentKind,
  boardDefaults,
  onCreate,
  onCreated,
}: CreateViewFormProps) {
  // One id per opening, sent again on every press.
  const [id] = useState(newId);
  const [name, setName] = useState('');
  const [kind, setKind] = useState<ViewKind>(mode === 'save-as' ? currentKind : 'table');
  const [refusals, setRefusals] = useState<readonly FormRefusal[]>([]);

  const create = () => {
    if (isBusy) return;
    if (name.trim() === '') {
      setRefusals([{ code: 'INPUT_INVALID', message: strings.nameMissing, attributeId: 'name' }]);
      return;
    }
    onBusyChange(true);
    setRefusals([]);
    const config = configFor(mode === 'save-as' || canStartFromView);
    onCreate({
      id,
      objectId,
      name: name.trim(),
      kind,
      visibility: 'private',
      // A board starts from the defaults unless it brings this view's; with nothing to group by it has none.
      config:
        kind === 'board' && config.board === undefined && boardDefaults !== undefined
          ? { ...config, board: { ...boardDefaults, cardFields: [...boardDefaults.cardFields] } }
          : config,
    }).then(
      (view) => {
        onBusyChange(false);
        onCreated(view);
      },
      (error: unknown) => {
        onBusyChange(false);
        if (!isDataError(error)) {
          setRefusals([{ code: 'INTERNAL', message: strings.createFailed }]);
          return;
        }
        const onName = (field: string | undefined) =>
          field !== undefined && FIELDS.includes(field as 'name') ? field : undefined;
        const listed = (error.data?.refusals ?? []).map((refusal): FormRefusal => {
          const field = onName(refusal.field);
          return {
            code: refusal.code,
            message: refusal.message,
            ...(field === undefined ? {} : { attributeId: field }),
          };
        });
        setRefusals(listed.length > 0 ? listed : [{ code: error.code, message: error.message }]);
      },
    );
  };

  return (
    <Form
      id={formId}
      isBusy={isBusy}
      refusals={refusals}
      fieldFor={(refusal) => refusal.attributeId}
      onSubmit={create}
      label={title}
      focusesFirstField
    >
      <Field
        label={strings.viewName}
        name="name"
        autoComplete="off"
        isRequired
        maxLength={100}
        showCounter
        value={name}
        onChange={setName}
      />
      {mode === 'create' && (
        <RadioGroup
          label={strings.viewType}
          value={kind}
          onChange={(next) => {
            if (next === 'table' || next === 'board') setKind(next);
          }}
        >
          <Radio value="table">{strings.typeTable}</Radio>
          <Radio value="board">{strings.typeBoard}</Radio>
        </RadioGroup>
      )}
    </Form>
  );
}
