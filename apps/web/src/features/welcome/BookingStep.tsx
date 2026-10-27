// Brief
// Purpose: first run's Your booking page (27 October 2026): the page people open to book time, made here rather
// than left for Captures › Links, since a link page with nothing to book is not the product.
// Main task: name the meeting, pick one length, then Create booking page; it joins the link page by itself.
// Leaves out: the hours, the location, the questions, the limits and a second length (the page's own editor), and
// a skip: first run makes one page, and everything about it can be changed afterwards.
import { Field, FieldGroup, Form, SegmentedControl } from '@crm/ui';
import { useState } from 'react';
import type { WelcomeRefusal } from './refusals.ts';
import { strings } from './strings.ts';

const TITLE = 'title';

/** Props for Your booking page. */
export interface BookingStepProps {
  /** What the meeting is called, as typed. */
  readonly title: string;
  readonly onTitle: (title: string) => void;
  /** How long it is, in minutes: one of `strings.bookingLengths`. */
  readonly minutes: number;
  readonly onMinutes: (minutes: number) => void;
  /** The page is being made. */
  readonly isCreating: boolean;
  /** The server's last refusals (a refused title lands on the field). */
  readonly refusals: readonly WelcomeRefusal[];
  /** Makes the page: called once the meeting has a name. */
  readonly onCreate: () => void;
}

/**
 * Your booking page: "What are you offering?", one of four lengths, the line
 * saying it opens straight away and can be changed, and Create booking page
 * (Enter). The page beside the step gains its row as it is typed.
 */
export function BookingStep({ title, onTitle, minutes, onMinutes, isCreating, refusals, onCreate }: BookingStepProps) {
  const [problems, setProblems] = useState<readonly WelcomeRefusal[]>([]);
  const create = () => {
    const found = title.trim() === '' ? [{ code: 'MISSING', message: strings.bookingNameMissing, field: TITLE }] : [];
    setProblems(found);
    if (found.length > 0) return;
    onCreate();
  };
  return (
    <Form<WelcomeRefusal>
      submitLabel={strings.createPage}
      busyLabel={strings.creatingPage}
      isBusy={isCreating}
      refusals={problems.length > 0 ? problems : refusals}
      fieldFor={(refusal) => refusal.field}
      onSubmit={create}
    >
      <Field
        label={strings.bookingName}
        name={TITLE}
        placeholder={strings.bookingNamePlaceholder}
        autoComplete="off"
        isRequired
        maxLength={120}
        value={title}
        onChange={onTitle}
      />
      {/* The group carries the label and the line under it, so the track itself stays one plain control. */}
      <FieldGroup label={strings.bookingLength} hint={strings.bookingNote}>
        <SegmentedControl
          label={strings.bookingLength}
          isDisabled={isCreating}
          segments={strings.bookingLengths.map((each) => ({
            value: String(each),
            label: strings.bookingLengthLabel(each),
          }))}
          value={String(minutes)}
          onChange={(value) => {
            const picked = Number(value);
            if (Number.isFinite(picked)) onMinutes(picked);
          }}
        />
      </FieldGroup>
    </Form>
  );
}
