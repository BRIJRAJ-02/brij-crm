import { useState } from 'react';
import { Checkbox, RadioGroup, Radio, Switch } from './Checkbox.tsx';

const tasks = ['Send the proposal to Acme', 'Book a demo with Northwind', 'Follow up after the call'];
export function CheckboxDemo() {
  const [done, setDone] = useState<ReadonlySet<string>>(new Set([tasks[2] ?? '']));
  const [on, setOn] = useState(true);
  const all = done.size === tasks.length;
  return (
    <div className="tf-demo" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 'var(--space-32)' }}>
      <div className="tf-stack">
        <p className="tf-demo-label">Checkbox</p>
        <Checkbox isSelected={all} isIndeterminate={!all && done.size > 0} onChange={(v) => setDone(new Set(v ? tasks : []))}>All tasks</Checkbox>
        {tasks.map((t) => (
          <Checkbox key={t} round isSelected={done.has(t)} onChange={(v) => setDone((s) => { const n = new Set(s); if (v) n.add(t); else n.delete(t); return n; })}>{t}</Checkbox>
        ))}
        <Checkbox isInvalid>Accept the terms</Checkbox>
        <Checkbox isDisabled>Disabled</Checkbox>
      </div>
      <div className="tf-stack">
        <p className="tf-demo-label">Radio</p>
        <RadioGroup label="Location" defaultValue="meet" orientation="vertical">
          <Radio value="meet">Google Meet</Radio><Radio value="phone">Phone call</Radio><Radio value="person">In person</Radio>
        </RadioGroup>
      </div>
      <div className="tf-stack">
        <p className="tf-demo-label">Switch</p>
        <Switch isSelected={on} onChange={setOn}>{on ? 'Page is on' : 'Page is hidden'}</Switch>
        <Switch>Email me on new bookings</Switch>
        <Switch defaultSelected>Ask guests for a phone number</Switch>
        <Switch isDisabled>Disabled</Switch>
      </div>
    </div>
  );
}
