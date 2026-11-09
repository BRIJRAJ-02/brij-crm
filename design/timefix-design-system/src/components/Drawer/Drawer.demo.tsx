import { useState } from 'react';
import { Trash2 } from 'lucide-react';
import { Avatar } from '../Avatar/Avatar.tsx';
import { Button } from '../Button/Button.tsx';
import { DialogField } from '../Dialog/Dialog.tsx';
import { Drawer, DrawerPanel, type DrawerSaveState } from './Drawer.tsx';

interface Contact { readonly name: string; readonly email: string; readonly phone: string }
const start: Contact = { name: 'Priya Raman', email: 'priya@northwind.com', phone: '' };

function useContactForm() {
  const [saved, setSaved] = useState<Contact>(start);
  const [draft, setDraft] = useState<Contact>(start);
  const [state, setState] = useState<DrawerSaveState>('clean');
  const dirty = JSON.stringify(saved) !== JSON.stringify(draft);
  const shown: DrawerSaveState = state === 'saving' || state === 'saved' ? state : dirty ? 'dirty' : 'clean';
  const save = () => {
    setState('saving');
    window.setTimeout(() => { setSaved(draft); setState('saved'); }, 700);
    window.setTimeout(() => setState('clean'), 1900);
  };
  const fields = (
    <>
      <DialogField label="Name" value={draft.name} onChange={(v) => setDraft({ ...draft, name: v })} />
      <DialogField label="Email" type="email" value={draft.email} onChange={(v) => setDraft({ ...draft, email: v })} />
      <DialogField label="Phone (optional)" value={draft.phone} placeholder="+1 555 0100" onChange={(v) => setDraft({ ...draft, phone: v })} />
    </>
  );
  return { saved, state: shown, save, discard: () => setDraft(saved), fields };
}

export function DrawerDemo() {
  const [open, setOpen] = useState(false);
  const modal = useContactForm();
  const inline = useContactForm();
  const del = <Button variant="ghost" icon={<Trash2 size={16} strokeWidth={1.75} />}>Delete</Button>;
  return (
    <div className="tf-demo tf-demo--canvas" style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1.3fr)', gap: 'var(--space-24)', height: 380 }}>
      <div className="tf-stack">
        <p className="tf-demo-label" style={{ margin: 0 }}>Over the page</p>
        <div><Button variant="secondary" onPress={() => setOpen(true)}>Edit {modal.saved.name}</Button></div>
        <p className="tf-faint" style={{ margin: 0, fontSize: 13 }}>Change a field, then try Esc or a click outside: the drawer stays and nudges Save. Discard, then Esc closes it.</p>
        <p className="tf-faint" style={{ margin: 'var(--space-12) 0 0', fontSize: 13 }}>On the right, the same drawer placed in the layout: edit a field to see the footer swap Done for Discard and Save.</p>
      </div>
      <DrawerPanel title={inline.saved.name} subtitle="Contact · Northwind" leading={<Avatar name={inline.saved.name} size={36} />}
        footerStart={del} saveState={inline.state} onSave={inline.save} onDiscard={inline.discard} onClose={() => undefined}>
        {inline.fields}
      </DrawerPanel>
      <Drawer isOpen={open} onOpenChange={setOpen} title="Edit contact" subtitle={modal.saved.name} footerStart={del}
        saveState={modal.state} onSave={modal.save} onDiscard={modal.discard}>
        {modal.fields}
      </Drawer>
    </div>
  );
}
