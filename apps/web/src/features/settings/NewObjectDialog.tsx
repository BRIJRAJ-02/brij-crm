// Brief
// Purpose: create a custom object (Projects, Partners) with its first attributes, from Settings, Objects.
// Main task: type the name; the plural, API name, icon, colour and starter attributes follow, then Create (⌘↵).
// Leaves out: editing options (a Stage starts with its stages, a Priority with three levels; the Attributes tab edits
// them), relationships and rules; every guess stays editable.
import {
  starterOptionsFor,
  toApiSlug,
  typeFor,
  type Hue,
  type NewObject,
  type ObjectIcon,
  type ObjectSummary,
} from '@crm/data';
import {
  Button,
  Disclosure,
  Field,
  fieldTypeOf,
  Form,
  HUES,
  Modal,
  Select,
  typeLabelOf,
  type FormRefusal,
} from '@crm/ui';
import { useEffect, useId, useRef, useState } from 'react';
import { hueFor, iconFor, INLINE_TYPES, namesFrom, startersFor, type InlineType } from './new-object-guess.ts';
import { ObjectHueField, ObjectIconButton } from './ObjectLookFields.tsx';
import { formRefusals, objectWords } from './refusals.ts';
import { strings } from './strings.ts';

/** The form's field names, as the server names them on its refusals. */
// `singularName` is the Name field, which may hold the plural ("Projects"); `singularGuess` is the Singular name
// field, where a refusal lands once the person has typed their own singular.
const FIELDS = ['singularName', 'singularGuess', 'pluralName', 'apiSlug', 'icon', 'hue'] as const;

/** Props for the new object dialog. */
export interface NewObjectDialogProps {
  readonly isOpen: boolean;
  readonly onOpenChange: (isOpen: boolean) => void;
  /** The workspace's live objects: the first colour none of them uses is the new one's. */
  readonly objects: readonly ObjectSummary[];
  /** Mints the new object's id, once per opening: a second press after a lost answer sends the same one. */
  readonly newId: () => string;
  /** Creates it and waits for the server; rejects with the refusals. */
  readonly onCreate: (input: NewObject) => Promise<ObjectSummary>;
  /** The server made it: close, and open its settings. */
  readonly onCreated: (object: ObjectSummary) => void;
}

/** "New object": a Modal with the names, the API name, the icon and the colour; Create waits for the server. */
export function NewObjectDialog({ isOpen, onOpenChange, objects, newId, onCreate, onCreated }: NewObjectDialogProps) {
  const formId = useId();
  const [isBusy, setBusy] = useState(false);
  return (
    <Modal
      title={strings.newObject}
      variant="window"
      isOpen={isOpen}
      // While the server answers, the dialog stays: a refusal has to land on its field.
      onOpenChange={(open) => {
        if (!open && isBusy) return;
        onOpenChange(open);
      }}
      actions={
        <>
          <Button slot="close" isDisabled={isBusy} kbd="ESC">
            {strings.cancel}
          </Button>
          <Button variant="primary" type="submit" form={formId} isPending={isBusy} kbd="⌘↵">
            {isBusy ? strings.creatingObject : strings.createObject}
          </Button>
        </>
      }
    >
      <NewObjectForm
        formId={formId}
        objects={objects}
        newId={newId}
        isBusy={isBusy}
        onBusyChange={setBusy}
        onCreate={onCreate}
        onCreated={onCreated}
      />
    </Modal>
  );
}

/** Props for the dialog's form, mounted afresh with each opening. */
interface NewObjectFormProps extends Pick<NewObjectDialogProps, 'objects' | 'newId' | 'onCreate' | 'onCreated'> {
  readonly formId: string;
  readonly isBusy: boolean;
  readonly onBusyChange: (isBusy: boolean) => void;
}

/** The fields inside the names disclosure, which a refusal on any of them opens. */
const IN_NAMES: ReadonlySet<string> = new Set(['singularGuess', 'pluralName', 'apiSlug']);

/** One attribute row: its text, a type the person chose (else the name's guess) and a key that survives reordering. */
interface Row {
  readonly key: number;
  readonly title: string;
  readonly type: InlineType | undefined;
}

/** The most attributes one create starts with (the server's own cap is 30). */
const MAX_ROWS = 30;

const typeItems = INLINE_TYPES.map((type) => ({ id: type, label: typeLabelOf(type), icon: fieldTypeOf(type).icon }));
const isInlineType = (id: string | null): id is InlineType => INLINE_TYPES.some((type) => type === id);

/**
 * The form. Everything follows the name until the person edits it: the plural, the API name (the server's own
 * `toApiSlug`), the icon and the colour. Attribute rows add a row on Enter, guess their type from their name, and
 * Create sends the object with its attributes in one request (one transaction on the server).
 */
function NewObjectForm({ formId, objects, newId, isBusy, onBusyChange, onCreate, onCreated }: NewObjectFormProps) {
  // One id per opening, sent again on every press.
  const [id] = useState(newId);
  // What the Name field holds: either form, "Project" or "Projects" (the singular and plural follow from it).
  const [singular, setSingular] = useState('');
  // The singular, once the person corrects the guess a plural Name gives.
  const [singularEdit, setSingularEdit] = useState<string | undefined>(undefined);
  const [plural, setPlural] = useState<string | undefined>(undefined);
  const [apiSlug, setApiSlug] = useState<string | undefined>(undefined);
  const [pickedIcon, setIcon] = useState<ObjectIcon | undefined>(undefined);
  const [pickedHue, setHue] = useState<Hue | undefined>(undefined);
  const [rows, setRows] = useState<readonly Row[]>([{ key: 0, title: '', type: undefined }]);
  const [refusals, setRefusals] = useState<readonly FormRefusal[]>([]);
  const [isNamesOpen, setNamesOpen] = useState(false);
  const [rowErrors, setRowErrors] = useState<Readonly<Record<number, string>>>({});
  const nextKey = useRef(1);
  const inputs = useRef(new Map<number, HTMLInputElement | null>());
  const focusKey = useRef<number | undefined>(undefined);
  // Enter in a field also asks the form to submit natively; an Enter this dialog already used must not create.
  const enterUsed = useRef(false);
  const markEnter = () => {
    enterUsed.current = true;
    setTimeout(() => {
      enterUsed.current = false;
    }, 0);
  };
  const live = objects.filter((object) => !object.isArchived);

  const trimmed = singular.trim();
  // A singular put back to the Name says the word is the same in both forms ("Kudos"): the plural is the Name too.
  const guessed =
    singularEdit?.trim() === trimmed && trimmed !== '' ? { singular: trimmed, plural: trimmed } : namesFrom(trimmed);
  // As typed in the field (spaces kept while typing "Graphic Designer"); trimmed when compared and sent.
  const singularTyped = singularEdit ?? guessed.singular;
  const singularShown = singularTyped.trim();
  const ownSingular = singularEdit !== undefined;
  const pluralShown = plural ?? guessed.plural;
  const slugShown = apiSlug ?? (pluralShown.trim() === '' ? '' : toApiSlug(pluralShown, 'object'));
  const icon = pickedIcon ?? iconFor(trimmed);
  const hue =
    pickedHue ??
    hueFor(
      trimmed,
      HUES,
      live.map((object) => object.hue),
    );
  const typeOf = (row: Row): InlineType => row.type ?? typeFor(row.title);

  // After a row is added or removed, focus goes where the person was heading.
  useEffect(() => {
    if (focusKey.current === undefined) return;
    inputs.current.get(focusKey.current)?.focus();
    focusKey.current = undefined;
  }, [rows]);

  const change = (key: number, changes: Partial<Row>) => {
    setRows((current) => current.map((row) => (row.key === key ? { ...row, ...changes } : row)));
    setRowErrors((current) => ({ ...current, [key]: '' }));
  };
  const addAfter = (key: number, filled?: Pick<Row, 'title' | 'type'>) => {
    const added: Row = { key: nextKey.current, title: '', type: undefined };
    nextKey.current += 1;
    focusKey.current = added.key;
    setRows((current) => {
      const at = current.findIndex((row) => row.key === key);
      const filledRows = current.map((row) => (row.key === key && filled !== undefined ? { ...row, ...filled } : row));
      return [...filledRows.slice(0, at + 1), added, ...filledRows.slice(at + 1)];
    });
  };
  const remove = (key: number) => {
    const at = rows.findIndex((row) => row.key === key);
    if (rows.length === 1) {
      change(key, { title: '', type: undefined });
      inputs.current.get(key)?.focus();
      return;
    }
    focusKey.current = rows[at > 0 ? at - 1 : 1]?.key;
    setRows((current) => current.filter((row) => row.key !== key));
  };

  const last = rows.at(-1);
  const taken = new Set(rows.map((row) => row.title.trim().toLowerCase()));
  const starters = startersFor(trimmed).filter((starter) => !taken.has(starter.title.toLowerCase()));

  const create = () => {
    if (isBusy || enterUsed.current) return;
    const filled = rows.filter((row) => row.title.trim() !== '');
    const seen = new Set<string>(['name']);
    const errors: Record<number, string> = {};
    for (const row of filled) {
      const slug = toApiSlug(row.title, 'attribute');
      if (seen.has(slug)) errors[row.key] = slug === 'name' ? strings.nameIsDefault : strings.attributeRepeated;
      seen.add(slug);
    }
    const missing = [
      ...(trimmed === '' ? ['singularName'] : singularShown === '' ? ['singularGuess'] : []),
      ...(pluralShown.trim() === '' ? ['pluralName'] : []),
    ].map((field) => ({ code: 'INPUT_INVALID', message: strings.nameMissing, attributeId: field }));
    if (missing.length > 0 || Object.keys(errors).length > 0) {
      setRowErrors(errors);
      setRefusals(missing);
      if (missing.some((refusal) => IN_NAMES.has(refusal.attributeId))) setNamesOpen(true);
      return;
    }
    onBusyChange(true);
    setRefusals([]);
    onCreate({
      id,
      singularName: singularShown,
      pluralName: pluralShown.trim(),
      // Sent only when the person typed one; the server derives the same otherwise.
      ...(apiSlug === undefined || apiSlug.trim() === '' ? {} : { apiSlug: apiSlug.trim() }),
      icon,
      hue,
      ...(filled.length === 0
        ? {}
        : {
            attributes: filled.map((row) => {
              const type = typeOf(row);
              const options = starterOptionsFor(row.title, type).map((option) => ({ ...option, id: newId() }));
              return { title: row.title.trim(), type, ...(options.length === 0 ? {} : { options }) };
            }),
          }),
    }).then(
      (object) => {
        onBusyChange(false);
        onCreated(object);
      },
      (error: unknown) => {
        onBusyChange(false);
        // A refusal of the singular lands where it was typed: the Name, or the Singular name field once edited.
        const next = formRefusals(error, FIELDS, objectWords).map((refusal) =>
          ownSingular && refusal.attributeId === 'singularName'
            ? { ...refusal, attributeId: 'singularGuess' }
            : refusal,
        );
        // Those fields sit in a closed disclosure: a refusal on one opens it.
        if (next.some((refusal) => IN_NAMES.has(refusal.attributeId ?? ''))) setNamesOpen(true);
        setRefusals(next);
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
      label={strings.newObject}
      focusesFirstField
    >
      <Field
        label={strings.objectName}
        placeholder={strings.objectNamePlaceholder}
        prefix={<ObjectIconButton icon={icon} hue={hue} onChange={setIcon} />}
        name="singularName"
        autoComplete="off"
        isRequired
        maxLength={100}
        value={singular}
        onChange={setSingular}
        // Named singularName for the server's refusals, though it may hold the plural: the singular and plural follow.
        // Enter moves on to the first attribute rather than creating.
        onSubmit={() => {
          markEnter();
          const first = rows[0];
          if (first !== undefined) inputs.current.get(first.key)?.focus();
        }}
        // Both forms are said whenever the singular isn't what was typed, or the two are one word, so a plural Name
        // never surprises anyone.
        hint={
          trimmed === ''
            ? undefined
            : singularShown === trimmed && pluralShown.trim() !== trimmed
              ? strings.followsName(pluralShown)
              : strings.followsNames(singularShown, pluralShown.trim())
        }
      />
      <Disclosure title={strings.namesAndApi} isExpanded={isNamesOpen} onExpandedChange={setNamesOpen} variant="quiet">
        <Field
          label={strings.singularName}
          name="singularGuess"
          autoComplete="off"
          isRequired
          maxLength={100}
          value={singularTyped}
          // Emptied, it follows the name again.
          onChange={(next) => {
            setSingularEdit(next === '' ? undefined : next);
          }}
        />
        <Field
          label={strings.pluralName}
          name="pluralName"
          autoComplete="off"
          isRequired
          maxLength={100}
          value={pluralShown}
          // Emptied, it follows the name again.
          onChange={(next) => {
            setPlural(next === '' ? undefined : next);
          }}
        />
        <Field
          label={strings.apiName}
          name="apiSlug"
          autoComplete="off"
          maxLength={63}
          hint={strings.apiNameHint}
          value={slugShown}
          onChange={(next) => {
            setApiSlug(next === '' ? undefined : next);
          }}
        />
        <ObjectHueField hue={hue} onChange={setHue} />
      </Disclosure>
      <div role="group" aria-label={strings.firstAttributes}>
        {rows.map((row, index) => (
          <Field
            key={row.key}
            ref={(element) => {
              inputs.current.set(row.key, element);
              return () => {
                inputs.current.delete(row.key);
              };
            }}
            label={index === 0 ? strings.firstAttributes : strings.attributeN(index + 1)}
            isLabelHidden={index > 0}
            labelAside={index === 0 ? strings.nameIsAlways : undefined}
            placeholder={index === 0 ? strings.attributePlaceholder : strings.attributeMore}
            autoComplete="off"
            maxLength={100}
            value={row.title}
            isDisabled={isBusy}
            error={rowErrors[row.key] === '' ? undefined : rowErrors[row.key]}
            onChange={(title) => {
              change(row.key, { title });
            }}
            // Enter adds the next row under this one; on an empty row it does nothing but stay.
            onSubmit={() => {
              markEnter();
              if (row.title.trim() !== '' && rows.length < MAX_ROWS && !isBusy) addAfter(row.key);
            }}
            // Backspace in an empty row takes it away and goes back up.
            onKeyDown={(event) => {
              if (event.key === 'Backspace' && !event.repeat && row.title === '' && rows.length > 1 && !isBusy) {
                event.preventDefault();
                remove(row.key);
              }
            }}
            suggestions={
              row.key === last?.key && row.title === '' && starters.length > 0
                ? {
                    label: strings.starters,
                    items: starters.map((starter) => starter.title),
                    onPick: (title) => {
                      const starter = starters.find((each) => each.title === title);
                      if (starter !== undefined) addAfter(row.key, starter);
                    },
                  }
                : undefined
            }
            after={
              <>
                <Select
                  label={strings.attributeType(row.title.trim() === '' ? String(index + 1) : row.title.trim())}
                  isLabelHidden
                  size="sm"
                  isDisabled={isBusy}
                  items={typeItems}
                  value={typeOf(row)}
                  onChange={(next) => {
                    if (isInlineType(next)) change(row.key, { type: next });
                  }}
                />
                <Button
                  variant="ghost"
                  icon="x"
                  isDisabled={isBusy}
                  label={strings.removeAttribute(row.title.trim() === '' ? String(index + 1) : row.title.trim())}
                  onPress={() => {
                    remove(row.key);
                  }}
                />
              </>
            }
          />
        ))}
      </div>
    </Form>
  );
}
