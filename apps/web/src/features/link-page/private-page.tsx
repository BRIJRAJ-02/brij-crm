// Whether the person's link page is Live or Private, wherever it shows (the link page screen's bar and Home's card),
// so the switch, its words and the wallet read never drift apart: `useLinkPageLive`, `LiveSwitch`, `useWalletLink`.
// Spec 0058, AC-23: a claimed handle is live at once; a page made for its owner is private until they open it once;
// after that the one switch decides. Every call goes through the data layer's link page store.
import type { DataLayer } from '@crm/data';
import { Switch } from '@crm/ui';
import { useRouteContext } from '@tanstack/react-router';
import { useEffect, useRef, useState } from 'react';
import { strings } from './strings.ts';

/**
 * A link that saves the page to the person's wallet, or undefined (26 October 2026): this deployment has no
 * credentials for a wallet, the read failed, or the page isn't public, so a saved pass would open nothing. Asked
 * for once a visit, because the link is signed for a short while, and a button nobody can use is never drawn.
 */
export function useWalletLink(data: DataLayer, slug: string, isPublic: boolean): string | undefined {
  const [link, setLink] = useState<string | undefined>(undefined);
  useEffect(() => {
    if (!isPublic) return;
    let isCurrent = true;
    void data.linkPage.load().then(
      (store) =>
        store.walletLink(slug, 'apple_wallet').then(
          (answer) => {
            if (isCurrent && 'url' in answer) setLink(answer.url);
          },
          // No wallet is no error: the card simply doesn't offer it.
          () => undefined,
        ),
      () => undefined,
    );
    return () => {
      isCurrent = false;
    };
  }, [data, slug, isPublic]);
  return link;
}

/** The page's Live or Private state, and the one way to change it. */
export interface LinkPageLive {
  /** Whether anyone can open the page; a change on its way is already shown. */
  readonly isLive: boolean;
  /** The switch: shown at once, saved behind it, put back with a toast if the save is refused. */
  readonly setLive: (live: boolean) => void;
}

/**
 * The page's Live or Private state (spec 0058, AC-23), from the profile the route read. With `opens`, this is the
 * link page screen itself: a page made for its owner that nobody has chosen for goes live the first time they open
 * it, once, said in a toast with Undo, so nothing goes up without them seeing it. One they set Private stays so (the
 * server's rule), and so does a page with no handle, which has nothing to open.
 */
export function useLinkPageLive(
  data: DataLayer,
  slug: string,
  isPublic: boolean | undefined,
  options: { readonly opens?: boolean } = {},
): LinkPageLive {
  const { toasts } = useRouteContext({ from: '__root__' });
  const [isLive, setIsLive] = useState(isPublic !== false);
  // Only the newest switch's answer lands: a quick on, off, on never ends on an older answer.
  const latest = useRef(0);
  const opened = useRef(false);
  const send = (live: boolean | undefined) => data.linkPage.load().then((store) => store.show(slug, live));
  const setLive = (live: boolean) => {
    // The switch only ever flips, so what to put back is the other state: never a value an older render held
    // (the toast's Undo keeps the first render's copy of this function).
    const was = !live;
    const asked = (latest.current += 1);
    setIsLive(live);
    send(live).then(
      (answer) => {
        if (asked === latest.current) setIsLive(answer.isPublic);
      },
      () => {
        if (asked !== latest.current) return;
        setIsLive(was);
        toasts.toast({ tone: 'danger', message: strings.liveFailed });
      },
    );
  };
  useEffect(() => {
    // Once per screen, and only for a page still private: an open of a live page changes nothing anyway.
    if (options.opens !== true || isPublic !== false || opened.current) return;
    opened.current = true;
    const asked = latest.current;
    send(undefined).then(
      (answer) => {
        // A switch pressed meanwhile is the person's own word, and wins.
        if (asked !== latest.current || !answer.isPublic) return;
        setIsLive(true);
        toasts.toast({
          tone: 'success',
          message: strings.nowLive,
          action: { label: strings.undo, onAction: () => setLive(false) },
        });
      },
      // Not opened is not an error: the page stays as the profile said, and the switch still works.
      () => undefined,
    );
    // The first render's profile is the one the screen opened on; a later read must not open it again.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once per screen, by design
  }, []);
  return { isLive, setLive };
}

/** Props for LiveSwitch. */
export interface LiveSwitchProps {
  readonly live: LinkPageLive;
}

/**
 * The one Live or Private switch (spec 0058, AC-23). Its label and name are "Live" in both states, so voice control
 * says "click Live" (WCAG 2.5.3); while off a small "Private" sits beside it as its description, heard as "Live,
 * switch, off, Private". The line under the address says what Private means.
 */
export function LiveSwitch({ live }: LiveSwitchProps) {
  return <Switch label={strings.live} offStatus={strings.private} isSelected={live.isLive} onChange={live.setLive} />;
}
