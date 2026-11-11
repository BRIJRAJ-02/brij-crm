// Copy to another workspace: a form, a booking page or a link page goes to another workspace you can edit as a draft (forms Paused,
// booking pages Off, link pages Private), or just its look goes onto a page or form already there. Submissions, bookings and insights
// stay behind. Owner's ask (12 Nov); the real app has no such feature, so the design calls are the coordinator's.
import { useState } from 'react';
import { Check, Minus } from 'lucide-react';
import { Button } from '../Button/Button.tsx';
import { Dialog } from '../Dialog/Dialog.tsx';
import { TextField } from '../Field/Field.tsx';
import { Select } from '../Select/Select.tsx';
import { SegmentedControl } from '../SegmentedControl/SegmentedControl.tsx';
import { Callout } from '../Callout/Callout.tsx';

/** The demo's workspaces, and whether you can add pages in each (in Olive Kitchen you're only a member). */
export type WorkspaceKey = 'northwind' | 'lumen' | 'olive';
export const WORKSPACES: ReadonlyArray<{ readonly id: WorkspaceKey; readonly name: string; readonly canAdd: boolean }> = [
  { id: 'northwind', name: 'Northwind', canAdd: true }, { id: 'lumen', name: 'Lumen Hair Studio', canAdd: true }, { id: 'olive', name: 'Olive Kitchen', canAdd: false },
];
/** A workspace's name. */
export const wsName = (id: string) => WORKSPACES.find((w) => w.id === id)?.name ?? id;

/** What is being copied, in words the dialog uses. */
export interface CopySubject {
  readonly kind: 'form' | 'booking' | 'link';
  readonly name: string;
  /** For a form: the answers that save to a CRM field the other workspace doesn't have. */
  readonly unmatched?: (ws: WorkspaceKey) => ReadonlyArray<string>;
  /** What "Just the look" can go onto in that workspace. */
  readonly looksIn: (ws: WorkspaceKey) => ReadonlyArray<{ readonly id: string; readonly label: string }>;
}

const ALONG: Readonly<Record<CopySubject['kind'], { readonly comes: string; readonly stays: string; readonly draft: string }>> = {
  form: { comes: 'Questions, logic, endings, the look and settings', stays: 'Submissions and analytics', draft: 'It arrives Paused, so nobody answers it until you resume it.' },
  booking: { comes: 'Length, questions, hours, the look and settings', stays: 'Bookings, hosts’ calendars and insights', draft: 'It arrives Off, so nobody books it until you turn it on.' },
  link: { comes: 'Blocks, profile, photos and the look', stays: 'Clicks, views and insights', draft: 'It arrives Private, so nobody sees it until you turn on Live.' },
};

/** Copy to another workspace: a new draft copy, or just the look onto something already there. */
export function CopyToWorkspace({ subject, current, onClose, onCopy, onCopyLook }: {
  readonly subject: CopySubject; readonly current: WorkspaceKey; readonly onClose: () => void;
  readonly onCopy: (ws: WorkspaceKey, name: string) => void; readonly onCopyLook: (ws: WorkspaceKey, targetId: string) => void;
}) {
  const others = WORKSPACES.filter((w) => w.id !== current);
  const [ws, setWs] = useState<WorkspaceKey>(others.find((w) => w.canAdd)?.id ?? 'lumen');
  const [mode, setMode] = useState<'copy' | 'look'>('copy');
  const [name, setName] = useState(`${subject.name} (copy)`);
  const targets = subject.looksIn(ws);
  const [target, setTarget] = useState<string>();
  const pickedTarget = targets.some((t) => t.id === target) ? target : targets[0]?.id;
  const unmatched = subject.unmatched?.(ws) ?? [];
  const along = ALONG[subject.kind];
  const can = others.find((w) => w.id === ws)?.canAdd ?? false;
  return (
    <Dialog isOpen onOpenChange={(o) => { if (!o) onClose(); }} title="Copy to another workspace" description={`“${subject.name}” stays here as it is.`}
      actions={<><Button variant="ghost" slot="close">Cancel</Button>
        {mode === 'copy' ? <Button variant="primary" isDisabled={!can || !name.trim()} onPress={() => onCopy(ws, name.trim())}>{`Copy to ${wsName(ws)}`}</Button>
          : <Button variant="primary" isDisabled={!can || !pickedTarget} onPress={() => { if (pickedTarget) onCopyLook(ws, pickedTarget); }}>Copy the look</Button>}</>}>
      <div className="tf-rec__form">
        <SegmentedControl aria-label="What to copy" isFullWidth selectedKey={mode} onSelectionChange={(k) => setMode(k === 'look' ? 'look' : 'copy')} items={[{ id: 'copy', label: 'A new copy' }, { id: 'look', label: 'Just the look' }]} />
        <Select label="To" value={ws} onChange={(v) => { if (v) setWs(v as WorkspaceKey); }} items={others.map((w) => ({ id: w.id, label: w.name, isDisabled: !w.canAdd, description: w.canAdd ? undefined : 'You can’t add pages here' }))} />
        {mode === 'copy' ? <>
          <TextField label="Name" value={name} onChange={setName} />
          <ul className="tf-cw__along" aria-label="What comes along">
            <li><Check size={14} strokeWidth={2} aria-hidden="true" /><span><strong>Comes along:</strong> {along.comes}.</span></li>
            <li><Minus size={14} strokeWidth={2} aria-hidden="true" /><span><strong>Stays behind:</strong> {along.stays}.</span></li>
          </ul>
          {subject.kind === 'form' && (unmatched.length ? <Callout tone="warning">{`Will save nowhere until you pick a field: ${unmatched.join(', ')}. ${wsName(ws)} has no field by that name.`}</Callout>
            : <p className="tf-rec__muted">Answers that save to the CRM find fields with the same names there.</p>)}
          <p className="tf-rec__muted">{along.draft}</p>
        </> : <>
          {targets.length === 0 ? <p className="tf-rec__muted">{wsName(ws)} has nothing of this kind to dress yet. Make a new copy instead.</p>
            : <Select label="Onto" value={pickedTarget ?? null} onChange={(v) => setTarget(v ?? undefined)} items={targets.map((t) => ({ id: t.id, label: t.label }))} />}
          <p className="tf-rec__muted">Colours, fonts, corners and the cover go across. Its words, questions and settings stay as they are.</p>
        </>}
      </div>
    </Dialog>
  );
}
