import { useState } from 'react';
import { NoteList, NotePage, type Note } from './NoteList.tsx';
import { PageSlide } from '../RecordPanel/RecordPanel.tsx';

const start: ReadonlyArray<Note> = [
  { id: 'n1', title: 'Discovery call recap', body: 'They dispatch 4,000 loads a week across three depots. Pain is double booking on Mondays.\n\n- Pilot in Leeds first\n- Pricing for one site', author: 'Sam Kim', updated: '2h ago' },
  { id: 'n2', title: 'Security review', body: 'SOC 2 report sent. Waiting on their IT team for SSO details and a data processing agreement.', author: 'Priya Raman', updated: 'Mon' },
  { id: 'n3', title: 'Pricing thoughts', body: 'Start at the Team plan for one depot, then move to Business when the other two join.', author: 'Jo Mendes', updated: '3 Nov' },
];

export function NoteListDemo() {
  const [notes, setNotes] = useState(start);
  const [openId, setOpenId] = useState<string>();
  const [fresh, setFresh] = useState<ReadonlySet<string>>(new Set());
  const note = notes.find((n) => n.id === openId);
  return (
    <div className="tf-demo tf-demo--canvas">
      <PageSlide pageKey={note ? `edit-${note.id}` : 'list'} direction={note ? 'forward' : 'back'}>
        {note ? (
          <NotePage note={note} onBack={() => setOpenId(undefined)}
            onSave={(n) => new Promise<void>((r) => window.setTimeout(() => { setNotes((l) => l.map((x) => (x.id === n.id ? { ...n, updated: 'just now' } : x))); r(); }, 500))} />
        ) : (
          <NoteList notes={notes} freshIds={fresh} onOpen={setOpenId}
            onNew={() => { const id = `n${Date.now()}`; setNotes((l) => [{ id, title: '', body: '', author: 'Priya Raman', updated: 'just now' }, ...l]); setFresh((s) => new Set(s).add(id)); setOpenId(id); }} />
        )}
      </PageSlide>
    </div>
  );
}
