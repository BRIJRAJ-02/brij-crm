// Brief
// Purpose: an object's look in a form: its icon, picked in a popover from the name field, and its colour.
// Main task: change either with the pointer or the keyboard, seeing the icon on the colour it will have.
// Leaves out: saving; the New object dialog and the Configuration tab send the look with their names.
import type { Hue, ObjectIcon } from '@crm/data';
import { Button, HuePicker, IconPicker, Popover } from '@crm/ui';
import { useRef, useState } from 'react';
import { strings } from './strings.ts';

/** "building-complex" as words: "Building complex". */
const iconName = (icon: string) => {
  const words = icon.replaceAll('-', ' ');
  return words.charAt(0).toUpperCase() + words.slice(1);
};

/** Props for the icon button. */
export interface ObjectIconButtonProps {
  readonly icon: ObjectIcon;
  readonly hue: Hue;
  readonly onChange: (icon: ObjectIcon) => void;
  /** A member reads the icon: the button is off. */
  readonly isReadOnly?: boolean;
}

/**
 * The object's icon as a ghost button named for it ("Icon: Folder"), sitting
 * at the start of the name field, that opens the picker on the object's hue.
 */
export function ObjectIconButton({ icon, hue, onChange, isReadOnly = false }: ObjectIconButtonProps) {
  const trigger = useRef<HTMLButtonElement>(null);
  const [isOpen, setOpen] = useState(false);
  return (
    <>
      <Button
        ref={trigger}
        variant="ghost"
        icon={icon}
        label={strings.changeIcon(iconName(icon))}
        isDisabled={isReadOnly}
        onPress={() => {
          setOpen(true);
        }}
      />
      <Popover triggerRef={trigger} isOpen={isOpen} onOpenChange={setOpen} label={strings.iconPicker}>
        <IconPicker
          label={strings.iconPicker}
          value={icon}
          hue={hue}
          onChange={(next) => {
            onChange(next);
            setOpen(false);
          }}
        />
      </Popover>
    </>
  );
}

/** The object's colour: the nine hues, labelled as a field. */
export function ObjectHueField({
  hue,
  onChange,
  isReadOnly = false,
}: {
  readonly hue: Hue;
  readonly onChange: (hue: Hue) => void;
  readonly isReadOnly?: boolean;
}) {
  return <HuePicker label={strings.colour} value={hue} onChange={onChange} isDisabled={isReadOnly} isLabelShown />;
}
