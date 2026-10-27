// Brief
// Purpose: first run's Your name (spec 0036): the name a new person's team sees, beside their initials.
// Main task: type your name (Google's is there already) and Continue. There is no Skip (the owner, 27 October
// 2026): a name is one field, and every page this run makes carries it.
// Also, optional: take the photo from your Google account, the one photo a person can have until file storage
// arrives (#32); without it the initials stand in.
// Leaves out: uploading a photo of your own, and anything about the workspace.
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
  /** Their account photo, when they have one: it shows in place of the initials. */
  readonly image?: string;
  /** Google sign in is set up here: without it there is no photo to take. */
  readonly canUseGooglePhoto?: boolean;
  /** The browser is on its way to Google. */
  readonly isOpeningGoogle?: boolean;
  readonly onUseGooglePhoto?: () => void;
}

/** Your name: the initials that follow the name, "Your name" and Continue (Enter). */
export function AboutStep({
  memberName,
  onMemberName,
  shownName,
  userId,
  onContinue,
  image,
  canUseGooglePhoto = false,
  isOpeningGoogle = false,
  onUseGooglePhoto,
}: AboutStepProps) {
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
    >
      <Avatar name={shownName} id={userId} size="xl" isDecorative {...(image === undefined ? {} : { image })} />
      {canUseGooglePhoto && onUseGooglePhoto !== undefined && (
        <Button variant="ghost" provider="google" isPending={isOpeningGoogle} onPress={onUseGooglePhoto}>
          {image === undefined ? strings.usePhoto : strings.changePhoto}
        </Button>
      )}
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
