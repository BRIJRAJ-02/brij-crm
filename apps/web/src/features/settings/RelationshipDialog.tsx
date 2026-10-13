// Brief
// Purpose: create a relationship from an object's "Add attribute", or rename the two sides of one from its settings.
// Main task: choose the related object and how records link, name each side, then Create (or Save the names).
// Leaves out: changing the objects or the cardinality (#14), one way references (engine only), linking records (milestone 2).
import type { AttributeDefinition, ObjectSummary } from '@crm/data';
import {
  RelationshipSettings,
  type FormRefusal,
  type RelationshipSettingsObject,
  type RelationshipSettingsValues,
} from '@crm/ui';
import { useMatch, useRouteContext } from '@tanstack/react-router';
import { useEffect, useMemo, useState } from 'react';
import { strings } from './attribute-strings.ts';
import { formRefusals } from './refusals.ts';

/** The settings the server names on its refusals, as the dialog shows them. */
const FIELDS = ['from.title', 'to.title', 'from.objectId', 'to.objectId', 'cardinality'] as const;

/** Props for the relationship dialog. */
export interface RelationshipDialogProps {
  readonly slug: string;
  /** The object whose table or settings opened it: the defining side of a new relationship. */
  readonly objectId: string;
  readonly isOpen: boolean;
  /** Editing: one side of the relationship, as the live list holds it now. Creating when absent. */
  readonly attribute?: AttributeDefinition | undefined;
  /** Creating: the name typed in the attribute dialog before Relationship was chosen, for this object's side. */
  readonly draftTitle?: string | undefined;
  /** Holds `schema.manage`: anyone else sees an existing relationship read only. */
  readonly canManage: boolean;
  readonly onClose: () => void;
  /** The server agreed: this object's side as it is now, and whether it is new. */
  readonly onSaved: (attribute: AttributeDefinition, isNew: boolean) => void;
}

/** An object as the dialog names it and draws its tile. */
const settingsObject = (object: ObjectSummary): RelationshipSettingsObject => ({
  id: object.id,
  singularName: object.singularName,
  pluralName: object.pluralName,
  icon: object.icon,
  hue: object.hue,
});

/**
 * The connected RelationshipSettings (spec 0014). Creating: this object is
 * the defining side, the relationship's id is minted once per opening and
 * sent again on every retry, and the write waits for the server. Editing:
 * both sides' names, read from the two objects' live attribute lists, and
 * only the names that changed go out.
 */
export function RelationshipDialog({
  slug,
  objectId,
  isOpen,
  attribute,
  draftTitle,
  canManage,
  onClose,
  onSaved,
}: RelationshipDialogProps) {
  const { data } = useRouteContext({ from: '__root__' });
  const workspaceObjects = useMatch({ from: '/w/$slug', shouldThrow: false })?.loaderData?.objects;
  const objects = useMemo(() => (workspaceObjects ?? []).map(settingsObject), [workspaceObjects]);
  const [id, setId] = useState(() => data.relationships.newId());
  const [isBusy, setBusy] = useState(false);
  const [refusals, setRefusals] = useState<readonly FormRefusal[]>([]);
  // Each opening starts afresh, with its own id.
  const [wasOpen, setWasOpen] = useState(isOpen);
  if (isOpen !== wasOpen) {
    setWasOpen(isOpen);
    if (isOpen) {
      setId(data.relationships.newId());
      setBusy(false);
      setRefusals([]);
    }
  }

  // Editing: the other side, from its object's live attributes (the client holds no relationship pairs yet).
  const relationship = attribute?.relationship;
  const farObjectId = relationship?.targetObjectIds[0];
  // The read of the other side, by its id, so an answer about another attribute is never shown for this one.
  const [read, setRead] = useState<
    { readonly id: string; readonly paired?: AttributeDefinition; readonly failed: boolean } | undefined
  >(undefined);
  const pairedId = relationship?.pairedAttributeId;
  useEffect(() => {
    if (!isOpen || pairedId === undefined || farObjectId === undefined) return;
    let isCurrent = true;
    data.attributes.list(slug, farObjectId).then(
      (list) => {
        if (!isCurrent) return;
        const paired = list.find((each) => each.id === pairedId);
        setRead(paired === undefined ? { id: pairedId, failed: true } : { id: pairedId, paired, failed: false });
      },
      () => {
        if (isCurrent) setRead({ id: pairedId, failed: true });
      },
    );
    return () => {
      isCurrent = false;
    };
  }, [data, slug, isOpen, farObjectId, pairedId]);
  const current = read !== undefined && read.id === pairedId ? read : undefined;
  const paired = current?.paired;
  const pairedFailed = pairedId === undefined || current?.failed === true;

  if (attribute !== undefined && relationship !== undefined) {
    // Shown once the other side's name is known; a failed read shows the names read only instead of guessing one.
    if (paired === undefined && !pairedFailed) return null;
    const isFrom = relationship.side === 'from';
    const near = { objectId, title: attribute.title };
    const far = { objectId: farObjectId ?? '', title: paired?.title ?? '' };
    const submit = (values: RelationshipSettingsValues) => {
      if (isBusy) return;
      // Only the names that differ from what the sides hold now go out.
      const names = {
        ...(values.from.title === (isFrom ? near : far).title ? {} : { from: values.from.title }),
        ...(values.to.title === (isFrom ? far : near).title ? {} : { to: values.to.title }),
      };
      if (names.from === undefined && names.to === undefined) {
        onClose();
        return;
      }
      setBusy(true);
      setRefusals([]);
      data.relationships.update(slug, relationship.id, names).then(
        (renamed) => {
          setBusy(false);
          onSaved(isFrom ? renamed.from : renamed.to, false);
        },
        (error: unknown) => {
          setBusy(false);
          setRefusals(formRefusals(error, FIELDS));
        },
      );
    };
    return (
      <RelationshipSettings
        isOpen={isOpen}
        onOpenChange={(open) => {
          if (!open) onClose();
        }}
        mode="edit"
        objects={objects}
        from={isFrom ? near : far}
        to={isFrom ? far : near}
        cardinality={relationship.cardinality}
        isBusy={isBusy}
        refusals={refusals}
        onSubmit={submit}
        {...(canManage && !pairedFailed
          ? {}
          : { readOnlyReason: canManage ? strings.pairedFailed : strings.memberReason })}
      />
    );
  }

  const create = (values: RelationshipSettingsValues) => {
    if (isBusy) return;
    setBusy(true);
    setRefusals([]);
    data.relationships.create(slug, { id, cardinality: values.cardinality, from: values.from, to: values.to }).then(
      (made) => {
        setBusy(false);
        // This object is the defining side.
        onSaved(made.from, true);
      },
      (error: unknown) => {
        setBusy(false);
        setRefusals(formRefusals(error, FIELDS));
      },
    );
  };
  return (
    <RelationshipSettings
      isOpen={isOpen}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      mode="create"
      objects={objects}
      from={{ objectId, ...(draftTitle === undefined || draftTitle === '' ? {} : { title: draftTitle }) }}
      isBusy={isBusy}
      refusals={refusals}
      onSubmit={create}
    />
  );
}
