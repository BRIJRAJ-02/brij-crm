import { cleanText } from '../../lib/parse-input.ts';
import { ListEditor } from '../ListEditor.tsx';
import { TextLikeEditor } from '../TextLikeEditor.tsx';
import type { EditorProps, FieldAttribute } from '../types.ts';
import { asList, isCompactSurface, toCommittable } from '../values.ts';
import { urlHref } from './href.ts';
import { checkLink, checkSocial, describeLink, exampleHandle, networkOfAttribute, profileKindOf } from './social.ts';
import { strings } from './strings.ts';

/**
 * Turns typed text into a url, or the sentence to show. An attribute for a
 * social network (LinkedIn, X) takes a handle or a profile link and keeps
 * the profile's one canonical link; any other takes a link or a bare domain.
 */
export function checkUrl(
  draft: string,
  attribute?: Pick<FieldAttribute, 'apiSlug' | 'objectKey' | 'name'>,
): { readonly ok: true; readonly value: string } | { readonly ok: false; readonly message: string } {
  const network = attribute === undefined ? undefined : networkOfAttribute(attribute);
  const text = cleanText(draft);
  return attribute === undefined || network === undefined
    ? checkLink(text)
    : checkSocial(network, text, { label: attribute.name, kind: profileKindOf(attribute) });
}

/** The placeholder and hint for this attribute: a network's handle, or an example domain. */
function guidance(attribute: FieldAttribute) {
  const network = networkOfAttribute(attribute);
  return network === undefined
    ? { placeholder: strings.placeholder, hint: strings.hint }
    : {
        placeholder: exampleHandle(network, profileKindOf(attribute)),
        hint: strings.socialHint(attribute.name),
      };
}

/** Url: a Field checked on blur; several values are removable chips with a field to add one. */
export function UrlEditor(props: EditorProps<'url'>) {
  const values = asList<string>(props.value);
  const { placeholder, hint } = guidance(props.attribute);
  // The hint sits under a boxed field; a cell, a panel row or a filter has no room for it.
  const guided = isCompactSurface(props.surface) ? { placeholder } : { placeholder, hint };
  // A plain link brings the phone's web address keyboard; a handle needs the ordinary one.
  const keyboard = networkOfAttribute(props.attribute) === undefined ? { inputMode: 'url' as const } : {};
  const check = (draft: string) => checkUrl(draft, props.attribute);
  if (props.attribute.allowMultiple) {
    return (
      <ListEditor<'url', string>
        {...props}
        values={values}
        labelOf={(item) => describeLink(item).label}
        markOf={(item) => describeLink(item).network}
        hrefOf={urlHref}
        checkOne={check}
        type="text"
        {...keyboard}
        {...guided}
      />
    );
  }
  return (
    <TextLikeEditor<'url'>
      {...props}
      initial={values[0] ?? ''}
      // Text, not url: a handle or a bare domain is welcome, and the browser's url check would refuse it.
      type="text"
      {...keyboard}
      {...guided}
      check={(draft) => {
        if (draft.trim() === '') return toCommittable<'url'>(props.attribute, null);
        const one = check(draft);
        return one.ok ? toCommittable<'url'>(props.attribute, one.value) : one;
      }}
    />
  );
}
