// The fields a team page's routing rules may read (spec 0043, AC-1603; spec 0037, AC-1393): People's, Companies'
// and Deals', and whether Won means is set (Known's Customer), read by the page's route loader. Plain data reads,
// no React, so the loader imports it without a screen.
import type { AttributeDefinition, DataLayer } from '@crm/data';

/** People's, Companies' and Deals' attributes, as the reader may see them, and whether Won means is set. */
export interface RecordFields {
  readonly person: readonly AttributeDefinition[];
  readonly company: readonly AttributeDefinition[];
  readonly deal: readonly AttributeDefinition[];
  readonly wonMeansSet: boolean;
}

/** Reads the three objects' attributes; an object the workspace lacks gives none. */
export async function readRecordFields(data: DataLayer, slug: string): Promise<RecordFields> {
  const objects = await data.objects.list(slug);
  const of = (key: string) => {
    const object = objects.find((each) => each.standardKey === key);
    return object === undefined ? Promise.resolve([]) : data.attributes.list(slug, object.id);
  };
  const [person, company, deal, skills] = await Promise.all([
    of('people'),
    of('companies'),
    of('deals'),
    // Only offers Customer: a failed read offers it not, never fails the page.
    data.routing.skills.list(slug).catch(() => undefined),
  ]);
  return { person, company, deal, wonMeansSet: skills?.wonMeansSet === true };
}
