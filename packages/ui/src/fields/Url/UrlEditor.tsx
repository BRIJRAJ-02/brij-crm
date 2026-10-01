import { UrlValue } from '@crm/contracts/values';
import { ListEditor } from '../ListEditor.tsx';
import { TextLikeEditor } from '../TextLikeEditor.tsx';
import type { EditorProps } from '../types.ts';
import { asList, toCommittable } from '../values.ts';
import { urlHref } from './href.ts';

/** Turns typed text into a url, or the sentence to show. */
export function checkUrl(
  draft: string,
): { readonly ok: true; readonly value: string } | { readonly ok: false; readonly message: string } {
  const text = draft.trim();
  const withProtocol = /^[a-z][a-z\d+.-]*:/i.test(text) ? text : `https://${text}`;
  const parsed = UrlValue.safeParse(withProtocol);
  return parsed.success
    ? { ok: true, value: parsed.data }
    : { ok: false, message: parsed.error.issues[0]?.message ?? 'Enter a full link that starts with https://.' };
}

/** Url: a Field checked on blur; several values are removable chips with a field to add one. */
export function UrlEditor(props: EditorProps<'url'>) {
  const values = asList<string>(props.value);
  if (props.attribute.allowMultiple) {
    return (
      <ListEditor<'url', string>
        {...props}
        values={values}
        labelOf={(item) => item}
        hrefOf={urlHref}
        checkOne={checkUrl}
        type="url"
      />
    );
  }
  return (
    <TextLikeEditor<'url'>
      {...props}
      initial={values[0] ?? ''}
      type="url"
      check={(draft) => {
        if (draft.trim() === '') return toCommittable<'url'>(props.attribute, null);
        const one = checkUrl(draft);
        return one.ok ? toCommittable<'url'>(props.attribute, one.value) : one;
      }}
    />
  );
}
