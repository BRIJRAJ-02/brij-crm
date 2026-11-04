// Brief
// Purpose: a form's endings and its score (spec 0063, AC-6315, AC-6316): the thank you is always there, and up to four endings a jump or a routing rule can send a visitor to instead.
// Main task: word each ending, give it a button, and say where the score is filed.
// Leaves out: which jump reaches which ending (the step dividers own that, Form tab) and what the visitor sees (the hosted page draws it).
import type { BookingPageView, FormDocument, FormTargetChoices } from '@crm/data';
import { FORM_ENDINGS_MAX, type FormEnding } from '@crm/data/forms';
import { Button, Card, Field, focusLater, SegmentedControl, Select, SettingsSection, type Toasts } from '@crm/ui';
import { useRef } from 'react';
import { mintEndingId } from './draft.ts';
import { strings } from './strings.ts';
import { strings as questionStrings } from '../questions/strings.ts';

/** Props for the endings card: the draft's endings and score filing, and the booking pages a button may open. */
export interface EndingsCardProps {
  readonly draft: FormDocument;
  readonly target: FormTargetChoices;
  /** The live booking pages the reader may send a visitor to, as Settings' own After someone sends it lists them. */
  readonly pages: readonly BookingPageView[];
  readonly isReadOnly: boolean;
  /** Removing an ending offers Undo here, since it takes its words with it and leaves every jump to it pointing nowhere. */
  readonly toasts: Toasts;
  readonly onDraftChange: (next: FormDocument | ((before: FormDocument) => FormDocument)) => void;
}

/** Which button an ending carries, as the control names it. */
type ButtonKind = 'none' | 'url' | 'booking';

/** One ending's own fields: its words, then its button. */
function EndingFields({
  ending,
  place,
  pages,
  isReadOnly,
  onChange,
  onRemove,
}: {
  readonly ending: FormEnding;
  readonly place: number;
  readonly pages: readonly BookingPageView[];
  readonly isReadOnly: boolean;
  readonly onChange: (change: Partial<FormEnding>) => void;
  readonly onRemove: () => void;
}) {
  const kind: ButtonKind = ending.button?.kind ?? 'none';
  const firstPage = pages[0]?.id;
  return (
    <SettingsSection
      title={strings.endingName(place, ending.heading)}
      {...(isReadOnly
        ? {}
        : {
            actions: (
              <Button variant="ghost" icon="trash" onPress={onRemove}>
                {strings.removeEnding}
              </Button>
            ),
          })}
    >
      <Field
        label={strings.endingHeading}
        placeholder={strings.endingHeadingPlaceholder}
        value={ending.heading}
        maxLength={120}
        isReadOnly={isReadOnly}
        onChange={(heading) => {
          onChange({ heading });
        }}
      />
      <Field
        label={strings.endingLine}
        placeholder={strings.endingLinePlaceholder}
        value={ending.line ?? ''}
        maxLength={2_000}
        isMultiline
        isReadOnly={isReadOnly}
        onChange={(line) => {
          onChange({ line });
        }}
      />
      <SegmentedControl
        label={strings.endingButton}
        size="compact"
        segments={[
          { value: 'none', label: strings.endingButtonNone },
          { value: 'url', label: strings.endingButtonUrl },
          // A button can book only where there is a live page to book on.
          ...(firstPage === undefined ? [] : [{ value: 'booking', label: strings.endingButtonBooking }]),
        ]}
        value={kind}
        isReadOnly={isReadOnly}
        onChange={(next) => {
          if (next === 'url') onChange({ button: { kind: 'url', url: 'https://' } });
          else if (next === 'booking' && firstPage !== undefined) {
            onChange({ button: { kind: 'booking', bookingPageId: firstPage } });
          } else onChange({ button: undefined });
        }}
      />
      {ending.button?.kind === 'url' && (
        <Field
          label={strings.endingAddress}
          value={ending.button.url}
          maxLength={2_048}
          isReadOnly={isReadOnly}
          onChange={(url) => {
            onChange({
              button: {
                kind: 'url',
                url,
                ...(ending.button?.label === undefined ? {} : { label: ending.button.label }),
              },
            });
          }}
        />
      )}
      {ending.button?.kind === 'booking' && (
        <Select
          savesOnPick
          label={strings.endingButtonBooking}
          items={pages.map((page) => ({ id: page.id, label: page.title }))}
          value={ending.button.bookingPageId}
          isReadOnly={isReadOnly}
          onChange={(bookingPageId) => {
            if (bookingPageId !== null) onChange({ button: { kind: 'booking', bookingPageId } });
          }}
        />
      )}
      {ending.button !== undefined && (
        <Field
          label={strings.endingButtonLabel}
          placeholder={strings.endingButtonLabelPlaceholder}
          value={ending.button.label ?? ''}
          maxLength={40}
          isReadOnly={isReadOnly}
          onChange={(label) => {
            const button = ending.button;
            if (button === undefined) return;
            onChange({ button: { ...button, ...(label === '' ? { label: undefined } : { label }) } });
          }}
        />
      )}
    </SettingsSection>
  );
}

/**
 * The endings beside the thank you, and where the score is filed (spec 0063, AC-6315, AC-6316). Each ending is
 * worded here; which answers reach it is a step's Jumps on the Form tab, or a routing rule.
 */
export function EndingsCard({ draft, target, pages, isReadOnly, toasts, onDraftChange }: EndingsCardProps) {
  const addRef = useRef<HTMLButtonElement>(null);
  const endings = draft.endings ?? [];
  const isFull = endings.length >= FORM_ENDINGS_MAX;
  const numbers = target.items.filter((item) => item.type === 'number' && item.canWrite);
  const change = (id: string, next: Partial<FormEnding>) => {
    onDraftChange((before) => ({
      ...before,
      endings: (before.endings ?? []).map((ending) => {
        if (ending.id !== id) return ending;
        const merged = { ...ending, ...next };
        // An empty line or no button is absent, not an empty value: the document holds only what the form has.
        const { line, button, ...rest } = merged;
        return {
          ...rest,
          ...(line === undefined || line.trim() === '' ? {} : { line }),
          ...(button === undefined ? {} : { button }),
        };
      }),
    }));
  };
  return (
    <Card
      title={strings.endingsTitle}
      description={`${isFull ? strings.endingsFull(FORM_ENDINGS_MAX) : strings.endingsLine} ${strings.recallHint}`}
    >
      {endings.map((ending, place) => (
        <EndingFields
          key={ending.id}
          ending={ending}
          place={place + 1}
          pages={pages}
          isReadOnly={isReadOnly}
          onChange={(next) => {
            change(ending.id, next);
          }}
          onRemove={() => {
            // A jump to this ending is left pointing at nothing: publish names it, in its own words (AC-6326), and
            // Undo puts the ending back where it was, so one click never loses the words that were typed.
            onDraftChange((before) => ({
              ...before,
              endings: (before.endings ?? []).filter((each) => each.id !== ending.id),
            }));
            focusLater(() => addRef.current);
            toasts.toast({
              tone: 'info',
              message: strings.endingRemoved,
              action: {
                label: questionStrings.undo,
                onAction: () => {
                  onDraftChange((before) => {
                    const kept = before.endings ?? [];
                    if (kept.some((each) => each.id === ending.id)) return before;
                    return { ...before, endings: [...kept.slice(0, place - 1), ending, ...kept.slice(place - 1)] };
                  });
                },
              },
            });
          }}
        />
      ))}
      {!isReadOnly && (
        <Button
          ref={addRef}
          variant="dashed"
          icon="plus"
          isDisabled={isFull}
          onPress={() => {
            onDraftChange((before) => ({
              ...before,
              endings: [...(before.endings ?? []), { id: mintEndingId(before.endings ?? []), heading: '' }],
            }));
          }}
        >
          {strings.addEnding}
        </Button>
      )}
      <SettingsSection title={strings.scoreTitle} description={strings.scoreLine}>
        <Select
          savesOnPick
          label={strings.scoreFiledOn}
          items={[
            { id: '', label: strings.scoreFiledNowhere },
            ...numbers.map((item) => ({ id: item.attributeId, label: item.title })),
          ]}
          value={draft.scoreFiledOn?.attributeId ?? ''}
          isReadOnly={isReadOnly}
          isDisabled={numbers.length === 0}
          {...(numbers.length === 0 && target.objectName !== undefined ? { description: strings.scoreNoNumbers } : {})}
          onChange={(attributeId) => {
            onDraftChange((before) => {
              const { scoreFiledOn: _was, ...rest } = before;
              return attributeId === null || attributeId === ''
                ? rest
                : { ...rest, scoreFiledOn: { objectRole: 'main', attributeId } };
            });
          }}
        />
      </SettingsSection>
    </Card>
  );
}
