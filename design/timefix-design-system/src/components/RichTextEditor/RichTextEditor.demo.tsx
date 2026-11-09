import { useState } from 'react';
import { NoteEditor, RichTextEditor, type MentionPerson } from './RichTextEditor.tsx';

const PEOPLE: ReadonlyArray<MentionPerson> = [
  { id: 'u1', name: 'Priya Raman', email: 'priya@acme.com', role: 'Account executive' },
  { id: 'u2', name: 'Sam Kim', email: 'sam@acme.com', role: 'Solutions engineer' },
  { id: 'u3', name: 'Jo Mendes', email: 'jo@acme.com', role: 'Head of sales' },
  { id: 'u4', name: 'Ava Chen', email: 'ava@northwind.com', role: 'Champion at Northwind' },
  { id: 'u5', name: 'Maria Bell', email: 'maria@globex.com', role: 'Buyer at Globex' },
];

const NOTE = `
<p>Northwind wants the <strong>team plan</strong> for 40 seats, starting in January. <span data-mention data-id="u4" data-label="Ava Chen"></span> is the champion; legal sits with <span data-mention data-id="u5" data-label="Maria Bell"></span>.</p>
<h2>Next steps</h2>
<ul data-type="taskList">
  <li data-type="taskItem" data-checked="true"><p>Send the pricing sheet</p></li>
  <li data-type="taskItem" data-checked="false"><p>Book the security review with <span data-mention data-id="u2" data-label="Sam Kim"></span></p></li>
  <li data-type="taskItem" data-checked="false"><p>Draft the order form</p></li>
</ul>
<p>Risk: <mark>budget is not signed off until 12 Dec</mark>. Their docs are at <a href="https://northwind.example.com">northwind.example.com</a>.</p>
`;

const COMMENT = `<p>Moved the Demo (45 min) to Thursday so <span data-mention data-id="u3" data-label="Jo Mendes"></span> can join. Agenda is in the deal notes.</p>`;

export function RichTextEditorDemo() {
  const [title, setTitle] = useState('Discovery call with Northwind');
  const [saved, setSaved] = useState('Not saved yet');
  return (
    <div className="tf-demo" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: 'var(--space-32)', alignItems: 'start' }}>
      <div className="tf-stack" style={{ gap: 'var(--space-8)' }}>
        <p className="tf-demo-label">NoteEditor · select text, type / or @</p>
        <NoteEditor label="Note" title={title} onTitleChange={setTitle} people={PEOPLE} defaultContent={NOTE}
          onChange={(doc) => setSaved(`Saved ${String(doc.content?.length ?? 0)} blocks`)} />
        <p className="tf-faint" style={{ margin: 0, fontSize: 12 }} aria-live="polite">{saved}</p>
      </div>
      <div className="tf-stack" style={{ gap: 'var(--space-24)' }}>
        <div className="tf-stack" style={{ gap: 'var(--space-8)' }}>
          <p className="tf-demo-label">Empty, with placeholder</p>
          <RichTextEditor label="Comment" people={PEOPLE} placeholder="Add a comment, @ to mention" />
        </div>
        <div className="tf-stack" style={{ gap: 'var(--space-8)' }}>
          <p className="tf-demo-label">Read only</p>
          <RichTextEditor label="Comment by Priya Raman" people={PEOPLE} defaultContent={COMMENT} isReadOnly readOnlyReason="Only Priya can edit this comment." />
        </div>
      </div>
    </div>
  );
}
