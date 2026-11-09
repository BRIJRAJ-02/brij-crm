import { Bold, Italic, Link2, Trash2, Star } from 'lucide-react';
import { Tooltip } from './Tooltip.tsx';
import { IconButton, Button } from '../Button/Button.tsx';

const i = { size: 16, strokeWidth: 1.75 } as const;
export function TooltipDemo() {
  return (
    <div className="tf-demo tf-row" style={{ gap: 'var(--space-6)', paddingTop: 'var(--space-48)' }}>
      <Tooltip label="Bold" shortcut="⌘B"><IconButton label="Bold"><Bold {...i} /></IconButton></Tooltip>
      <Tooltip label="Italic" shortcut="⌘I"><IconButton label="Italic"><Italic {...i} /></IconButton></Tooltip>
      <Tooltip label="Copy link"><IconButton label="Copy link"><Link2 {...i} /></IconButton></Tooltip>
      <Tooltip label="Add to favourites" placement="bottom"><IconButton label="Add to favourites"><Star {...i} /></IconButton></Tooltip>
      <Tooltip label="Remove"><IconButton label="Remove"><Trash2 {...i} /></IconButton></Tooltip>
      <span style={{ width: 'var(--space-16)' }} />
      <Tooltip label="Only owners can delete a workspace"><Button isDisabled>Delete workspace</Button></Tooltip>
    </div>
  );
}
