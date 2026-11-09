import { useRef, useState } from 'react';
import { Download } from 'lucide-react';
import { QrCode, downloadQr } from './QrCode.tsx';
import { Button } from '../Button/Button.tsx';
import { TextField } from '../Field/Field.tsx';
import { Switch } from '../Checkbox/Checkbox.tsx';

const d14 = <Download size={14} strokeWidth={1.75} />;

export function QrCodeDemo() {
  const svg = useRef<SVGSVGElement>(null);
  const [value, setValue] = useState('https://timefix.com/priya');
  const [logo, setLogo] = useState(true);
  const link = value.trim() === '' ? 'https://timefix.com' : value;
  const save = (format: 'png' | 'svg') => { if (svg.current) void downloadQr(svg.current, 'timefix-qr', format); };
  return (
    <div className="tf-demo tf-demo--canvas" style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--space-24)', alignItems: 'flex-start' }}>
      <div className="tf-stack" style={{ gap: 'var(--space-12)', width: 'var(--size-menu)' }}>
        <QrCode ref={svg} value={link} withLogo={logo} label="QR code for Priya Raman's link page" />
        <div className="tf-row">
          <Button size="sm" variant="secondary" icon={d14} onPress={() => save('png')}>PNG</Button>
          <Button size="sm" variant="secondary" icon={d14} onPress={() => save('svg')}>SVG</Button>
        </div>
      </div>
      <div className="tf-stack" style={{ gap: 'var(--space-16)', flex: '1 1 var(--size-menu)', minWidth: 0 }}>
        <TextField label="Link" value={value} onChange={setValue} description="The code redraws as you type." />
        <Switch isSelected={logo} onChange={setLogo}>Timefix mark in the centre</Switch>
        <div className="tf-row" style={{ gap: 'var(--space-16)', alignItems: 'flex-start' }}>
          <QrCode size="sm" value="https://timefix.com/m/acme-cafe?table=T4" label="QR code for table T4's menu" frameLabel="Scan for the menu" ground="paper" />
          <QrCode size="sm" value="https://timefix.com/b/priya-raman/discovery-call" label="QR code for Discovery call" colour="#1d4ed8" />
        </div>
      </div>
    </div>
  );
}
