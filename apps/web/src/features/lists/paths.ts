// The lists' addresses (spec 0048, decision 14): by the list's API name, like objects.
import type { ListView } from '@crm/data';

/** A list's address: it opens the member's last opened view, else the default (AC-4806). */
export const listHref = (slug: string, list: Pick<ListView, 'apiSlug'>) => `/w/${slug}/lists/${list.apiSlug}`;

/** A list's import (spec 0048, AC-4833): the object's import page, aimed at the list. */
export const listImportHref = (slug: string, list: Pick<ListView, 'apiSlug'>) => `${listHref(slug, list)}/import`;

/** One view of a list. */
export const listViewHref = (slug: string, listSlug: string, viewId: string) =>
  `/w/${slug}/lists/${listSlug}/views/${viewId}`;
