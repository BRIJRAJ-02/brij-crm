// Brief
// Purpose: whether the person's Google photo shows on their booking pages and profile (owner ask A124, 23 Oct 2026).
// Main task: turn it off (their initials show instead) or on again; it saves at once, with a quiet toast and Undo.
// Leaves out: changing the photo itself (Google's, or initials), and the photo inside the app, which stays as it is.
import type { DataLayer } from '@crm/data';
import { usePictureChoice } from '@crm/data/react';
import { Button, SettingsRow, Spinner, Switch, useDelayedLoading } from '@crm/ui';
import { useRouteContext } from '@tanstack/react-router';
import { useEffect, useRef } from 'react';
import { strings } from './photo-strings.ts';

/** Props for the photo switch's row. */
export interface PhotoSwitchProps {
  readonly data: DataLayer;
  readonly slug: string;
  /** The account has a photo now: the hint names it; without one it says the pages show initials until one comes. */
  readonly hasPhoto: boolean;
}

/**
 * "Show my photo on booking pages", a row in Profile's details card under the photo. On (the default), the person's
 * Google photo shows on their booking pages and profile; off, their initials. It saves at once through the data
 * layer, which puts it back with a toast and Try again if refused; once it lands, a quiet toast says so, with Undo.
 */
export function PhotoSwitch({ data, slug, hasPhoto }: PhotoSwitchProps) {
  const { toasts } = useRouteContext({ from: '__root__' });
  const held = data.profile.picture(slug);
  const choice = usePictureChoice(held);
  // A save that takes a while shows a spinner beside the title; a quick one shows only its toast.
  const isSlow = useDelayedLoading(choice.status === 'ready' && choice.isSaving);
  // What the switch shows now, for an Undo pressed later: an older toast's Undo does nothing.
  const latest = useRef(choice);
  useEffect(() => {
    latest.current = choice;
  }, [choice]);
  // One toast at a time: flipping it back and forth leaves the last change's Undo, not a stack of them.
  const lastToast = useRef<string | undefined>(undefined);

  if (choice.status === 'loading') return <PhotoSwitchPending />;
  if (choice.status === 'error') {
    return (
      <SettingsRow title={strings.title} description={choice.message}>
        <Button onPress={held.retry}>{strings.tryAgain}</Button>
      </SettingsRow>
    );
  }

  const say = (message: string, undo?: () => void) => {
    if (lastToast.current !== undefined) toasts.dismiss(lastToast.current);
    lastToast.current = toasts.toast({
      tone: 'success',
      message,
      ...(undo === undefined ? {} : { action: { label: strings.undo, onAction: undo } }),
    });
  };
  const show = (isShown: boolean) => {
    const isHidden = !isShown;
    void data.profile.setPictureHidden(slug, isHidden).then((landed) => {
      if (!landed) return;
      say(isHidden ? strings.hidden : strings.shown, () => {
        const now = latest.current;
        if (now.status !== 'ready' || now.isHidden !== isHidden) return;
        void data.profile.setPictureHidden(slug, !isHidden).then((undone) => {
          if (undone) say(strings.undone);
        });
      });
    });
  };

  return (
    <SettingsRow
      title={strings.title}
      description={!choice.canChange ? strings.readOnly : hasPhoto ? strings.hint : strings.noPhoto}
      {...(isSlow ? { meta: <Spinner size="xs" label={strings.saving} /> } : {})}
    >
      <Switch
        label={strings.title}
        isLabelHidden
        isSelected={!choice.isHidden}
        isReadOnly={!choice.canChange}
        onChange={show}
      />
    </SettingsRow>
  );
}

/**
 * The row while the profile loads: its title and hint as they will stand (both fixed copy, so nothing moves when it
 * arrives), the switch to come at its end.
 */
export function PhotoSwitchPending() {
  return <SettingsRow title={strings.title} description={strings.hint} />;
}
