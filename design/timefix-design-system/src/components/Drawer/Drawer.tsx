import { Dialog as AriaDialog, Heading, Modal, ModalOverlay } from 'react-aria-components';
import { useEffect, useState, type ReactNode } from 'react';
import { X } from 'lucide-react';
import { cx } from '../../lib/cx.ts';
import { Button, IconButton } from '../Button/Button.tsx';
import { SuccessCheck, TextSwap } from '../Motion/Motion.tsx';
import './Drawer.css';

/** `md` is the 440 panel for a record or a contact; `lg` for notes, email and longer forms. */
export type DrawerWidth = 'md' | 'lg';

/** What a drawer's footer says about its form. */
export type DrawerSaveState = 'clean' | 'dirty' | 'saving' | 'saved';

/** Props shared by Drawer and DrawerPanel. */
export interface DrawerSurfaceProps {
  /** The heading, which also names it ("Edit contact", "Northwind"). */
  readonly title: string;
  /** One quiet line under the title. */
  readonly subtitle?: ReactNode;
  /** Before the title: an avatar or a record's icon. */
  readonly leading?: ReactNode;
  /** Buttons in the header, before ×. */
  readonly actions?: ReactNode;
  readonly children: ReactNode;
  /** The footer's start, away from Save: a destructive action ("Delete contact"). */
  readonly footerStart?: ReactNode;
  /** Drives the footer: `dirty` shows Discard and Save; `saving` and `saved` swap Save's label. Leave off for a read-only drawer. */
  readonly saveState?: DrawerSaveState;
  readonly onSave?: () => void;
  readonly onDiscard?: () => void;
  readonly saveLabel?: string;
  readonly width?: DrawerWidth;
}

/** Props for Drawer. */
export interface DrawerProps extends DrawerSurfaceProps {
  readonly isOpen: boolean;
  readonly onOpenChange: (isOpen: boolean) => void;
}

/** A side sheet from the right over a scrim, for editing one thing without leaving the page. Panel reveal motion (400ms in, 350ms out, 2px blur). With unsaved changes, Esc, × and a click outside keep the drawer open and nudge Save and Discard. */
export function Drawer({ isOpen, onOpenChange, width = 'md', ...surface }: DrawerProps) {
  const [nudge, setNudge] = useState(0);
  const dirty = surface.saveState === 'dirty' || surface.saveState === 'saving';
  return (
    <ModalOverlay isOpen={isOpen} onOpenChange={(o) => { if (!o && dirty) setNudge((n) => n + 1); else onOpenChange(o); }} isDismissable className="tf-drawer-scrim tf-overlay">
      <Modal className={cx('tf-drawer', `tf-drawer--${width}`)}>
        <AriaDialog className="tf-drawer__dialog">
          <DrawerBody {...surface} nudge={nudge} onClose={() => { if (dirty) setNudge((n) => n + 1); else onOpenChange(false); }} isModal />
        </AriaDialog>
      </Modal>
    </ModalOverlay>
  );
}

/** The same surface placed in the page's layout instead of over it: a record's side panel or an aside that pushes the content. */
export function DrawerPanel({ width = 'md', onClose, ...surface }: DrawerSurfaceProps & { readonly onClose?: () => void }) {
  return (
    <section className={cx('tf-drawer', 'tf-drawer--inline', `tf-drawer--${width}`)} aria-label={surface.title}>
      <DrawerBody {...surface} nudge={0} onClose={onClose} isModal={false} />
    </section>
  );
}

function DrawerBody({ title, subtitle, leading, actions, children, footerStart, saveState, onSave, onDiscard, saveLabel = 'Save changes', nudge, onClose, isModal }: DrawerSurfaceProps & { readonly nudge: number; readonly onClose?: () => void; readonly isModal: boolean }) {
  const [scrolled, setScrolled] = useState(false);
  const [shake, setShake] = useState(false);
  useEffect(() => {
    if (nudge === 0) return;
    setShake(true);
    const t = window.setTimeout(() => setShake(false), 400);
    return () => window.clearTimeout(t);
  }, [nudge]);
  const editing = saveState === 'dirty' || saveState === 'saving';
  const hasFooter = footerStart !== undefined || saveState !== undefined;
  return (
    <>
      <header className="tf-drawer__head" data-scrolled={scrolled || undefined}>
        {leading}
        <div className="tf-drawer__titles">
          {isModal ? <Heading slot="title" className="tf-drawer__title">{title}</Heading> : <h2 className="tf-drawer__title">{title}</h2>}
          {subtitle !== undefined && <p className="tf-drawer__subtitle">{subtitle}</p>}
        </div>
        {actions}
        {onClose && <IconButton label="Close" onPress={onClose}><X size={16} strokeWidth={1.75} /></IconButton>}
      </header>
      <div className="tf-drawer__body" onScroll={(e) => setScrolled(e.currentTarget.scrollTop > 0)}>{children}</div>
      {hasFooter && (
        <footer className="tf-drawer__foot" data-nudge={shake || undefined}>
          <div className="tf-drawer__start">{footerStart}</div>
          {saveState !== undefined && (
            <div className="tf-drawer__end">
              <div className="tf-drawer__group" data-active={!editing && saveState !== 'saved' ? true : undefined} inert={editing || saveState === 'saved'}>
                {onClose && <Button variant="secondary" onPress={onClose}>Done</Button>}
              </div>
              <div className="tf-drawer__group" data-active={editing || saveState === 'saved' ? true : undefined} inert={!editing}>
                <span className="tf-drawer__hint" aria-live="polite">{shake ? 'Save or discard first' : ''}</span>
                <Button variant="ghost" onPress={onDiscard} isDisabled={saveState === 'saving'}>Discard</Button>
                <Button variant="primary" onPress={onSave} isDisabled={saveState === 'saved'} isPending={saveState === 'saving'}>
                  <TextSwap swapKey={saveState === 'saved' ? 'saved' : 'save'}>{saveState === 'saved' ? <><SuccessCheck size={16} />Saved</> : saveLabel}</TextSwap>
                </Button>
              </div>
            </div>
          )}
        </footer>
      )}
    </>
  );
}
