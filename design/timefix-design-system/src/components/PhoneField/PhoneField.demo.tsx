import { useState } from 'react';
import { PhoneField, phoneToString, type PhoneValue } from './PhoneField.tsx';

export function PhoneFieldDemo() {
  const [phone, setPhone] = useState<PhoneValue>({ country: 'IN', national: '9876543210' });
  const [guest, setGuest] = useState<PhoneValue>({ country: 'US', national: '' });
  const short = guest.national.length > 0 && guest.national.length < 10;
  return (
    <div className="tf-demo" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 'var(--space-24)' }}>
      <div className="tf-stack" style={{ gap: 'var(--space-8)' }}>
        <PhoneField label="Phone or WhatsApp" value={phone} onChange={setPhone} />
        <span className="tf-muted tf-num" style={{ fontSize: 13 }}>Saved as {phone.national ? phoneToString(phone) : '—'}</span>
      </div>
      <PhoneField
        label="Your phone"
        aside="Optional"
        size="lg"
        value={guest}
        onChange={setGuest}
        isInvalid={short}
        errorMessage="That number looks short. US numbers have 10 digits."
        description={short ? undefined : 'Paste “+44 7700 900123” to switch country.'}
      />
      <PhoneField label="Office line" defaultValue={{ country: 'GB', national: '2079460958' }} isDisabled description="Synced from Acme Corp." />
    </div>
  );
}
