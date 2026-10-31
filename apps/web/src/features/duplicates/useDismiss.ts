import type { DuplicatePair, DuplicatePairsList } from '@crm/data';
import { useRouteContext } from '@tanstack/react-router';
import { useCallback } from 'react';
import { focusTitle } from '../navigation/focus-title.ts';
import { strings } from './strings.ts';

/**
 * "Not a duplicate" with Undo in its toast (AC-4908): the pair leaves at once through the data layer and the toast
 * says so at once; focus goes to the page's title, since the button left with its row. A refusal brings the pair back
 * with a danger toast. Undo waits for the dismissal to land, then puts the pair back and tells the server.
 */
export function useDismiss(list: DuplicatePairsList): (pair: DuplicatePair) => void {
  const { toasts } = useRouteContext({ from: '__root__' });
  return useCallback(
    (pair: DuplicatePair) => {
      const sent = list.dismiss(pair);
      focusTitle();
      const restore = () => {
        sent.then(
          () =>
            list.restore(pair).catch(() => {
              toasts.toast({
                tone: 'danger',
                message: strings.restoreFailed,
                action: { label: strings.retry, onAction: restore },
              });
            }),
          () => undefined,
        );
      };
      toasts.toast({ tone: 'success', message: strings.dismissed, action: { label: strings.undo, onAction: restore } });
      sent.catch(() => {
        toasts.toast({ tone: 'danger', message: strings.dismissFailed });
      });
    },
    [list, toasts],
  );
}
