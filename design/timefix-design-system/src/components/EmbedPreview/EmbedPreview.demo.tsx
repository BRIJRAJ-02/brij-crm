import { useState } from 'react';
import { EmbedPreview, type EmbedMode } from './EmbedPreview.tsx';

export function EmbedPreviewDemo() {
  const [mode, setMode] = useState<EmbedMode>('inline');
  return (
    <div className="tf-demo">
      <EmbedPreview
        mode={mode}
        onModeChange={setMode}
        url="https://timefix.com/priya/discovery"
        words="Book a call"
        accent="#1F5FD6"
        site="acme.com/contact"
        page={{ host: 'Priya Raman', title: 'Discovery call', duration: '30 min', openDays: [true, true, true, true, true, false, false], hue: 'blue' }}
      />
    </div>
  );
}
