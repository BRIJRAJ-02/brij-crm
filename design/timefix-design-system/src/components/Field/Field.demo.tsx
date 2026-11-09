import { useState } from 'react';
import { Mail, Link2 } from 'lucide-react';
import { TextField, TextArea, Form, FieldGroup, FormActions } from './Field.tsx';
import { Button } from '../Button/Button.tsx';
import { TextSwap } from '../Motion/Motion.tsx';

const i = { size: 16, strokeWidth: 1.75 } as const;

export function FieldDemo() {
  const [saved, setSaved] = useState(false);
  const [slug, setSlug] = useState('priya');
  const taken = slug.trim() === 'sam';
  return (
    <div className="tf-demo" style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1.6fr) minmax(0, 1fr)', gap: 'var(--space-32)' }}>
      <Form
        onSubmit={(e) => { e.preventDefault(); setSaved(true); window.setTimeout(() => setSaved(false), 1800); }}
        onReset={() => setSaved(false)}
      >
        <FieldGroup title="New person" columns={2}>
          <TextField label="First name" name="first" defaultValue="Priya" isRequired errorMessage="Add a first name." />
          <TextField label="Last name" name="last" aside="Optional" placeholder="Raman" />
          <TextField label="Work email" name="email" type="email" isRequired placeholder="priya@acme.com" icon={<Mail {...i} />} errorMessage="Enter an email like name@company.com." />
          <TextField label="Company" name="company" defaultValue="Acme Corp" />
          <TextArea label="Notes" name="notes" placeholder="What did you talk about?" rows={2} maxLength={140} showCount defaultValue="Met at the Northwind demo. Wants a follow up after the 45 min call with Sam." />
        </FieldGroup>
        <FormActions>
          <Button type="reset" variant="ghost">Reset</Button>
          <Button type="submit" variant="primary" style={{ minWidth: 120 }}>
            <TextSwap swapKey={String(saved)}>{saved ? 'Saved' : 'Save person'}</TextSwap>
          </Button>
        </FormActions>
      </Form>
      <div className="tf-stack" style={{ gap: 'var(--space-16)' }}>
        <p className="tf-demo-label" style={{ margin: 0 }}>Guest page, 44px</p>
        <TextField size="lg" label="Your name" placeholder="Jo Mendes" autoComplete="name" />
        <TextField
          label="Booking link"
          value={slug}
          onChange={setSlug}
          icon={<Link2 {...i} />}
          suffix="/demo"
          isInvalid={taken}
          errorMessage="Sam Kim already uses this link. Try another."
          description={taken ? undefined : 'Type “sam” to see a server refusal shake.'}
        />
        <TextField label="Workspace ID" defaultValue="ws_acme_41f2" isDisabled description="Set when the workspace was created." />
      </div>
    </div>
  );
}
