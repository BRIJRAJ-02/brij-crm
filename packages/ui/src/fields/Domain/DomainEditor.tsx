import { DomainValue } from '@crm/contracts/values';
import { ListEditor } from '../ListEditor.tsx';
import { TextLikeEditor } from '../TextLikeEditor.tsx';
import type { EditorProps } from '../types.ts';
import { asList, toCommittable } from '../values.ts';
import { domainHref } from './href.ts';

/** The name as the browser reads it (international names as `xn--`), or as typed when it isn't one. */
function hostnameOf(name: string): string {
  if (name.includes(' ')) return name;
  try {
    return new URL(`http://${name}`).hostname;
  } catch {
    return name;
  }
}

/** Turns typed text into a domain, or the sentence to show. */
export function checkDomain(
  draft: string,
): { readonly ok: true; readonly value: string } | { readonly ok: false; readonly message: string } {
  // Strip what people paste with a domain: the protocol and anything after the name.
  const name =
    draft
      .trim()
      .replace(/^[a-z][a-z\d+.-]*:\/\//i, '')
      .split(/[/?#]/)[0] ?? '';
  const parsed = DomainValue.safeParse(hostnameOf(name));
  return parsed.success
    ? { ok: true, value: parsed.data }
    : { ok: false, message: parsed.error.issues[0]?.message ?? 'Enter a domain, such as example.com.' };
}

/** Domain: a Field checked on blur; several values are removable chips with a field to add one. */
export function DomainEditor(props: EditorProps<'domain'>) {
  const values = asList<string>(props.value);
  if (props.attribute.allowMultiple) {
    return (
      <ListEditor<'domain', string>
        {...props}
        values={values}
        labelOf={(item) => item}
        hrefOf={domainHref}
        checkOne={checkDomain}
        type="text"
      />
    );
  }
  return (
    <TextLikeEditor<'domain'>
      {...props}
      initial={values[0] ?? ''}
      type="text"
      check={(draft) => {
        if (draft.trim() === '') return toCommittable<'domain'>(props.attribute, null);
        const one = checkDomain(draft);
        return one.ok ? toCommittable<'domain'>(props.attribute, one.value) : one;
      }}
    />
  );
}
