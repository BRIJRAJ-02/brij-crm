// Which attributes can name an object's records (late trap #15): the one rule
// the engine checks when an object's name attribute changes, and the settings
// screen's choice offers. Plain TypeScript with no Zod, so the browser shares it.
//
// A record's name is read in several places, and each reads it its own way: a
// record read decodes the value and keeps a string or a personal name's full
// name (`nameOf`), while a link's far name, a sort and a name search read the
// value's `text_value` and its stored sort key. Only these types agree in all
// of them: their text is the name. A long text has no sort key (no prefix
// search), a phone decodes to an object (an unnamed record), and a select
// stores an option id.

/** The attribute types that can name records: their stored text is the name everywhere it is read. */
export const RECORD_NAME_TYPES = ['text', 'email', 'domain', 'url', 'personal_name'] as const;

/** What the rule needs of an attribute. */
export interface RecordNameCandidate {
  readonly type: string;
  readonly isMulti: boolean;
  readonly isSystem: boolean;
}

/**
 * True when an attribute can name its object's records: one of
 * `RECORD_NAME_TYPES`, holding one value (a name reads the first only), and
 * not a system attribute. Whether it is live, and on the right object, the
 * engine checks apart.
 */
export function canNameRecords(attribute: RecordNameCandidate): boolean {
  return !attribute.isSystem && !attribute.isMulti && (RECORD_NAME_TYPES as readonly string[]).includes(attribute.type);
}
