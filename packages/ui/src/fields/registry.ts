// The field set: one entry per attribute type, registered once (spec 0003,
// AC-4). The grid, the record panel, forms, board cards, filters and the
// import preview all read a type's display, editor, operators and text
// conversion from here.
import type { AttributeType } from '@crm/contracts/values';
import { actorReferenceType } from './ActorReference/type.ts';
import { checkboxType } from './Checkbox/type.ts';
import { currencyType } from './Currency/type.ts';
import { dateType } from './Date/type.ts';
import { domainType } from './Domain/type.ts';
import { emailType } from './Email/type.ts';
import { fileType } from './File/type.ts';
import { interactionType } from './Interaction/type.ts';
import { locationType } from './Location/type.ts';
import { longTextType } from './LongText/type.ts';
import { numberType } from './Number/type.ts';
import { personalNameType } from './PersonalName/type.ts';
import { phoneType } from './Phone/type.ts';
import { ratingType } from './Rating/type.ts';
import { recordReferenceType } from './RecordReference/type.ts';
import { selectType } from './Select/type.ts';
import { statusType } from './Status/type.ts';
import { textType } from './Text/type.ts';
import { timestampType } from './Timestamp/type.ts';
import type { AttributeTypeDef } from './types.ts';
import { urlType } from './Url/type.ts';

/** Every attribute type's one display, one editor, operators and text conversion. */
export const FIELD_TYPES: { readonly [T in AttributeType]: AttributeTypeDef<T> } = {
  text: textType,
  long_text: longTextType,
  number: numberType,
  currency: currencyType,
  date: dateType,
  timestamp: timestampType,
  checkbox: checkboxType,
  select: selectType,
  status: statusType,
  rating: ratingType,
  email: emailType,
  phone: phoneType,
  domain: domainType,
  url: urlType,
  location: locationType,
  personal_name: personalNameType,
  actor_reference: actorReferenceType,
  record_reference: recordReferenceType,
  file: fileType,
  interaction: interactionType,
};

/** The registry entry for one type. */
export function fieldTypeOf<T extends AttributeType>(type: T): AttributeTypeDef<T> {
  return FIELD_TYPES[type];
}

/** True for types people never edit: the system writes them. */
export function isSystemOnly(type: AttributeType): boolean {
  return fieldTypeOf(type).editIn === 'none';
}
