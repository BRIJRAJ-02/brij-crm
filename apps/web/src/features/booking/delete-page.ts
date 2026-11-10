// Delete a booking page with Undo and no confirm (the owner, 9 November 2026; the house rule: Undo deletes stay one
// click), from its card on Pages or its editor's ⋯: the page leaves every list at once and a toast offers Undo for ten
// seconds; only then is it deleted on the server (`bookingPages.removeLater`, whose wait outlasts the screen). A
// refusal brings the page back and says why.
import { isDataError, type BookingPageView, type DataLayer } from '@crm/data';
import { focusLater, sharedStrings, type Toasts } from '@crm/ui';
import { strings as capturesStrings } from '../captures/strings.ts';
import { strings } from './strings.ts';

/** How long a deleted page waits for Undo before it is deleted on the server: the Undo toast's life. */
export const PAGE_UNDO_MS = 10_000;

/** Deletes `page` with the Undo toast; Undo puts its card back and focuses it when Pages shows it. */
export function deletePageWithUndo(data: DataLayer, toasts: Toasts, slug: string, page: BookingPageView): void {
  const pending = data.bookingPages.removeLater(slug, page.id, PAGE_UNDO_MS);
  pending.done.catch((error: unknown) => {
    // Someone else deleted it meanwhile: gone either way, as the toast said.
    if (isDataError(error) && error.code === 'NOT_FOUND') return;
    toasts.toast({
      tone: 'danger',
      message: `${strings.deleteFailed(page.title)} ${isDataError(error) ? error.message : strings.somethingWrong}`,
    });
  });
  toasts.toast(
    {
      tone: 'success',
      message: strings.deleted(page.title),
      action: {
        label: capturesStrings.undo,
        onAction: () => {
          if (!pending.undo()) {
            toasts.toast({ tone: 'danger', message: sharedStrings.undoStale });
            return;
          }
          // Focus goes to the card that came back, rather than falling to the page with the toast.
          focusLater(() => document.querySelector<HTMLElement>(`a[href$="/captures/links/${page.id}"]`) ?? undefined);
        },
      },
    },
    { timeout: PAGE_UNDO_MS },
  );
}
