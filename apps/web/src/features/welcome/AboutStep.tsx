// Brief
// Purpose: first run's Your name (spec 0036): the name a new person's team sees, beside their initials.
// Main task: type your name (Google's is there already) and Continue. There is no Skip (the owner, 27 October
// 2026): a name is one field, and every page this run makes carries it.
// Also, optional: a photo, uploaded straight from their device (27 Oct 2026); without one the initials stand in.
// Leaves out: cropping by hand (the middle square is taken), and anything about the workspace.
import { Avatar, Callout, Field, FieldGroup, FileDrop, Form } from '@crm/ui';
import { PHOTO_PICK_MAX_BYTES, PHOTO_TYPES } from './photo.ts';
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
  /** Their photo, when they have one: it shows in place of the initials. */
  readonly image?: string;
  /** A photo was picked: it is drawn again and sent. */
  readonly onPhoto: (file: File) => void;
  /** The photo is on its way. */
  readonly isUploading?: boolean;
  /** Why the last photo didn't land, said under the button. */
  readonly photoFailure?: string;
}

/** Your name: the initials that follow the name, "Your name" and Continue (Enter). */
export function AboutStep({
  memberName,
  onMemberName,
  shownName,
  userId,
  onContinue,
  image,
  onPhoto,
  isUploading = false,
  photoFailure,
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
      {/* The photo beside the button that changes it, under one label, in a row: optional, so it never holds the
          step up, and side by side so the step stays short. */}
      <FieldGroup label={strings.photoLabel} layout="row">
        <Avatar name={shownName} id={userId} size="xl" isDecorative {...(image === undefined ? {} : { src: image })} />
        <FileDrop
          variant="button"
          label={image === undefined ? strings.usePhoto : strings.changePhoto}
          acceptedTypes={PHOTO_TYPES}
          maxSize={PHOTO_PICK_MAX_BYTES}
          isPending={isUploading}
          onFiles={(files) => {
            const [file] = files;
            if (file !== undefined) onPhoto(file);
          }}
        />
      </FieldGroup>
      {photoFailure !== undefined && <Callout tone="danger">{photoFailure}</Callout>}
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
