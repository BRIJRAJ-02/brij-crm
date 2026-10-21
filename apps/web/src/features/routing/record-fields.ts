// The fields a team page's routing rules may read (spec 0043, AC-1603): People's and Companies', read by the
// page's route loader. Plain data reads, no React, so the loader imports it without a screen.
import type { AttributeDefinition, DataLayer } from '@crm/data';

/** People's and Companies' attributes, as the reader may see them. */
export interface RecordFields {
  readonly person: readonly AttributeDefinition[];
  readonly company: readonly AttributeDefinition[];
}

/** Reads both objects' attributes; an object the workspace lacks gives none. */
export async function readRecordFields(data: DataLayer, slug: string): Promise<RecordFields> {
  const objects = await data.objects.list(slug);
  const of = (key: string) => {
    const object = objects.find((each) => each.standardKey === key);
    return object === undefined ? Promise.resolve([]) : data.attributes.list(slug, object.id);
  };
  const [person, company] = await Promise.all([of('people'), of('companies')]);
  return { person, company };
}
