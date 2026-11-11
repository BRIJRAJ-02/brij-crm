import { useState } from 'react';
import { Button } from '../Button/Button.tsx';
import { ShareSheet } from './ShareSheet.tsx';

export function ShareSheetDemo() {
  const [open, setOpen] = useState(false);
  return (
    <div className="tf-demo">
      <Button variant="secondary" onPress={() => setOpen(true)}>Share</Button>
      <ShareSheet isOpen={open} onOpenChange={setOpen} title="Share Discovery call" url="timefix.com/priya/discovery-call" name="Discovery call" invite="Pick a time that suits you:" onSite={() => setOpen(false)} />
    </div>
  );
}
