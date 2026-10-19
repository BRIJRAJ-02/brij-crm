// Brief
// Purpose: a form's draft, as its builder edits it (spec 0023, AC-545): details, questions, matching, owner, after.
// Main task: add questions from the object's fields or kept on the submission, order and word them, then save.
// Leaves out: steps, conditions, consent blocks, linked targets, round robin and booking (milestone 2).
import type { FormAttributeChoice, FormBlock, FormDocument, MemberSummary, QuestionBlock } from '@crm/data';
import {
  Button,
  Callout,
  Card,
  Field,
  Menu,
  MenuItem,
  MenuSection,
  MenuSeparator,
  MenuTrigger,
  SegmentedControl,
  Select,
  Switch,
} from '@crm/ui';
import {
  addAttributeQuestion,
  addFormOnlyQuestion,
  addLayout,
  askedAttributes,
  blocksOf,
  changeBlock,
  FORM_ONLY_CHOICES,
  moveBlock,
  removeBlock,
} from './draft.ts';
import { strings } from './strings.ts';

/** Props for FormBuilder. */
export interface FormBuilderProps {
  readonly draft: FormDocument;
  readonly onChange: (draft: FormDocument) => void;
  /** The main object's fields a question may fill, with whether the person may write each. */
  readonly attributes: readonly FormAttributeChoice[];
  readonly members: readonly MemberSummary[];
  /** Only `forms.manage` changes a form: everyone else reads it. */
  readonly isReadOnly: boolean;
}

/** The value of "Nobody" in the owner list. */
const NOBODY = 'nobody';

/** The draft's editor: four cards, each one part of the document. */
export function FormBuilder({ draft, onChange, attributes, members, isReadOnly }: FormBuilderProps) {
  const byId = new Map(attributes.map((choice) => [choice.attributeId, choice]));
  const asked = askedAttributes(draft);
  const blocks = blocksOf(draft);
  const style = draft.style;

  const question = (block: QuestionBlock, index: number) => {
    const target = block.target;
    const choice = 'attributeId' in target ? byId.get(target.attributeId) : undefined;
    const typeLabel =
      'formOnly' in target ? (FORM_ONLY_CHOICES.find((each) => each.type === target.type)?.label ?? target.type) : '';
    const set = (change: Partial<QuestionBlock>) =>
      onChange(changeBlock(draft, block.id, (held) => ({ ...(held as QuestionBlock), ...change })));
    return (
      <Card
        key={block.id}
        tone="sunken"
        title={block.label}
        description={
          'formOnly' in target
            ? strings.formOnly(typeLabel)
            : choice === undefined
              ? strings.missingField
              : strings.mapsTo(choice.title)
        }
        {...(isReadOnly
          ? {}
          : { actions: <BlockActions draft={draft} block={block} index={index} onChange={onChange} /> })}
      >
        {'attributeId' in target && choice !== undefined && !choice.canWrite && (
          <Callout tone="warning">{strings.cantWrite}</Callout>
        )}
        <Field
          label={strings.label}
          value={block.label}
          onChange={(label) => set({ label })}
          isReadOnly={isReadOnly}
          maxLength={200}
        />
        <Field
          label={strings.help}
          value={block.help ?? ''}
          onChange={(help) => set(help === '' ? { help: undefined } : { help })}
          isReadOnly={isReadOnly}
          maxLength={500}
        />
        <Switch
          label={strings.required}
          isSelected={block.required}
          onChange={(required) => set({ required })}
          isReadOnly={isReadOnly}
        />
        {'attributeId' in target && (
          <SegmentedControl
            label={strings.update}
            segments={[
              { value: 'fill', label: strings.updateFill },
              { value: 'always', label: strings.updateAlways },
            ]}
            value={block.update}
            onChange={(update) => set({ update: update === 'always' ? 'always' : 'fill' })}
            isDisabled={isReadOnly}
          />
        )}
      </Card>
    );
  };

  const layout = (block: Exclude<FormBlock, QuestionBlock>, index: number) => (
    <Card
      key={block.id}
      tone="sunken"
      title={block.kind === 'heading' ? strings.heading : block.kind === 'text' ? strings.text : strings.divider}
      {...(isReadOnly
        ? {}
        : { actions: <BlockActions draft={draft} block={block} index={index} onChange={onChange} /> })}
    >
      {block.kind === 'divider' ? (
        <p>{strings.dividerLabel}</p>
      ) : (
        <Field
          label={block.kind === 'heading' ? strings.heading : strings.text}
          value={block.text}
          isMultiline={block.kind === 'text'}
          onChange={(text) => onChange(changeBlock(draft, block.id, (held) => ({ ...held, text }) as FormBlock))}
          isReadOnly={isReadOnly}
        />
      )}
    </Card>
  );

  const unique = attributes.filter((choice) => choice.isUnique);
  const after = draft.after;
  return (
    <>
      <Card title={strings.details}>
        <Field
          label={strings.title}
          hint={strings.titleHint}
          value={style.title}
          onChange={(title) => onChange({ ...draft, style: { ...style, title } })}
          isReadOnly={isReadOnly}
          maxLength={200}
        />
        <Field
          label={strings.description}
          value={style.description ?? ''}
          isMultiline
          onChange={(description) => {
            const { description: _old, ...rest } = style;
            onChange({ ...draft, style: description === '' ? rest : { ...rest, description } });
          }}
          isReadOnly={isReadOnly}
          maxLength={2_000}
        />
        <Field
          label={strings.buttonText}
          value={style.buttonText}
          onChange={(buttonText) => onChange({ ...draft, style: { ...style, buttonText } })}
          isReadOnly={isReadOnly}
          maxLength={40}
        />
      </Card>
      <Card
        title={strings.questions}
        description={strings.questionsDescription}
        {...(isReadOnly
          ? {}
          : {
              footer: (
                <MenuTrigger>
                  <Button icon="plus">{strings.addQuestion}</Button>
                  <Menu
                    label={strings.addQuestion}
                    onAction={(key) => {
                      const id = String(key);
                      if (id.startsWith('field:')) {
                        const choice = byId.get(id.slice('field:'.length));
                        if (choice !== undefined) onChange(addAttributeQuestion(draft, choice));
                      } else if (id.startsWith('only:')) {
                        const choice = FORM_ONLY_CHOICES.find((each) => `only:${each.type}` === id);
                        if (choice !== undefined) onChange(addFormOnlyQuestion(draft, choice.type, choice.label));
                      } else if (id === 'heading') onChange(addLayout(draft, 'heading', strings.newHeading));
                      else if (id === 'text') onChange(addLayout(draft, 'text', strings.newText));
                      else if (id === 'divider') onChange(addLayout(draft, 'divider', ''));
                    }}
                  >
                    <MenuSection label={strings.addField}>
                      {attributes.map((choice) => (
                        <MenuItem
                          key={choice.attributeId}
                          id={`field:${choice.attributeId}`}
                          isDisabled={asked.has(choice.attributeId) || !choice.canWrite}
                          {...(choice.canWrite ? {} : { description: strings.cantWrite })}
                        >
                          {choice.title}
                        </MenuItem>
                      ))}
                    </MenuSection>
                    <MenuSeparator />
                    <MenuSection label={strings.addFormOnly}>
                      {FORM_ONLY_CHOICES.map((choice) => (
                        <MenuItem key={choice.type} id={`only:${choice.type}`}>
                          {choice.label}
                        </MenuItem>
                      ))}
                    </MenuSection>
                    <MenuSeparator />
                    <MenuSection label={strings.addBlock}>
                      <MenuItem id="heading" icon="type">
                        {strings.heading}
                      </MenuItem>
                      <MenuItem id="text" icon="file-text">
                        {strings.text}
                      </MenuItem>
                      <MenuItem id="divider" icon="minus">
                        {strings.divider}
                      </MenuItem>
                    </MenuSection>
                  </Menu>
                </MenuTrigger>
              ),
            })}
      >
        {blocks.length === 0 && <p>{strings.noQuestions}</p>}
        {blocks.map((block, index) => (block.kind === 'question' ? question(block, index) : layout(block, index)))}
      </Card>
      <Card title={strings.matchKey} description={strings.matchHint}>
        <Select
          label={strings.matchKey}
          isLabelHidden
          items={unique.map((choice) => ({ id: choice.attributeId, label: choice.title }))}
          value={draft.targets.main.matchAttributeId}
          onChange={(matchAttributeId) => {
            if (matchAttributeId === null) return;
            onChange({ ...draft, targets: { main: { ...draft.targets.main, matchAttributeId } } });
          }}
          isReadOnly={isReadOnly}
        />
        <Select
          label={strings.owner}
          hint={strings.ownerHint}
          items={[
            { id: NOBODY, label: strings.nobody },
            ...members.map((member) => ({ id: member.id, label: member.name })),
          ]}
          value={draft.owner.kind === 'member' ? draft.owner.memberId : NOBODY}
          onChange={(value) =>
            onChange({
              ...draft,
              owner: value === null || value === NOBODY ? { kind: 'none' } : { kind: 'member', memberId: value },
            })
          }
          isReadOnly={isReadOnly}
        />
      </Card>
      <Card title={strings.after}>
        <SegmentedControl
          label={strings.after}
          segments={[
            { value: 'message', label: strings.afterMessage },
            { value: 'redirect', label: strings.afterRedirect },
          ]}
          value={after.kind}
          onChange={(kind) =>
            onChange({
              ...draft,
              after:
                kind === 'redirect'
                  ? { kind: 'redirect', url: after.kind === 'redirect' ? after.url : 'https://' }
                  : { kind: 'message', text: after.kind === 'message' ? after.text : 'Thanks, we got your message.' },
            })
          }
          isDisabled={isReadOnly}
        />
        {after.kind === 'message' ? (
          <Field
            label={strings.thanksText}
            value={after.text}
            isMultiline
            onChange={(text) => onChange({ ...draft, after: { kind: 'message', text } })}
            isReadOnly={isReadOnly}
            maxLength={2_000}
          />
        ) : (
          <Field
            label={strings.redirectUrl}
            hint={strings.redirectHint}
            type="url"
            value={after.url}
            onChange={(url) => onChange({ ...draft, after: { kind: 'redirect', url } })}
            isReadOnly={isReadOnly}
          />
        )}
      </Card>
    </>
  );
}

/** A block's menu: move up, move down, remove. */
function BlockActions({
  draft,
  block,
  index,
  onChange,
}: {
  readonly draft: FormDocument;
  readonly block: FormBlock;
  readonly index: number;
  readonly onChange: (draft: FormDocument) => void;
}) {
  const label = block.kind === 'question' ? block.label : block.kind;
  const count = blocksOf(draft).length;
  return (
    <MenuTrigger>
      <Button variant="ghost" icon="ellipsis" label={strings.blockActions(label)} />
      <Menu
        label={strings.blockActions(label)}
        onAction={(key) => {
          if (key === 'up') onChange(moveBlock(draft, block.id, -1));
          if (key === 'down') onChange(moveBlock(draft, block.id, 1));
          if (key === 'remove') onChange(removeBlock(draft, block.id));
        }}
      >
        <MenuItem id="up" icon="chevron-up" isDisabled={index === 0}>
          {strings.moveUp}
        </MenuItem>
        <MenuItem id="down" icon="chevron-down" isDisabled={index === count - 1}>
          {strings.moveDown}
        </MenuItem>
        <MenuSeparator />
        <MenuItem id="remove" icon="trash" isDanger>
          {strings.remove}
        </MenuItem>
      </Menu>
    </MenuTrigger>
  );
}
