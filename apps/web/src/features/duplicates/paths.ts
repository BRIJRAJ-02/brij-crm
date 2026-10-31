/** The Duplicates page of an object (AC-4907), narrowed to one record's pairs with `recordId` (AC-4906). */
export const duplicatesHref = (slug: string, objectSlug: string, recordId?: string): string =>
  `/w/${slug}/objects/${objectSlug}/duplicates${recordId === undefined ? '' : `?record=${encodeURIComponent(recordId)}`}`;
