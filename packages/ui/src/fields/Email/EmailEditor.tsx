import { EmailValue } from '@crm/contracts/values';
import { ListEditor } from '../ListEditor.tsx';
import { TextLikeEditor } from '../TextLikeEditor.tsx';
import type { EditorProps } from '../types.ts';
import { asList, toCommittable } from '../values.ts';
import { emailHref } from './href.ts';

/** Turns typed text into a email, or the sentence to show. */
export function checkEmail(
  draft: string,
): { readonly ok: true; readonly value: string } | { readonly ok: false; readonly message: string } {
  const parsed = EmailValue.safeParse(draft);
  return parsed.success
    ? { ok: true, value: parsed.data }
    : { ok: false, message: parsed.error.issues[0]?.message ?? 'Enter an email address, such as ada@example.com.' };
}

/** Email: a Field checked on blur; several values are removable chips with a field to add one. */
export function EmailEditor(props: EditorProps<'email'>) {
  const values = asList<string>(props.value);
  if (props.attribute.allowMultiple) {
    return (
      <ListEditor<'email', string>
        {...props}
        values={values}
        labelOf={(item) => item}
        hrefOf={emailHref}
        checkOne={checkEmail}
        type="email"
      />
    );
  }
  return (
    <TextLikeEditor<'email'>
      {...props}
      initial={values[0] ?? ''}
      type="email"
      check={(draft) => {
        if (draft.trim() === '') return toCommittable<'email'>(props.attribute, null);
        const one = checkEmail(draft);
        return one.ok ? toCommittable<'email'>(props.attribute, one.value) : one;
      }}
    />
  );
}
