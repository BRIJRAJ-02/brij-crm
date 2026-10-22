// Brief
// Purpose: first run's Your name (spec 0036): the name a new person's team sees, beside their initials.
// Main task: type your name (Google's is there already) and Continue, or Skip.
// Leaves out: a photo until file storage arrives (the initials stand in), and anything about the workspace.
import { Avatar, Button, Field, Form } from '@crm/ui';
import { useState } from 'react';
import { strings } from './strings.ts';

/** A refusal on this step: the field it is about by `name`. */
interface AboutRefusal {
  readonly code: string;
  readonly message: string;
  readonly field: string;
}

const MEMBER_NAME = 'memberName';

/** Props for Your name. */
export interface AboutStepProps {
  /** The name as typed (Google's to start with, or empty). */
  readonly memberName: string;
  readonly onMemberName: (name: string) => void;
  /** The name the initials come from: the typed one, else one made from the email. */
  readonly shownName: string;
  /** Seeds the avatar's hue, the person's own everywhere. */
  readonly userId: string;
  readonly onContinue: () => void;
  readonly onSkip: () => void;
}

/** Your name: the initials that follow the name, "Your name", Continue (Enter), and Skip. */
export function AboutStep({ memberName, onMemberName, shownName, userId, onContinue, onSkip }: AboutStepProps) {
  const [refusals, setRefusals] = useState<readonly AboutRefusal[]>([]);
  return (
    <Form<AboutRefusal>
      submitLabel={strings.continue}
      refusals={refusals}
      fieldFor={(refusal) => refusal.field}
      onSubmit={() => {
        if (memberName.trim() === '') {
          setRefusals([{ code: 'MISSING', message: strings.nameMissing, field: MEMBER_NAME }]);
          return;
        }
        setRefusals([]);
        onContinue();
      }}
      actions={
        <Button variant="ghost" size="lg" isFullWidth="center" onPress={onSkip}>
          {strings.skip}
        </Button>
      }
    >
      <Avatar name={shownName} id={userId} size="xl" isDecorative />
      <Field
        label={strings.yourName}
        name={MEMBER_NAME}
        autoComplete="name"
        isRequired
        maxLength={80}
        value={memberName}
        onChange={onMemberName}
      />
    </Form>
  );
}
