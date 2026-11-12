import { useState } from 'react';
import { DialogTrigger, Button as AriaButton } from 'react-aria-components';
import { Building2 } from 'lucide-react';
import { ColorSwatchPicker, AccentPicker, HUE_NAMES } from './ColorPicker.tsx';
import { Popover } from '../Popover/Popover.tsx';
import { Tag, StatusDot, type Hue } from '../Tag/Tag.tsx';

export function ColorPickerDemo() {
  const [hue, setHue] = useState<Hue>('green');
  const [optionHue, setOptionHue] = useState<Hue>('purple');
  const [open, setOpen] = useState(false);
  const [accent, setAccent] = useState('#1F5FD6');
  return (
    <div className="tf-demo" style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr)', gap: 'var(--space-32)' }}>
      <div className="tf-stack" style={{ gap: 'var(--space-16)' }}>
        <ColorSwatchPicker label="Object colour" isLabelShown value={hue} onChange={setHue} />
        <div className="tf-row" style={{ gap: 'var(--space-12)' }}>
          <span style={{ display: 'inline-grid', placeItems: 'center', width: 'var(--size-control)', height: 'var(--size-control)', borderRadius: 'var(--radius-md)', background: `var(--tag-${hue}-bg)`, color: `var(--tag-${hue}-text)` }}>
            <Building2 size={20} strokeWidth={1.75} />
          </span>
          <Tag hue={hue}>Companies</Tag>
        </div>
        <div className="tf-row" style={{ gap: 'var(--space-8)' }}>
          <span className="tf-faint" style={{ fontSize: 13 }}>Option</span>
          <DialogTrigger isOpen={open} onOpenChange={setOpen}>
            <AriaButton aria-label={`Colour: ${HUE_NAMES[optionHue]}`} style={{ border: 0, background: 'transparent', padding: 'var(--space-4)', borderRadius: 'var(--radius-full)', cursor: 'pointer' }}>
              <StatusDot hue={optionHue} />
            </AriaButton>
            <Popover label="Option colour">
              <ColorSwatchPicker label="Option colour" value={optionHue} onChange={(h) => { setOptionHue(h); window.setTimeout(() => setOpen(false), 120); }} />
            </Popover>
          </DialogTrigger>
          <Tag size="sm" hue={optionHue}>Enterprise</Tag>
        </div>
        <ColorSwatchPicker label="Calendar colour (read only)" isLabelShown defaultValue="sky" isDisabled />
      </div>
      <div className="tf-stack" style={{ gap: 'var(--space-16)' }}>
        <AccentPicker label="Booking page colour" value={accent} onChange={setAccent} />
        <span style={{ display: 'inline-flex', alignSelf: 'flex-start', alignItems: 'center', height: 'var(--size-control-lg)', padding: '0 var(--space-20)', borderRadius: 'var(--radius-full)', background: accent, color: '#FFFFFF', font: '500 15px/22px var(--font-sans)' }}>
          Confirm booking
        </span>
      </div>
    </div>
  );
}
