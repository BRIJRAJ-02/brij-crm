// Brief
// Purpose: one place to choose what the sidebar shows (spec 0034, AC-933), so a hidden item can always be brought back.
// Main task: switch each section's items on or off; reset the sidebar to its default.
// Leaves out: ordering (the sidebar's own grips).
import { useId, useState } from 'react';
import { Button } from '../../atoms/Button/Button.tsx';
import { Icon } from '../../atoms/Icon/Icon.tsx';
import type { IconName } from '../../atoms/Icon/icons.ts';
import { Switch } from '../../atoms/Switch/Switch.tsx';
import type { Hue } from '../../hue.ts';
import { Callout } from '../../molecules/Callout/Callout.tsx';
import { Modal } from '../../molecules/Modal/Modal.tsx';
import styles from './CustomiseSidebar.module.css';
import { strings } from './strings.ts';

/** One item the sidebar may show, and whether it does. */
export interface CustomiseSidebarItem {
  readonly id: string;
  readonly name: string;
  readonly icon: IconName;
  /** An object's or list's tile colour, as the sidebar draws it. */
  readonly hue?: Hue;
  readonly isShown: boolean;
}

/** A section of the sidebar with the items it may show, in the member's order. */
export interface CustomiseSidebarSection {
  readonly id: string;
  readonly title: string;
  readonly items: readonly CustomiseSidebarItem[];
}

/** Props for CustomiseSidebar. */
export interface CustomiseSidebarProps {
  readonly isOpen: boolean;
  readonly onOpenChange: (isOpen: boolean) => void;
  /** The sections that hold items that can be hidden, in the sidebar's order. */
  readonly sections: readonly CustomiseSidebarSection[];
  /** An item switched on or off: it shows or leaves the sidebar at once. */
  readonly onShownChange: (sectionId: string, itemId: string, isShown: boolean) => void;
  /**
   * Reset to default, once confirmed: settles when it has landed. A rejection's message shows in the confirm,
   * which stays open.
   */
  readonly onReset: () => Promise<void>;
}

/**
 * The Customise sidebar dialog (spec 0034, AC-933): each section's items with
 * a switch, then Reset to default, which asks first in a confirm. Every switch
 * applies at once, so the dialog closes with Done and has nothing to save.
 */
export function CustomiseSidebar({ isOpen, onOpenChange, sections, onShownChange, onReset }: CustomiseSidebarProps) {
  const [isConfirming, setConfirming] = useState(false);
  const headingId = useId();
  return (
    <>
      <Modal
        title={strings.title}
        isOpen={isOpen}
        onOpenChange={onOpenChange}
        actions={
          <>
            <Button
              variant="ghost"
              icon="undo-2"
              onPress={() => {
                setConfirming(true);
              }}
            >
              {strings.reset}
            </Button>
            <Button variant="primary" slot="close">
              {strings.done}
            </Button>
          </>
        }
      >
        <p className={styles.intro}>{strings.intro}</p>
        {sections.length === 0 && <p className={styles.empty}>{strings.empty}</p>}
        {sections.map((section) => (
          <section key={section.id} className={styles.section} aria-labelledby={`${headingId}-${section.id}`}>
            <h3 id={`${headingId}-${section.id}`} className={styles.heading}>
              {section.title}
            </h3>
            <ul className={styles.list}>
              {section.items.map((item) => (
                <li key={item.id} className={styles.row}>
                  {item.hue === undefined ? <Icon name={item.icon} /> : <Icon name={item.icon} tile={item.hue} />}
                  <span className={styles.name}>{item.name}</span>
                  <Switch
                    label={strings.show(item.name)}
                    isLabelHidden
                    isSelected={item.isShown}
                    onChange={(isShown) => {
                      onShownChange(section.id, item.id, isShown);
                    }}
                  />
                </li>
              ))}
            </ul>
          </section>
        ))}
      </Modal>
      <ResetConfirm
        isOpen={isOpen && isConfirming}
        onClose={() => {
          setConfirming(false);
        }}
        onReset={onReset}
      />
    </>
  );
}

/** "Reset your sidebar?": a danger confirm over the dialog, busy while the reset lands, its refusal said inside. */
function ResetConfirm({
  isOpen,
  onClose,
  onReset,
}: {
  readonly isOpen: boolean;
  readonly onClose: () => void;
  readonly onReset: () => Promise<void>;
}) {
  const [isBusy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | undefined>(undefined);
  const reset = () => {
    if (isBusy) return;
    setBusy(true);
    setFailure(undefined);
    onReset().then(
      () => {
        setBusy(false);
        onClose();
      },
      (error: unknown) => {
        setBusy(false);
        setFailure(error instanceof Error && error.message !== '' ? error.message : strings.resetFailed);
      },
    );
  };
  return (
    <Modal
      title={strings.resetQuestion}
      tone="danger"
      isOpen={isOpen}
      isBusy={isBusy}
      onOpenChange={(open) => {
        if (!open && !isBusy) {
          setFailure(undefined);
          onClose();
        }
      }}
      actions={
        <>
          <Button slot="close" isDisabled={isBusy} kbd="ESC">
            {strings.cancel}
          </Button>
          <Button variant="danger-solid" icon="undo-2" isPending={isBusy} onPress={reset}>
            {isBusy ? strings.resetting : strings.resetConfirm}
          </Button>
        </>
      }
    >
      {failure !== undefined && <Callout tone="danger">{failure}</Callout>}
      {strings.resetText}
    </Modal>
  );
}
