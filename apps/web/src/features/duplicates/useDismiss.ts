import type { DuplicatePair, DuplicatePairsList } from '@crm/data';
import { useRouteContext } from '@tanstack/react-router';
import { useCallback } from 'react';
import { strings } from './strings.ts';

/**
 * "Not a duplicate" with Undo in its toast (AC-4908): the pair leaves at once through the data layer; a refusal
 * brings it back with a toast, and Undo puts it back and tells the server.
 */
export function useDismiss(list: DuplicatePairsList): (pair: DuplicatePair) => void {
  const { toasts } = useRouteContext({ from: '__root__' });
  return useCallback(
    (pair: DuplicatePair) => {
      list.dismiss(pair).then(
        () => {
          toasts.toast({
            tone: 'success',
            message: strings.dismissed,
            action: {
              label: strings.undo,
              onAction: () => {
                list.restore(pair).catch(() => {
                  toasts.toast({ tone: 'danger', message: strings.restoreFailed });
                });
              },
            },
          });
        },
        () => {
          toasts.toast({ tone: 'danger', message: strings.dismissFailed });
        },
      );
    },
    [list, toasts],
  );
}
