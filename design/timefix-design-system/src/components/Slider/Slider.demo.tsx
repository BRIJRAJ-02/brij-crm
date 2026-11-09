import { useState } from 'react';
import { Slider } from './Slider.tsx';

const hours = [0, 12, 24, 36, 48].map((v) => ({ value: v, label: v === 0 ? 'None' : `${v}h` }));

export function SliderDemo() {
  const [notice, setNotice] = useState(12);
  const [price, setPrice] = useState([80, 240]);
  return (
    <div className="tf-demo" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 'var(--space-32)' }}>
      <Slider
        label="Minimum notice"
        value={notice}
        onChange={setNotice}
        minValue={0}
        maxValue={48}
        step={1}
        ticks={hours}
        formatOptions={{ style: 'unit', unit: 'hour', unitDisplay: 'short' }}
      />
      <Slider
        label="Price range"
        value={price}
        onChange={setPrice}
        minValue={0}
        maxValue={500}
        step={10}
        thumbLabels={['Lowest price', 'Highest price']}
        formatOptions={{ style: 'currency', currency: 'USD', maximumFractionDigits: 0 }}
      />
      <div className="tf-stack" style={{ gap: 'var(--space-24)' }}>
        <Slider label="Buffer after meetings" defaultValue={15} minValue={0} maxValue={60} step={5} formatOptions={{ style: 'unit', unit: 'minute', unitDisplay: 'short' }} />
        <Slider label="Team share" defaultValue={40} isDisabled formatOptions={{ style: 'percent' }} minValue={0} maxValue={1} step={0.05} />
      </div>
    </div>
  );
}
