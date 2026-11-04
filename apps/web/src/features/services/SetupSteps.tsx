// Brief
// Purpose: the Appointments setup checklist (spec 0068, Foolproof), one step at a time: business and place, hours,
// a service, the people who do it, their shifts, then Publish.
// Main task: press the first open step's button and land where it is done.
// Leaves out: doing any step itself (each opens its own page), and showing once every step is done and put away.
import type { AppointmentsSetup, SetupStepId } from '@crm/data';
import { SetupChecklist } from '@crm/ui';
import { useNavigate } from '@tanstack/react-router';
import { useState } from 'react';
import {
  businessPageHref,
  businessSettingsHref,
  placeTablesHref,
  servicesSettingsHref,
  shiftsSettingsHref,
  staffSettingsHref,
} from '../settings/nav.ts';
import { strings } from './strings.ts';

/** Where each step is done. */
function stepHref(slug: string, id: SetupStepId, placeId: string | undefined): string {
  switch (id) {
    case 'business':
      return businessSettingsHref(slug);
    case 'hours':
      return placeId === undefined ? businessSettingsHref(slug) : placeTablesHref(slug, placeId);
    case 'service':
      return servicesSettingsHref(slug);
    case 'staff':
      return staffSettingsHref(slug);
    case 'shifts':
      return shiftsSettingsHref(slug);
    default:
      return businessPageHref(slug);
  }
}

/** The checklist, or nothing once the reader hid it in this browser. `onHere` runs a step done on this page. */
export function SetupSteps({
  slug,
  setup,
  onHere,
}: {
  readonly slug: string;
  readonly setup: AppointmentsSetup;
  /** A step this page does itself (Add service on Services): pressed, it runs here rather than navigating. */
  readonly onHere?: Partial<Record<SetupStepId, () => void>>;
}) {
  const navigate = useNavigate();
  // Put away from its own menu, it stays away in this browser (UI state, never the server's).
  const key = `crm.appointments.setup-hidden.${slug}`;
  const [isHidden, setHidden] = useState(() => {
    try {
      return globalThis.localStorage.getItem(key) === '1';
    } catch {
      return false;
    }
  });
  if (isHidden) return null;
  return (
    <SetupChecklist
      title={strings.setupTitle}
      defaultDoneExpanded={false}
      steps={setup.steps.map((step) => ({
        id: step.id,
        title: strings.stepTitle[step.id],
        isDone: step.done,
        action: strings.stepAction[step.id],
      }))}
      onAction={(id) => {
        const step = setup.steps.find((each) => each.id === id);
        if (step === undefined) return;
        const here = onHere?.[step.id];
        if (here !== undefined) {
          here();
          return;
        }
        void navigate({ href: stepHref(slug, step.id, step.placeId) });
      }}
      onHide={() => {
        setHidden(true);
        try {
          globalThis.localStorage.setItem(key, '1');
        } catch {
          // Blocked storage: hidden for this visit.
        }
      }}
    />
  );
}
