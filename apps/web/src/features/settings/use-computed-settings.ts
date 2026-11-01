// What AttributeSettings needs for Lookup, Rollup and Formula (spec 0015): this object's two way relationship sides
// with the related objects' attributes (read through the data layer's cached lists), the attributes a formula may
// name, and the preview, asked 400 ms after each change of the definition.
import {
  toFieldAttribute,
  type AttributeDefinition,
  type ComputedDefinitionInput,
  type DataLayer,
  type ObjectSummary,
} from '@crm/data';
import { useComputedPreview } from '@crm/data/react';
import type { AttributeSettingsComputed, ComputedDraft, ComputedSide } from '@crm/ui';
import { useCallback, useEffect, useMemo, useState } from 'react';

/** What the hook reads: where, which object and its attributes, and whether computed attributes are offered here. */
export interface ComputedSettingsInput {
  readonly data: DataLayer;
  readonly slug: string;
  readonly objectId: string;
  readonly isOffered: boolean;
  readonly objectAttributes: readonly AttributeDefinition[] | undefined;
  readonly objects: readonly ObjectSummary[] | undefined;
  /** Editing a computed attribute: left out of what its own formula may name. */
  readonly selfId?: string | undefined;
  readonly onNewRelationship?: (() => void) | undefined;
  readonly onRefill?: (() => void) | undefined;
}

/** The computed settings, or undefined where they aren't offered. */
export function useComputedSettings(input: ComputedSettingsInput): AttributeSettingsComputed | undefined {
  const { data, slug, objectId, isOffered, objectAttributes, objects, selfId, onNewRelationship, onRefill } = input;
  const sideDefinitions = useMemo(
    () =>
      (objectAttributes ?? []).filter(
        (each) =>
          each.type === 'record_reference' &&
          !each.isArchived &&
          each.relationship?.pairedAttributeId !== undefined &&
          each.relationship.targetObjectIds.length === 1,
      ),
    [objectAttributes],
  );
  const farIds = useMemo(
    () => [...new Set(sideDefinitions.flatMap((each) => each.relationship?.targetObjectIds ?? []))],
    [sideDefinitions],
  );
  const farKey = farIds.join(',');
  // The related objects' attributes, read once each from the cached lists while the dialog offers computed kinds.
  const [far, setFar] = useState<ReadonlyMap<string, readonly AttributeDefinition[]>>(new Map());
  useEffect(() => {
    if (!isOffered || farKey === '') return;
    let isCurrent = true;
    Promise.all(farKey.split(',').map((id) => data.attributes.list(slug, id).then((list) => [id, list] as const))).then(
      (lists) => {
        if (isCurrent) setFar(new Map(lists));
      },
      () => undefined,
    );
    return () => {
      isCurrent = false;
    };
  }, [data, slug, isOffered, farKey]);

  const sides = useMemo(
    (): readonly ComputedSide[] =>
      sideDefinitions.map((each) => {
        const farObjectId = each.relationship?.targetObjectIds[0] ?? '';
        const farAttributes = far.get(farObjectId) ?? [];
        return {
          id: each.id,
          title: each.title,
          holdsMany: each.isMulti,
          attributes: farAttributes.map((attribute) => ({
            id: attribute.id,
            title: attribute.title,
            type: attribute.type,
            isMulti: attribute.isMulti,
            isSystem: attribute.isSystem,
            apiSlug: attribute.apiSlug,
            isArchived: attribute.isArchived,
          })),
          filterAttributes: farAttributes
            .filter((attribute) => !attribute.isArchived && attribute.type !== 'record_reference')
            .map((attribute) => toFieldAttribute(attribute)),
        };
      }),
    [sideDefinitions, far],
  );

  const formulaAttributes = useMemo(
    () =>
      (objectAttributes ?? [])
        .filter((each) => each.id !== selfId)
        .map((each) => {
          const currency = each.config.defaultCurrency;
          return {
            id: each.id,
            apiSlug: each.apiSlug,
            title: each.title,
            type: each.type,
            isMulti: each.isMulti,
            isArchived: each.isArchived,
            ...(typeof currency === 'string' ? { defaultCurrency: currency } : {}),
          };
        }),
    [objectAttributes, selfId],
  );

  const [draft, setDraft] = useState<ComputedDefinitionInput | undefined>(undefined);
  const make = useMemo(
    () => (isOffered ? () => data.computed.preview(slug, objectId) : undefined),
    [isOffered, data, slug, objectId],
  );
  const preview = useComputedPreview(make, draft);
  const onDraftChange = useCallback((next: ComputedDraft | undefined) => {
    setDraft(next);
  }, []);
  const pluralName = objects?.find((each) => each.id === objectId)?.pluralName ?? '';

  return useMemo(() => {
    if (!isOffered) return undefined;
    return {
      pluralName,
      sides,
      formulaAttributes,
      preview: {
        status: preview.status,
        ...(preview.result === undefined ? {} : { result: preview.result }),
      },
      onRetryPreview: preview.retry,
      onDraftChange,
      ...(onNewRelationship === undefined ? {} : { onNewRelationship }),
      ...(onRefill === undefined ? {} : { onRefill }),
    } satisfies AttributeSettingsComputed;
  }, [isOffered, pluralName, sides, formulaAttributes, preview, onDraftChange, onNewRelationship, onRefill]);
}
