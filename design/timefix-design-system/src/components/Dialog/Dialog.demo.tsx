import { useState } from 'react';
import { LogOut, Trash2, UserPlus, Wand2 } from 'lucide-react';
import { Button } from '../Button/Button.tsx';
import { RadioGroup, Radio } from '../Checkbox/Checkbox.tsx';
import { ConfirmDialog, DialogField, DialogPreview, InviteDialog, StepDialog } from './Dialog.tsx';

const i = { size: 16, strokeWidth: 1.75 } as const;
type Open = 'none' | 'delete' | 'signout' | 'invite' | 'steps';

export function DialogDemo() {
  const [open, setOpen] = useState<Open>('none');
  const [log, setLog] = useState('Open one: each takes Esc, a click outside, and Tab.');
  const [name, setName] = useState('');
  const set = (o: Open) => (v: boolean) => setOpen(v ? o : 'none');
  return (
    <div className="tf-demo tf-demo--canvas" style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr)', gap: 'var(--space-24)', alignItems: 'start' }}>
      <div className="tf-stack">
        <p className="tf-demo-label">Confirm, in place</p>
        <DialogPreview title="Delete Acme Corp?" description="Its 12 people and 4 deals stay. The company page and its notes go for good."
          actions={<><Button variant="ghost">Cancel</Button><Button variant="danger">Delete company</Button></>} />
      </div>
      <div className="tf-stack">
        <p className="tf-demo-label">Live</p>
        <div className="tf-row">
          <Button variant="secondary" icon={<Trash2 {...i} />} onPress={() => setOpen('delete')}>Delete company</Button>
          <Button variant="secondary" icon={<LogOut {...i} />} onPress={() => setOpen('signout')}>Sign out</Button>
        </div>
        <div className="tf-row">
          <Button variant="secondary" icon={<UserPlus {...i} />} onPress={() => setOpen('invite')}>Invite people</Button>
          <Button variant="secondary" icon={<Wand2 {...i} />} onPress={() => setOpen('steps')}>New booking page</Button>
        </div>
        <p className="tf-faint" style={{ margin: 0, fontSize: 13 }} aria-live="polite">{log}</p>
      </div>

      <ConfirmDialog isOpen={open === 'delete'} onOpenChange={set('delete')} title="Delete Acme Corp?"
        consequence="Its 12 people and 4 deals stay. The company page and its notes go for good." confirmLabel="Delete company"
        onConfirm={() => new Promise<void>((r) => window.setTimeout(r, 900)).then(() => setLog('Acme Corp deleted.'))} />
      <ConfirmDialog isOpen={open === 'signout'} onOpenChange={set('signout')} tone="primary" title="Sign out of Timefix?"
        consequence="You'll need your email link to get back in on this device." confirmLabel="Sign out" onConfirm={() => setLog('Signed out (not really).')} />
      <InviteDialog isOpen={open === 'invite'} onOpenChange={set('invite')} description="They get an email with a link to join Northwind."
        onInvite={(emails) => setLog(`Invited ${emails.join(', ')}.`)} />
      <StepDialog isOpen={open === 'steps'} onOpenChange={set('steps')} onFinish={() => setLog(`Created “${name || 'Discovery call'}”.`)}
        canContinue={(s) => s !== 0 || name.trim() !== ''}
        steps={[
          { title: 'Name your booking page', description: 'Guests see this at the top of the page.', content: <DialogField label="Name" value={name} onChange={setName} placeholder="Discovery call" autoFocus /> },
          { title: 'How long is it?', content: (
            <RadioGroup label="Duration" defaultValue="30" orientation="vertical">
              <Radio value="15">15 minutes</Radio><Radio value="30">30 minutes</Radio><Radio value="45">45 minutes</Radio><Radio value="60">1 hour</Radio>
            </RadioGroup>
          ) },
          { title: 'Where do you meet?', description: 'You can add more places later.', nextLabel: 'Create page', content: (
            <RadioGroup label="Location" defaultValue="meet">
              <Radio value="meet">Google Meet</Radio><Radio value="phone">Phone</Radio>
            </RadioGroup>
          ) },
        ]} />
    </div>
  );
}
