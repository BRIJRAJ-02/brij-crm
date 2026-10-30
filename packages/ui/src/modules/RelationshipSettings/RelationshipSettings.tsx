// RelationshipSettings (spec 0014): the one dialog that creates a
// relationship between two objects (or an object and itself) and renames its
// two sides. Presentational: the objects, the preset ends and the answer's
// refusals come in as props, what the person chose goes out through
// `onSubmit`, and the screen talks to the data layer and mints the
// relationship's id once per opening.
import { CARDINALITIES, sidesHoldingOne, type CardinalityKey } from '@crm/contracts/values';
import { useId, useState, type ReactNode } from 'react';
import { Button } from '../../atoms/Button/Button.tsx';
import { Icon } from '../../atoms/Icon/Icon.tsx';
import type { IconName } from '../../atoms/Icon/icons.ts';
import { Radio, RadioGroup } from '../../atoms/Radio/Radio.tsx';
import type { Hue } from '../../hue.ts';
import { Callout } from '../../molecules/Callout/Callout.tsx';
import { Field } from '../../molecules/Field/Field.tsx';
import { Form, type FormRefusal } from '../../molecules/Form/Form.tsx';
import { InfoTip } from '../../molecules/InfoTip/InfoTip.tsx';
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
  /** Edit mode: the side whose name takes focus, the one the person opened (`from` when absent). */
  readonly focusSide?: 'from' | 'to';
  /**
   * Create mode: "New object…" last in the related object's list (flow pass, 30 October 2026), for a relationship
   * to an object that doesn't exist yet. The screen makes it, then hands it back as `chosenTo`.
   */
  readonly newObject?: { readonly label: string; readonly onChoose: () => void };
  /** An object the screen chose for the related side (one just made): a new object each time picks it. */
  readonly chosenTo?: { readonly objectId: string };
  /** Create mode, as AttributeSettings' step: Back returns to the attribute form, its name kept. */
  readonly onBack?: () => void;
}

/** The related object list's last item, "New object…". */
const NEW_OBJECT = '__new_object';

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

/** The cardinality whose sides hold one record as asked: each side's question answers one half. */
function cardinalityOf(fromHoldsOne: boolean, toHoldsOne: boolean): CardinalityKey {
  const found = CARDINALITIES.find((each) => {
    const sides = sidesHoldingOne(each);
    return sides.from === fromHoldsOne && sides.to === toHoldsOne;
  });
  return found ?? CARDINALITIES[0];
}

/** The settings drawn with their own `error`; the names land on Form fields by name. */
const OWN_ERRORS: ReadonlySet<string> = new Set(['from.objectId', 'to.objectId', 'cardinality']);
const FORM_FIELDS: ReadonlySet<string> = new Set(['from.title', 'to.title']);

/** One dialog's title, footer and body, which a Modal shows: RelationshipSettings' own, or AttributeSettings' in its place. */
export interface DialogStep {
  readonly title: string;
  readonly actions: ReactNode;
  readonly body: ReactNode;
}

/** What `relationshipStep` takes: RelationshipSettings' props without the Modal's, and the form's id. */
export type RelationshipStepProps = Omit<RelationshipSettingsProps, 'isOpen' | 'onOpenChange'> & {
  /** The form's id (`useId` in the caller), which the footer's primary submits. */
  readonly formId: string;
};

/**
 * RelationshipSettings' title, footer and body, for a Modal that is already
 * open: AttributeSettings shows them in its own Modal when Relationship is
 * chosen (its `step`), so the scrim, the dialog and where focus returns stay
 * as they were. RelationshipSettings is the same step in a Modal of its own.
 */
export function relationshipStep({
  formId,
  mode,
  isBusy = false,
  readOnlyReason,
  onBack,
  ...rest
}: RelationshipStepProps): DialogStep {
  const isReadOnly = readOnlyReason !== undefined;
  const title = mode === 'create' ? strings.newTitle : isReadOnly ? strings.viewTitle : strings.editTitle;
  return {
    title,
    actions: isReadOnly ? (
      <Button slot="close" kbd="ESC">
        {strings.close}
      </Button>
    ) : (
      <>
        {onBack !== undefined && mode === 'create' && (
          <Button icon="arrow-left" isDisabled={isBusy} onPress={onBack}>
            {strings.back}
          </Button>
        )}
        <Button slot="close" isDisabled={isBusy} kbd="ESC">
          {strings.cancel}
        </Button>
        <Button variant="primary" type="submit" form={formId} isPending={isBusy} kbd="⌘↵">
          {mode === 'create' ? (isBusy ? strings.creating : strings.create) : isBusy ? strings.saving : strings.save}
        </Button>
      </>
    ),
    body: (
      <RelationshipForm
        {...rest}
        formId={formId}
        label={title}
        mode={mode}
        isBusy={isBusy}
        readOnlyReason={readOnlyReason}
      />
    ),
  };
}

/**
 * RelationshipSettings: a Modal with the two objects, how their records link
 * (four plain choices phrased with both objects), a name for each side and a
 * sentence restating the result. Create waits for the screen's answer; edit
 * renames the sides.
 */
export function RelationshipSettings({ isOpen, onOpenChange, ...props }: RelationshipSettingsProps) {
  const formId = useId();
  const { title, actions, body } = relationshipStep({ ...props, formId });
  return (
    <Modal
      title={title}
      isOpen={isOpen}
      // While the server answers, the dialog stays: a refusal has to land on its side.
      onOpenChange={(open) => {
        if (!open && props.isBusy === true) return;
        onOpenChange(open);
      }}
      actions={actions}
    >
      {body}
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
  focusSide = 'from',
  newObject,
  chosenTo,
}: RelationshipFormProps) {
  const isEditing = mode === 'edit';
  const isReadOnly = readOnlyReason !== undefined;
  const [fromId, setFromId] = useState<string | null>(from?.objectId ?? null);
  const [toId, setToId] = useState<string | null>(to?.objectId ?? null);
  // An object the screen just made for the related side takes it, once per hand over.
  const [takenChoice, setTakenChoice] = useState(chosenTo);
  if (chosenTo !== takenChoice) {
    setTakenChoice(chosenTo);
    if (chosenTo !== undefined) setToId(chosenTo.objectId);
  }
  const [cardinality, setCardinality] = useState<CardinalityKey>(initialCardinality);
  // A name follows the objects and the cardinality until the person types it (undefined); emptied, it stays empty.
  const [fromTitle, setFromTitle] = useState<string | undefined>(from?.title);
  const [toTitle, setToTitle] = useState<string | undefined>(to?.title);
  const [changed, setChanged] = useState<ReadonlySet<'from.title' | 'to.title'>>(new Set());
  const [local, setLocal] = useState<readonly FormRefusal[]>([]);

  const fromObject = objects.find((object) => object.id === fromId);
  const toObject = objects.find((object) => object.id === toId);
  const holdsOne = sidesHoldingOne(cardinality);
  const isSelf = fromId !== null && fromId === toId;
  // From an object to itself both defaults would be the same object's name: the person names each side.
  const fromName = fromTitle ?? (isSelf ? '' : defaultTitle(toObject, holdsOne.from));
  const toName = toTitle ?? (isSelf ? '' : defaultTitle(fromObject, holdsOne.to));
  // Create shows the choices and names once both objects are chosen: before, they would name no object.
  const isShaped = fromId !== null && toId !== null;
  const near = nounsOf(fromObject);
  const far = nounsOf(toObject);

  // A refusal typed locally wins until the next answer; each lands on its setting, the rest above them.
  const shown = local.length > 0 ? local : refusals;
  const errorOf = (field: RelationshipSettingsField) => shown.find((refusal) => refusal.attributeId === field)?.message;

  const submit = () => {
    if (isBusy || isReadOnly) return;
    const missing: FormRefusal[] = [
      ...(fromId === null
        ? [{ code: 'INPUT_INVALID', message: strings.objectMissing, attributeId: 'from.objectId' }]
        : []),
      ...(toId === null ? [{ code: 'INPUT_INVALID', message: strings.objectMissing, attributeId: 'to.objectId' }] : []),
    ];
    // Names are checked once both objects are chosen (they show only then).
    const problems: FormRefusal[] =
      missing.length > 0
        ? missing
        : [
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
    if (missing.length > 0) {
      // The Select draws its own refusal, which the Form neither focuses nor reads: focus goes to it, so its
      // description (the refusal) is read.
      const side = fromId === null ? 'from' : 'to';
      const label = side === 'from' ? strings.object : strings.relatedObject;
      setTimeout(() => {
        const triggers = document
          .getElementById(formId)
          ?.querySelectorAll<HTMLElement>('button[aria-haspopup="listbox"]');
        const trigger = [...(triggers ?? [])].find((button) =>
          (button.getAttribute('aria-labelledby') ?? '')
            .split(' ')
            .some((id) => document.getElementById(id)?.textContent === label),
        );
        trigger?.focus();
      }, 0);
      return;
    }
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
        {...(side === 'to'
          ? {
              info: (
                <InfoTip label={strings.relatedObject} example={strings.aboutRelatedExample}>
                  {strings.aboutRelated}
                </InfoTip>
              ),
            }
          : {})}
        items={
          side === 'to' && newObject !== undefined && !isEditing && !isReadOnly
            ? [...itemsWith(id), { id: NEW_OBJECT, label: newObject.label, icon: 'plus' }]
            : itemsWith(id)
        }
        value={id}
        placeholder={strings.chooseObject}
        isSearchable={items.length > 15}
        onChange={(next) => {
          if (next === NEW_OBJECT) newObject?.onChoose();
          else if (side === 'from') setFromId(next);
          else setToId(next);
        }}
        {...(isEditing || isPreset || isReadOnly ? { isReadOnly: true } : {})}
        {...(error === undefined ? {} : { error })}
      />
    );
  };
  const cardinalityError = errorOf('cardinality');
  // From an object to itself, "each person has one person" can't say which side is which: the choices name sides.
  const choiceOf = (each: CardinalityKey) => {
    const sides = sidesHoldingOne(each);
    return isSelf
      ? strings.selfChoice(sides.from, sides.to, near.singular, near.plural)
      : strings.choice({ ...near, isOne: sides.from }, { ...far, isOne: sides.to });
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
        {...(side === 'from' ? { hint: strings.nameHint } : {})}
        autoFocus={side === (isEditing ? focusSide : 'from') && choosable === undefined && !isReadOnly}
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
        // Fixed: the relationship's own choice alone, read only, saying why once (the radios would look live).
        <Field
          label={strings.cardinality}
          value={choiceOf(cardinality)}
          isMultiline
          isReadOnly
          {...(isEditing && !isReadOnly ? { readOnlyReason: strings.shapeFixed } : {})}
        />
      ) : (
        isShaped && (
          // Two short questions, one per side, rather than four sentences that differ by two words (owner ask A99).
          <>
            <RadioGroup
              label={isSelf ? strings.thisSideHolds : strings.eachHas(near.singular)}
              orientation="horizontal"
              value={holdsOne.from ? 'one' : 'many'}
              onChange={(next) => {
                setCardinality(cardinalityOf(next === 'one', holdsOne.to));
              }}
              {...(cardinalityError === undefined ? {} : { error: cardinalityError })}
            >
              <Radio value="one">{strings.one(far.singular)}</Radio>
              <Radio value="many">{strings.many(far.plural)}</Radio>
            </RadioGroup>
            <RadioGroup
              label={isSelf ? strings.reverseSideHolds : strings.eachHas(far.singular)}
              orientation="horizontal"
              value={holdsOne.to ? 'one' : 'many'}
              onChange={(next) => {
                setCardinality(cardinalityOf(holdsOne.from, next === 'one'));
              }}
            >
              <Radio value="one">{strings.one(near.singular)}</Radio>
              <Radio value="many">{strings.many(near.plural)}</Radio>
            </RadioGroup>
          </>
        )
      )}
      {isShaped && nameField('from')}
      {isShaped && nameField('to')}
    </Form>
  );
}
