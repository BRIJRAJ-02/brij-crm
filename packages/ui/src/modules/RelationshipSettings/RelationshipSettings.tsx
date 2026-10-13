// RelationshipSettings (spec 0014): the one dialog that creates a
// relationship between two objects (or an object and itself) and renames its
// two sides. Presentational: the objects, the preset ends and the answer's
// refusals come in as props, what the person chose goes out through
// `onSubmit`, and the screen talks to the data layer and mints the
// relationship's id once per opening.
import { CARDINALITIES, sidesHoldingOne, type CardinalityKey } from '@crm/contracts/values';
import { useId, useState } from 'react';
import { Button } from '../../atoms/Button/Button.tsx';
import { Icon } from '../../atoms/Icon/Icon.tsx';
import type { IconName } from '../../atoms/Icon/icons.ts';
import { Radio, RadioGroup } from '../../atoms/Radio/Radio.tsx';
import type { Hue } from '../../hue.ts';
import { Callout } from '../../molecules/Callout/Callout.tsx';
import { Field } from '../../molecules/Field/Field.tsx';
import { Form, type FormRefusal } from '../../molecules/Form/Form.tsx';
import { Modal } from '../../molecules/Modal/Modal.tsx';
import { Select, type SelectItem } from '../../molecules/Select/Select.tsx';
import { strings } from './strings.ts';

/** An object a side may sit on, as the dialog names it and draws its tile. */
export interface RelationshipSettingsObject {
  readonly id: string;
  readonly singularName: string;
  readonly pluralName: string;
  readonly icon: IconName;
  readonly hue: Hue;
}

/** One end, preset by the screen: its object, and in edit mode its side's current name. */
export interface RelationshipSettingsEnd {
  readonly objectId: string;
  readonly title?: string;
}

/** A setting the dialog shows, by the name the server's refusals give it. */
export type RelationshipSettingsField = 'from.objectId' | 'to.objectId' | 'cardinality' | 'from.title' | 'to.title';

/** What the person chose, and which names they changed (an edit sends only those). */
export interface RelationshipSettingsValues {
  readonly cardinality: CardinalityKey;
  readonly from: { readonly objectId: string; readonly title: string };
  readonly to: { readonly objectId: string; readonly title: string };
  readonly changed: readonly ('from.title' | 'to.title')[];
}

/** Props for RelationshipSettings. */
export interface RelationshipSettingsProps {
  readonly isOpen: boolean;
  readonly onOpenChange: (isOpen: boolean) => void;
  /** `create` makes a relationship; `edit` renames its sides, with both objects and the cardinality read only. */
  readonly mode: 'create' | 'edit';
  /** The live objects a side may sit on (this one included), and the names of preset ones. */
  readonly objects: readonly RelationshipSettingsObject[];
  /** The defining end, when the screen sets it (the object whose table opened the dialog); chosen in a Select when absent. */
  readonly from?: RelationshipSettingsEnd;
  /** The other end, when the screen sets it; chosen in a Select when absent. */
  readonly to?: RelationshipSettingsEnd;
  /** The cardinality: the relationship's own in edit mode, the first choice in create mode (`many_to_one` when absent). */
  readonly cardinality?: CardinalityKey;
  /** The screen waits for the server: the primary spins and the dialog stays. */
  readonly isBusy?: boolean;
  /** The last answer's refusals: each on the setting it names (`attributeId` is the field, `to.title`), else above them. */
  readonly refusals?: readonly FormRefusal[];
  readonly onSubmit: (values: RelationshipSettingsValues) => void;
  /** Shown read only, with this reason once, and Close alone (a member who can't change the schema). */
  readonly readOnlyReason?: string;
}

/** An object's names as the sentences use them, lower case, or the plain words for one the dialog doesn't hold. */
interface Nouns {
  readonly singular: string;
  readonly plural: string;
  readonly title: string;
}

function nounsOf(object: RelationshipSettingsObject | undefined): Nouns {
  return object === undefined
    ? { singular: strings.unknownSingular, plural: strings.unknownPlural, title: strings.unknownObject }
    : {
        singular: object.singularName.toLowerCase(),
        plural: object.pluralName.toLowerCase(),
        title: object.pluralName,
      };
}

/** The name a side gets until the person types one: the other object's singular or plural, by what the side holds. */
function defaultTitle(other: RelationshipSettingsObject | undefined, holdsOne: boolean): string {
  if (other === undefined) return '';
  return holdsOne ? other.singularName : other.pluralName;
}

/** The settings drawn with their own `error`; the names land on Form fields by name. */
const OWN_ERRORS: ReadonlySet<string> = new Set(['from.objectId', 'to.objectId', 'cardinality']);
const FORM_FIELDS: ReadonlySet<string> = new Set(['from.title', 'to.title']);

/**
 * RelationshipSettings: a Modal with the two objects, how their records link
 * (four plain choices phrased with both objects), a name for each side and a
 * sentence restating the result. Create waits for the screen's answer; edit
 * renames the sides.
 */
export function RelationshipSettings({
  isOpen,
  onOpenChange,
  mode,
  isBusy = false,
  readOnlyReason,
  ...rest
}: RelationshipSettingsProps) {
  const formId = useId();
  const isReadOnly = readOnlyReason !== undefined;
  const title = mode === 'create' ? strings.newTitle : isReadOnly ? strings.viewTitle : strings.editTitle;
  return (
    <Modal
      title={title}
      isOpen={isOpen}
      // While the server answers, the dialog stays: a refusal has to land on its side.
      onOpenChange={(open) => {
        if (!open && isBusy) return;
        onOpenChange(open);
      }}
      actions={
        isReadOnly ? (
          <Button slot="close" kbd="ESC">
            {strings.close}
          </Button>
        ) : (
          <>
            <Button slot="close" isDisabled={isBusy} kbd="ESC">
              {strings.cancel}
            </Button>
            <Button variant="primary" type="submit" form={formId} isPending={isBusy} kbd="⌘↵">
              {mode === 'create'
                ? isBusy
                  ? strings.creating
                  : strings.create
                : isBusy
                  ? strings.saving
                  : strings.save}
            </Button>
          </>
        )
      }
    >
      <RelationshipForm
        {...rest}
        formId={formId}
        label={title}
        mode={mode}
        isBusy={isBusy}
        readOnlyReason={readOnlyReason}
      />
    </Modal>
  );
}

/** Props for the dialog's form, mounted afresh with each opening. */
interface RelationshipFormProps extends Omit<RelationshipSettingsProps, 'isOpen' | 'onOpenChange'> {
  readonly formId: string;
  readonly label: string;
  readonly isBusy: boolean;
}

function RelationshipForm({
  formId,
  label,
  mode,
  objects,
  from,
  to,
  cardinality: initialCardinality = CARDINALITIES[0],
  isBusy,
  refusals = [],
  onSubmit,
  readOnlyReason,
}: RelationshipFormProps) {
  const isEditing = mode === 'edit';
  const isReadOnly = readOnlyReason !== undefined;
  const [fromId, setFromId] = useState<string | null>(from?.objectId ?? null);
  const [toId, setToId] = useState<string | null>(to?.objectId ?? null);
  const [cardinality, setCardinality] = useState<CardinalityKey>(initialCardinality);
  // A name follows the objects and the cardinality until the person types it (undefined), as the API name does.
  const [fromTitle, setFromTitle] = useState<string | undefined>(from?.title);
  const [toTitle, setToTitle] = useState<string | undefined>(to?.title);
  const [changed, setChanged] = useState<ReadonlySet<'from.title' | 'to.title'>>(new Set());
  const [local, setLocal] = useState<readonly FormRefusal[]>([]);

  const fromObject = objects.find((object) => object.id === fromId);
  const toObject = objects.find((object) => object.id === toId);
  const holdsOne = sidesHoldingOne(cardinality);
  const isSelf = fromId !== null && fromId === toId;
  const fromName = fromTitle ?? defaultTitle(toObject, holdsOne.from);
  const toName = toTitle ?? defaultTitle(fromObject, holdsOne.to);
  const near = nounsOf(fromObject);
  const far = nounsOf(toObject);

  // A refusal typed locally wins until the next answer; each lands on its setting, the rest above them.
  const shown = local.length > 0 ? local : refusals;
  const errorOf = (field: RelationshipSettingsField) => shown.find((refusal) => refusal.attributeId === field)?.message;

  const submit = () => {
    if (isBusy || isReadOnly) return;
    const problems: FormRefusal[] = [
      ...(fromId === null
        ? [{ code: 'INPUT_INVALID', message: strings.objectMissing, attributeId: 'from.objectId' }]
        : []),
      ...(toId === null ? [{ code: 'INPUT_INVALID', message: strings.objectMissing, attributeId: 'to.objectId' }] : []),
      ...(fromName.trim() === ''
        ? [{ code: 'INPUT_INVALID', message: strings.nameMissing, attributeId: 'from.title' }]
        : []),
      ...(toName.trim() === ''
        ? [{ code: 'INPUT_INVALID', message: strings.nameMissing, attributeId: 'to.title' }]
        : isSelf && fromName.trim().toLowerCase() === toName.trim().toLowerCase()
          ? [{ code: 'CONFIG_INVALID', message: strings.namesEqual, attributeId: 'to.title' }]
          : []),
    ];
    setLocal(problems);
    if (problems.length > 0 || fromId === null || toId === null) return;
    onSubmit({
      cardinality,
      from: { objectId: fromId, title: fromName.trim() },
      to: { objectId: toId, title: toName.trim() },
      changed: [...changed],
    });
  };

  const items: readonly SelectItem[] = objects.map((object) => ({
    id: object.id,
    label: object.pluralName,
    leading: <Icon name={object.icon} tile={object.hue} />,
  }));
  // A preset end the list doesn't hold (an object hidden from the viewer) still shows, by its plain words.
  const itemsWith = (id: string | null): readonly SelectItem[] =>
    id === null || items.some((item) => item.id === id) ? items : [...items, { id, label: strings.unknownObject }];
  // The dialog opens on the first thing still to choose: an object the screen didn't set, else the first name.
  const choosable =
    isEditing || isReadOnly ? undefined : from === undefined ? 'from' : to === undefined ? 'to' : undefined;
  const objectSelect = (side: 'from' | 'to', id: string | null, isPreset: boolean) => {
    const error = errorOf(`${side}.objectId`);
    return (
      <Select
        autoFocus={choosable === side}
        label={side === 'from' ? strings.object : strings.relatedObject}
        items={itemsWith(id)}
        value={id}
        placeholder={strings.chooseObject}
        isSearchable={items.length > 15}
        onChange={(next) => {
          if (side === 'from') setFromId(next);
          else setToId(next);
        }}
        {...(isEditing || isPreset || isReadOnly
          ? { isReadOnly: true, ...(isEditing ? { readOnlyReason: strings.objectsFixed } : {}) }
          : {})}
        {...(error === undefined ? {} : { error })}
      />
    );
  };
  const cardinalityError = errorOf('cardinality');
  const choiceOf = (each: CardinalityKey) => {
    const sides = sidesHoldingOne(each);
    return strings.choice({ ...near, isOne: sides.from }, { ...far, isOne: sides.to });
  };
  const formRefusals = shown.filter(
    (refusal) => refusal.attributeId === undefined || !OWN_ERRORS.has(refusal.attributeId),
  );
  const nameField = (side: 'from' | 'to') => {
    const on = side === 'from' ? near.title : far.title;
    return (
      <Field
        label={side === 'to' && isSelf ? strings.reverseNameOn(on) : strings.nameOn(on)}
        name={`${side}.title`}
        autoComplete="off"
        isRequired
        maxLength={100}
        hint={strings.nameHint}
        autoFocus={side === 'from' && choosable === undefined && !isReadOnly}
        value={side === 'from' ? fromName : toName}
        onChange={(next) => {
          if (side === 'from') setFromTitle(next);
          else setToTitle(next);
          setChanged((before) => new Set([...before, `${side}.title` as const]));
        }}
        {...(isReadOnly ? { isReadOnly } : {})}
      />
    );
  };

  return (
    <Form
      id={formId}
      isBusy={isBusy}
      refusals={formRefusals}
      fieldFor={(refusal) =>
        refusal.attributeId !== undefined && FORM_FIELDS.has(refusal.attributeId) ? refusal.attributeId : undefined
      }
      onSubmit={submit}
      label={label}
      // Focus is placed by the controls themselves (`choosable`): the Form's first field could be a hidden select.
      focusesFirstField={false}
    >
      {readOnlyReason !== undefined && <Callout>{readOnlyReason}</Callout>}
      {objectSelect('from', fromId, from !== undefined)}
      {objectSelect('to', toId, to !== undefined)}
      {isEditing || isReadOnly ? (
        <Select
          label={strings.cardinality}
          items={[{ id: cardinality, label: choiceOf(cardinality) }]}
          value={cardinality}
          isReadOnly
          {...(isEditing ? { readOnlyReason: strings.cardinalityFixed } : {})}
        />
      ) : (
        <RadioGroup
          label={strings.cardinality}
          value={cardinality}
          onChange={(next) => {
            const found = CARDINALITIES.find((each) => each === next);
            if (found !== undefined) setCardinality(found);
          }}
          {...(cardinalityError === undefined ? {} : { error: cardinalityError })}
        >
          {CARDINALITIES.map((each) => (
            <Radio key={each} value={each}>
              {choiceOf(each)}
            </Radio>
          ))}
        </RadioGroup>
      )}
      {nameField('from')}
      {nameField('to')}
      <Callout>
        {isSelf
          ? strings.selfSentence(
              near.title,
              { title: fromName.trim(), isOne: holdsOne.from },
              { title: toName.trim(), isOne: holdsOne.to },
              near.singular,
              near.plural,
            )
          : `${strings.sideSentence(near.title, fromName.trim(), holdsOne.from, far.singular, far.plural)} ${strings.sideSentence(far.title, toName.trim(), holdsOne.to, near.singular, near.plural)}`}
      </Callout>
    </Form>
  );
}
