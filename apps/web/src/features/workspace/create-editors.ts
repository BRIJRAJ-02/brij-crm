// Which editors a create form asks for, and in what order (spec 0012,
// AC-240): shared by an object's table and board and by a record picker's
// "Create deal…", so it lives apart from any screen.
import { isAskedOnCreate, type AttributeDefinition, type ObjectSummary } from '@crm/data';
import { isSystemOnly } from '@crm/ui';

/**
 * The create dialog's editors for an object (spec 0012, AC-240): the primary
 * attribute, then the required ones, then each reference to another object
 * that holds one (a deal's company, a person's Company: asked at once, as
 * Attio's create person does; a company's Parent company waits with the
 * rest), then the rest behind "Add more fields", each by position, and only those the field
 * set edits in a form here (no system values; a member through the member
 * picker; a record reference that can link through the record picker, sent
 * with the create).
 */
export function createEditors(
  object: ObjectSummary,
  attributes: readonly AttributeDefinition[],
): { readonly first: readonly AttributeDefinition[]; readonly more: readonly AttributeDefinition[] } {
  const editable = attributes
    .filter(
      (attribute) =>
        isAskedOnCreate(attribute) &&
        !attribute.isArchived &&
        !isSystemOnly(attribute.type) &&
        // Files arrive with #32's uploads.
        attribute.type !== 'file',
    )
    .sort((a, b) => a.position - b.position);
  const isPrimary = (attribute: AttributeDefinition) => attribute.id === object.primaryAttributeId;
  const isLinkToOne = (attribute: AttributeDefinition) =>
    attribute.type === 'record_reference' &&
    !attribute.isMulti &&
    attribute.relationship?.targetObjectIds[0] !== object.id;
  const isFirst = (attribute: AttributeDefinition) =>
    isPrimary(attribute) || attribute.isRequired || isLinkToOne(attribute);
  const primary = editable.filter(isPrimary);
  const required = editable.filter((attribute) => !isPrimary(attribute) && attribute.isRequired);
  const links = editable.filter(
    (attribute) => !isPrimary(attribute) && !attribute.isRequired && isLinkToOne(attribute),
  );
  return { first: [...primary, ...required, ...links], more: editable.filter((attribute) => !isFirst(attribute)) };
}
