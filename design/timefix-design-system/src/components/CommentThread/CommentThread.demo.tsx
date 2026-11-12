import { useState } from 'react';
import { CommentThread, type Comment, type ReactionKind } from './CommentThread.tsx';

const me = 'Priya Raman';
const people = ['Priya Raman', 'Sam Kim', 'Jo Mendes', 'Ava Chen', 'Maria Bell'];
const start: ReadonlyArray<Comment> = [
  { id: 'c1', author: 'Sam Kim', time: '2h ago', body: 'Demo went well. @Priya Raman can you send the one-depot pricing before Thursday?', reactions: { agree: ['Jo Mendes'], seen: ['Priya Raman', 'Ava Chen'] } },
  { id: 'c2', author: 'Jo Mendes', time: '1h ago', body: 'Their IT team asked about SSO. I shared the security pack.', reactions: { done: ['Sam Kim'] } },
];

export function CommentThreadDemo() {
  const [comments, setComments] = useState(start);
  const [fresh, setFresh] = useState<ReadonlySet<string>>(new Set());
  const react = (id: string, kind: ReactionKind) => setComments((list) => list.map((c) => {
    if (c.id !== id) return c;
    const who = c.reactions?.[kind] ?? [];
    return { ...c, reactions: { ...c.reactions, [kind]: who.includes(me) ? who.filter((w) => w !== me) : [...who, me] } };
  }));
  const send = (body: string, replyTo?: string) => new Promise<void>((resolve) => window.setTimeout(() => {
    const id = `c${Date.now()}`;
    setComments((list) => [...list, { id, author: me, time: 'Just now', body, replyTo }]);
    setFresh((s) => new Set(s).add(id));
    resolve();
  }, 700));
  return (
    <div className="tf-demo"><div className="tf-thread-demo"><CommentThread comments={comments} me={me} people={people} onReact={react} onSend={send} freshIds={fresh} /></div></div>
  );
}
