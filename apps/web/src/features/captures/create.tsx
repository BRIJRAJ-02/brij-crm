// Brief
// Purpose: Captures' one New, owned by the Captures layout, so it sits in the TopBar at one place and one width on both tabs, loading or not.
// Main task: make a booking page on Links (its dialog, then its editor) and a form on Forms (its template gallery, then its builder).
// Leaves out: the lists themselves (each tab's screen) and what a new page or form holds (their editors).
import { Button, Tooltip } from '@crm/ui';
import { useNavigate, useRouteContext, useSearch } from '@tanstack/react-router';
import { createContext, useContext, useState, type ReactNode } from 'react';
import { linksHref, pageEditorHref } from '../booking/links.ts';
import { NewPageDialog } from '../booking/NewPageDialog.tsx';
import { strings as bookingStrings } from '../booking/strings.ts';
import { formHref } from '../forms/paths.ts';
import { strings as formStrings } from '../forms/strings.ts';
import { TemplateGallery } from '../forms/TemplateGallery.tsx';
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
  const { data } = useRouteContext({ from: '__root__' });
  const navigate = useNavigate();
  const canManageForms = useCan('forms.manage');
  // Round robin pages are booking.admin's (spec 0029, AC-751).
  const canBookTeams = useCan('booking.admin');
  const [isAddingPage, setAddingPage] = useState(false);
  // Bookings' "Create a link only page" arrives as `?new=link-only`: the dialog opens preset, and closing it drops it.
  const search: { readonly new?: unknown } = useSearch({ strict: false });
  const isAskedLinkOnly = tab === 'links' && search.new === 'link-only';
  // New form opens the template gallery (spec 0063, AC-6323), which makes the draft and hands it back: nobody
  // starts from an empty page any more, and Blank is still one press away as its first tile.
  const [isPickingTemplate, setPickingTemplate] = useState(false);

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
          ...(canManageForms
            ? {
                create: () => {
                  setPickingTemplate(true);
                },
              }
            : { refusal: formStrings.manageOnly }),
          // The gallery is the dialog now, so New itself is never left spinning.
          isPending: false,
        };

  return (
    <CapturesCreateContext value={value}>
      {children}
      <NewPageDialog
        data={data}
        slug={slug}
        canBookTeams={canBookTeams}
        isOpen={isAddingPage || isAskedLinkOnly}
        isLinkOnly={isAskedLinkOnly}
        onClose={() => {
          setAddingPage(false);
          if (isAskedLinkOnly) void navigate({ href: linksHref(slug), replace: true });
        }}
        onCreated={(page) => {
          setAddingPage(false);
          void navigate({ to: pageEditorHref(slug, page.id) });
        }}
      />
      <TemplateGallery
        data={data}
        slug={slug}
        isOpen={isPickingTemplate}
        onClose={() => {
          setPickingTemplate(false);
        }}
        onCreated={(form) => {
          setPickingTemplate(false);
          void navigate({ href: formHref(slug, form.id) });
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
