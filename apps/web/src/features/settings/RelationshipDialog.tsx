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
  type RelationshipStepProps,
} from '@crm/ui';
import { useMatch, useRouteContext } from '@tanstack/react-router';
import { useMemo, useState } from 'react';
import { strings } from './attribute-strings.ts';
import { formRefusals } from './refusals.ts';

/** The settings the server names on its refusals, as the dialog shows them. */
const FIELDS = ['from.title', 'to.title', 'from.objectId', 'to.objectId', 'cardinality'] as const;

/** An object as the dialog names it and draws its tile. */
const settingsObject = (object: ObjectSummary): RelationshipSettingsObject => ({
  id: object.id,
  singularName: object.singularName,
  pluralName: object.pluralName,
  icon: object.icon,
  hue: object.hue,
});

/** The workspace's live objects, from the `/w/$slug` frame's loader, as the dialog names them. */
function useSettingsObjects(): readonly RelationshipSettingsObject[] {
  const workspaceObjects = useMatch({ from: '/w/$slug', shouldThrow: false })?.loaderData?.objects;
  return useMemo(() => (workspaceObjects ?? []).map(settingsObject), [workspaceObjects]);
}

/** What `useRelationshipCreate` needs from the attribute dialog that hands over to it. */
export interface RelationshipCreateOptions {
  readonly slug: string;
  /** The object whose table or settings opened it: the defining side. */
  readonly objectId: string;
  readonly isOpen: boolean;
  /** The name typed in the attribute dialog before Relationship was chosen, for this object's side. */
  readonly draftTitle: string | undefined;
  /** The server agreed: this object's side, new. */
  readonly onSaved: (attribute: AttributeDefinition, isNew: boolean) => void;
}

/**
 * Creating a relationship (spec 0014, AC-282), connected: the step
 * AttributeSettings shows in its own Modal once Relationship is chosen (so
 * focus and the scrim stay). This object is the defining side, named with
 * what was typed; the relationship's id is minted once per opening and sent
 * again on every retry; the write waits for the server, and refusals land
 * on the side they name.
 */
export function useRelationshipCreate({
  slug,
  objectId,
  isOpen,
  draftTitle,
  onSaved,
}: RelationshipCreateOptions): Omit<RelationshipStepProps, 'formId'> {
  const { data } = useRouteContext({ from: '__root__' });
  const objects = useSettingsObjects();
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
  return {
    mode: 'create',
    objects,
    from: { objectId, ...(draftTitle === undefined || draftTitle === '' ? {} : { title: draftTitle }) },
    isBusy,
    refusals,
    onSubmit: create,
  };
}

/** Props for the relationship dialog in edit mode. */
export interface RelationshipDialogProps {
  readonly slug: string;
  /** The object whose table or settings opened it. */
  readonly objectId: string;
  readonly isOpen: boolean;
  /** One side of a two way relationship, as the live list holds it now, with its pair's id and name. */
  readonly attribute: AttributeDefinition;
  /** Holds `schema.manage`: anyone else sees it read only. */
  readonly canManage: boolean;
  readonly onClose: () => void;
  /** The server agreed: this object's side as it is now. */
  readonly onSaved: (attribute: AttributeDefinition, isNew: boolean) => void;
}

/**
 * Renaming a relationship's two sides (spec 0014, AC-307), connected. Both
 * names come from the live list (each side carries its pair's name, so a
 * rename elsewhere shows here), the side that was opened takes focus, and
 * only the names that changed go out, in one `relationships.update`.
 */
export function RelationshipDialog({
  slug,
  objectId,
  isOpen,
  attribute,
  canManage,
  onClose,
  onSaved,
}: RelationshipDialogProps) {
  const { data } = useRouteContext({ from: '__root__' });
  const objects = useSettingsObjects();
  const [isBusy, setBusy] = useState(false);
  const [refusals, setRefusals] = useState<readonly FormRefusal[]>([]);
  const [wasOpen, setWasOpen] = useState(isOpen);
  if (isOpen !== wasOpen) {
    setWasOpen(isOpen);
    if (isOpen) {
      setBusy(false);
      setRefusals([]);
    }
  }
  const relationship = attribute.relationship;
  if (relationship === undefined) return null;
  const isFrom = relationship.side === 'from';
  const near = { objectId, title: attribute.title };
  const far = { objectId: relationship.targetObjectIds[0] ?? '', title: relationship.pairedTitle ?? '' };
  const submit = (values: RelationshipSettingsValues) => {
    if (isBusy) return;
    // Only the names that differ from what the sides hold now go out (compared as the server will, trimmed).
    const fromTitle = values.from.title.trim();
    const toTitle = values.to.title.trim();
    const names = {
      ...(fromTitle === (isFrom ? near : far).title ? {} : { from: fromTitle }),
      ...(toTitle === (isFrom ? far : near).title ? {} : { to: toTitle }),
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
      focusSide={relationship.side}
      isBusy={isBusy}
      refusals={refusals}
      onSubmit={submit}
      {...(canManage ? {} : { readOnlyReason: strings.memberReason })}
    />
  );
}
