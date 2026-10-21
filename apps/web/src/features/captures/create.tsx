// Brief
// Purpose: Captures' one New, owned by the Captures layout, so it sits in the TopBar at one place and one width on both tabs, loading or not.
// Main task: make a booking page on Links (its dialog, then its editor) and a form on Forms (made at once, then its builder).
// Leaves out: the lists themselves (each tab's screen) and what a new page or form holds (their editors).
import { isDataError } from '@crm/data';
import { Button, Tooltip } from '@crm/ui';
import { useNavigate, useRouteContext } from '@tanstack/react-router';
import { createContext, useContext, useState, type ReactNode } from 'react';
import { pageEditorHref } from '../booking/links.ts';
import { NewPageDialog } from '../booking/NewPageDialog.tsx';
import { strings as bookingStrings } from '../booking/strings.ts';
import { formHref } from '../forms/paths.ts';
import { strings as formStrings } from '../forms/strings.ts';
import { useCan } from '../workspace/WorkspacePage.tsx';
import type { CaptureTab } from './tabs.ts';

/** The tab's New, as the TopBar and an empty list offer it. */
export interface CapturesCreate {
  /** Its full name, for screen readers and speech input: "New booking page", "New form". */
  readonly label: string;
  /** Makes one; undefined when the person may not (Forms without forms.manage). */
  readonly create?: () => void;
  /** Why they may not, for the button's tooltip. */
  readonly refusal?: string;
  /** A form is being made: the button shows its spinner in the icon's place, at the same width. */
  readonly isPending: boolean;
}

const CapturesCreateContext = createContext<CapturesCreate | undefined>(undefined);

/** The chosen tab's New, inside the Captures layout; undefined outside it. */
export const useCapturesCreate = () => useContext(CapturesCreateContext);

/** Props for CapturesCreateProvider. */
export interface CapturesCreateProviderProps {
  readonly slug: string;
  readonly tab: CaptureTab;
  readonly children: ReactNode;
}

/** Holds the tab's New and its New booking page dialog for the whole layout, so switching tabs remounts neither. */
export function CapturesCreateProvider({ slug, tab, children }: CapturesCreateProviderProps) {
  const { data, toasts } = useRouteContext({ from: '__root__' });
  const navigate = useNavigate();
  const canManageForms = useCan('forms.manage');
  // Round robin pages are booking.admin's (spec 0029, AC-751).
  const canBookTeams = useCan('booking.admin');
  const [isAddingPage, setAddingPage] = useState(false);
  const [makingForm, setMakingForm] = useState<string | undefined>(undefined);

  // New form makes "Untitled form" at once and opens it: no dialog first, the builder is the dialog.
  const makeForm = () => {
    if (makingForm !== undefined) return;
    const id = data.forms.newId();
    setMakingForm(id);
    data.forms.create(slug, { id }).then(
      (form) => {
        setMakingForm(undefined);
        void navigate({ href: formHref(slug, form.id) });
      },
      (error: unknown) => {
        setMakingForm(undefined);
        toasts.toast({
          tone: 'danger',
          message: `${formStrings.createFailed} ${isDataError(error) ? error.message : formStrings.failedText}`,
        });
      },
    );
  };

  const value: CapturesCreate =
    tab === 'links'
      ? {
          label: bookingStrings.newPage,
          create: () => {
            setAddingPage(true);
          },
          isPending: false,
        }
      : {
          label: formStrings.newForm,
          ...(canManageForms ? { create: makeForm } : { refusal: formStrings.manageOnly }),
          isPending: makingForm !== undefined,
        };

  return (
    <CapturesCreateContext value={value}>
      {children}
      <NewPageDialog
        data={data}
        slug={slug}
        canBookTeams={canBookTeams}
        isOpen={isAddingPage}
        onClose={() => {
          setAddingPage(false);
        }}
        onCreated={(page) => {
          setAddingPage(false);
          void navigate({ to: pageEditorHref(slug, page.id) });
        }}
      />
    </CapturesCreateContext>
  );
}

/**
 * The TopBar's New: it reads New on both tabs (named in full for screen readers), so it keeps one place and one
 * width as the tabs change, and while a form is being made its spinner takes the icon's place. Someone who may
 * not make forms finds it turned off on Forms, with the reason, rather than gone.
 */
export function CapturesNewButton() {
  const create = useCapturesCreate();
  if (create === undefined) return null;
  const button = (
    <Button
      variant="primary"
      icon="plus"
      label={create.label}
      isPending={create.isPending}
      isDisabled={create.create === undefined}
      {...(create.create === undefined ? {} : { onPress: create.create })}
    >
      {bookingStrings.newButton}
    </Button>
  );
  if (create.refusal === undefined) return button;
  return <Tooltip content={create.refusal}>{button}</Tooltip>;
}
