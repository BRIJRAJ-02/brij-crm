// A link page's notice sheet (spec 0061, AC-6113), its own chunk: loaded only on a page with a noticed link.
import { useState } from 'react';
import { Button, ButtonLink } from '../../atoms/Button/Button.tsx';
import { Modal } from '../../molecules/Modal/Modal.tsx';
import type { LinkPageNotice as Notice } from './LinkPage.tsx';
import { strings } from './strings.ts';

/** The link a visitor pressed, which asks first. */
export interface NoticedLink {
  readonly id: string;
  readonly title: string;
  readonly notice: Notice;
  /** Its checked address. */
  readonly href: string;
  /** A web page, opened in a new tab; else the device's app, in place. */
  readonly isWeb: boolean;
}

/** Props for LinkPageNotice. */
export interface LinkPageNoticeProps {
  /** The link asking now; absent, the sheet is shut. */
  readonly asking: NoticedLink | undefined;
  /** Go back, Escape or a press outside: nothing opens and nothing counts. */
  readonly onClose: () => void;
  /** Continue: the link opens (it is a real link) and counts, and is remembered for the visit. */
  readonly onContinue: (id: string) => void;
  /** Called only by the page's stand in when this chunk couldn't load (the page then stops asking); unused here. */
  readonly onUnavailable?: () => void;
}

/**
 * The small sheet a noticed link opens first (AC-6113): the library's confirm, its question the notice ("You need
 * to be 18 or older to open this."), the link's own title under it, then Go back and Continue. Continue is the link
 * itself, so it opens as any link does (a new tab for a web page, `nofollow`), and only it counts the press.
 */
export function LinkPageNotice({ asking, onClose, onContinue }: LinkPageNoticeProps) {
  // The link last asked about, kept while the sheet closes so its exit still draws what it said.
  const [shown, setShown] = useState(asking);
  if (asking !== undefined && asking !== shown) setShown(asking);
  if (shown === undefined) return null;
  return (
    <Modal
      variant="confirm"
      title={strings.notices[shown.notice]}
      isOpen={asking !== undefined}
      onOpenChange={(isOpen) => {
        if (!isOpen) onClose();
      }}
      actions={
        <>
          <Button slot="close">{strings.noticeBack}</Button>
          <ButtonLink
            variant="primary"
            href={shown.href}
            {...(shown.isWeb ? { isExternal: true, relations: ['nofollow'] as const } : {})}
            onPress={() => {
              onContinue(shown.id);
            }}
          >
            {strings.noticeContinue}
          </ButtonLink>
        </>
      }
    >
      {shown.title}
    </Modal>
  );
}
