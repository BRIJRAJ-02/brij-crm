import { useState } from 'react';
import { NumberField } from './NumberField.tsx';

export function NumberFieldDemo() {
  const [deal, setDeal] = useState(12500);
  const [discount, setDiscount] = useState(15);
  const net = Number.isFinite(deal) && Number.isFinite(discount) ? deal * (1 - discount / 100) : 0;
  return (
    <div className="tf-demo" style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 'var(--space-24) var(--space-20)' }}>
      <NumberField label="Deal value" mode="currency" currency="USD" value={deal} onChange={setDeal} minValue={0} step={500} description="Acme Corp · renewal" />
      <NumberField label="Discount" mode="percent" value={discount} onChange={setDiscount} minValue={0} maxValue={100} step={5} description={`Net ${net.toLocaleString('en-US', { style: 'currency', currency: 'USD' })}`} />
      <NumberField label="Seats" unit="seats" defaultValue={5} minValue={1} maxValue={50} />
      <NumberField label="Guests" size="lg" defaultValue={2} minValue={1} maxValue={8} description="Up to 8 per table" />
      <NumberField label="Price per session" mode="currency" currency="EUR" defaultValue={-20} isInvalid errorMessage="Use a price of €0 or more." />
      <NumberField label="Buffer after" unit="min" defaultValue={15} isDisabled description="Set by the team’s policy." />
    </div>
  );
}
