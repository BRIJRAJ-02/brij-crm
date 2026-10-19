// Brief
// Purpose: a form's blocks as visitors see them, each question through its type's one editor (spec 0023).
// Main task: collect answers in each question's canonical shape and hand them over on submit.
// Leaves out: checking or sending them (the hosted page and the builder's preview each do their own).
import { formStrings, type PublicForm, type PublicQuestion } from '@crm/data/public-form';
import { AttributeEditor, Form, Separator, type FieldAttribute, type FormRefusal } from '@crm/ui';
import { useRef, useState, type ReactNode } from 'react';

/** A question as the field set's attribute: its one editor, asked for on submit. */
export function attributeOf(question: PublicQuestion): FieldAttribute {
  return {
    id: question.id,
    name: question.label,
    type: question.type,
    allowMultiple: question.isMulti,
    ...(question.options === undefined
      ? {}
      : {
          options: question.options.map((option) => ({
            id: option.id,
            label: option.label,
            hue: option.hue ?? 'gray',
            archived: false,
          })),
        }),
    isRequired: question.required,
    isRequiredOnSubmit: true,
    isUnique: false,
    isReadOnly: false,
  };
}

/** Props for FormFields. */
export interface FormFieldsProps {
  readonly form: PublicForm;
  readonly isBusy: boolean;
  /** Refusals about no one question (a rate limit, a lost connection), shown above the fields. */
  readonly refusals: readonly FormRefusal[];
  /** Each question's message, by question id. */
  readonly fieldErrors: Readonly<Record<string, string>>;
  /** A question's answer changed: its message goes. */
  readonly onAnswered: (questionId: string) => void;
  /** The answers as committed, by question id. */
  readonly onSubmit: (answers: Readonly<Record<string, unknown>>) => void;
  /** Drawn inside the form after the questions (the hosted page's honeypot). */
  readonly children?: ReactNode;
}

/** A form's steps and blocks, in order, inside the library's Form. */
export function FormFields({ form, isBusy, refusals, fieldErrors, onAnswered, onSubmit, children }: FormFieldsProps) {
  const [values, setValues] = useState<Readonly<Record<string, unknown>>>({});
  // As committed, read at submit: a blur's commit lands just before it.
  const answers = useRef<Record<string, unknown>>({});
  return (
    <Form
      submitLabel={form.buttonText}
      busyLabel={formStrings(form.language).sending}
      isBusy={isBusy}
      refusals={refusals}
      onSubmit={() => {
        onSubmit(answers.current);
      }}
      label={form.title}
    >
      {form.steps.flatMap((step) =>
        step.blocks.map((block) => {
          switch (block.kind) {
            case 'heading':
              return <h2 key={block.id}>{block.text}</h2>;
            case 'text':
              return <p key={block.id}>{block.text}</p>;
            case 'divider':
              return <Separator key={block.id} />;
            case 'question': {
              const error = fieldErrors[block.id];
              return (
                <div key={block.id}>
                  <AttributeEditor
                    attribute={attributeOf(block)}
                    value={values[block.id] ?? null}
                    surface="form"
                    onCommit={(value) => {
                      answers.current = { ...answers.current, [block.id]: value };
                      setValues((held) => ({ ...held, [block.id]: value }));
                      onAnswered(block.id);
                    }}
                    {...(error === undefined ? {} : { error })}
                  />
                  {block.help !== undefined && <p>{block.help}</p>}
                </div>
              );
            }
          }
        }),
      )}
      {children}
    </Form>
  );
}
