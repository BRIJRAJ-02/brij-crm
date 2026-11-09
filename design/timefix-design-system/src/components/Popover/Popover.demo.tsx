import { DialogTrigger } from 'react-aria-components';
import { Share2, Link2, Code2 } from 'lucide-react';
import { Popover, InfoTip } from './Popover.tsx';
import { Button } from '../Button/Button.tsx';
import { Checkbox } from '../Checkbox/Checkbox.tsx';

const i = { size: 16, strokeWidth: 1.75 } as const;

export function PopoverDemo() {
  return (
    <div className="tf-demo" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-32)' }}>
      <div className="tf-stack">
        <p className="tf-demo-label">Popover: grows from its trigger, either side</p>
        <div className="tf-row">
          <DialogTrigger>
            <Button icon={<Share2 {...i} />}>Share</Button>
            <Popover label="Share Discovery call" width="menu">
              <div className="tf-stack" style={{ gap: 'var(--space-8)', padding: 'var(--space-6)' }}>
                <span style={{ font: '500 14px/20px var(--font-sans)' }}>Share Discovery call</span>
                <span className="tf-muted" style={{ fontSize: 13 }}>Anyone with the link can book 30 minutes with you.</span>
                <div className="tf-row">
                  <Button size="sm" variant="primary" icon={<Link2 size={14} strokeWidth={1.75} />}>Copy link</Button>
                  <Button size="sm" icon={<Code2 size={14} strokeWidth={1.75} />}>Embed</Button>
                </div>
              </div>
            </Popover>
          </DialogTrigger>
          <DialogTrigger>
            <Button variant="soft">Notify me</Button>
            <Popover label="Notifications" placement="top end">
              <div className="tf-stack" style={{ gap: 'var(--space-8)', padding: 'var(--space-6)' }}>
                <Checkbox defaultSelected>New bookings</Checkbox>
                <Checkbox defaultSelected>Cancellations</Checkbox>
                <Checkbox>Form responses</Checkbox>
              </div>
            </Popover>
          </DialogTrigger>
        </div>
      </div>
      <div className="tf-stack">
        <p className="tf-demo-label">InfoTip: press the (i)</p>
        <span className="tf-row" style={{ gap: 'var(--space-4)', font: '500 13px/20px var(--font-sans)' }}>
          Minimum notice
          <InfoTip label="Minimum notice" href="https://timefix.com/help/limits">How far ahead someone has to book. With 4 hours, a guest at 9:00 can book 13:00 at the earliest.</InfoTip>
        </span>
        <span className="tf-row" style={{ gap: 'var(--space-4)', font: '500 13px/20px var(--font-sans)' }}>
          Unique values
          <InfoTip label="Unique values">No two records can share a value in this attribute.</InfoTip>
        </span>
      </div>
    </div>
  );
}
