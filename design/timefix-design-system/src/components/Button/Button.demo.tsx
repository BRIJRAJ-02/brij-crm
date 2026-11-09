import { useState } from 'react';
import { Plus, Share2, Filter, ArrowUpDown, MoreHorizontal, Trash2, Link2, Check } from 'lucide-react';
import { Button, IconButton } from './Button.tsx';
import { TextSwap } from '../Motion/Motion.tsx';

const i = { size: 16, strokeWidth: 1.75 } as const;
type SaveState = 'idle' | 'saving' | 'saved';

export function ButtonDemo() {
  const [save, setSave] = useState<SaveState>('idle');
  const [copied, setCopied] = useState(false);
  const onSave = () => {
    setSave('saving');
    window.setTimeout(() => setSave('saved'), 900);
    window.setTimeout(() => setSave('idle'), 2400);
  };
  return (
    <div className="tf-demo tf-stack" style={{ gap: 'var(--space-20)' }}>
      <div className="tf-row">
        <Button variant="primary" icon={<Plus {...i} />}>New meeting</Button>
        <Button variant="secondary" iconEnd={<Share2 {...i} />}>Share</Button>
        <Button variant="soft">Next</Button>
        <Button variant="ghost">Skip</Button>
        <IconButton label="More actions" variant="secondary"><MoreHorizontal {...i} /></IconButton>
        <Button variant="danger" icon={<Trash2 {...i} />}>Delete workspace</Button>
      </div>
      <div className="tf-row">
        <Button size="sm" icon={<Filter size={14} strokeWidth={1.75} />}>Filter</Button>
        <Button size="sm" icon={<ArrowUpDown size={14} strokeWidth={1.75} />}>Sort</Button>
        <Button size="sm" variant="primary" icon={<Plus size={14} strokeWidth={1.75} />}>New company</Button>
        <Button size="lg" variant="primary">Confirm booking</Button>
        <Button isDisabled>Disabled</Button>
      </div>
      <div className="tf-row">
        <Button variant="primary" isPending={save === 'saving'} onPress={onSave} style={{ minWidth: 140 }}>
          <TextSwap swapKey={save}>{save === 'saved' ? <><Check size={16} strokeWidth={2.25} />Saved</> : save === 'saving' ? 'Saving' : 'Save changes'}</TextSwap>
        </Button>
        <Button variant="secondary" icon={copied ? <Check {...i} /> : <Link2 {...i} />} onPress={() => { setCopied(true); window.setTimeout(() => setCopied(false), 1600); }}>
          <TextSwap swapKey={String(copied)}>{copied ? 'Copied' : 'Copy link'}</TextSwap>
        </Button>
        <span className="tf-faint" style={{ fontSize: 13 }}>Press them: save morphs, copy confirms.</span>
      </div>
    </div>
  );
}
