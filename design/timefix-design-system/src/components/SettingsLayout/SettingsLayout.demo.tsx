import { useState } from 'react';
import { User, Bell, Building2, Users, CreditCard, CalendarDays, Database, Upload, Palette, Check } from 'lucide-react';
import { SettingsLayout, SettingsNav, SettingsSection, SettingsRow, SettingsField, type SettingsNavGroup } from './SettingsLayout.tsx';
import { SegmentedControl } from '../SegmentedControl/SegmentedControl.tsx';
import { ShowMore } from '../Disclosure/Disclosure.tsx';
import { Switch, Checkbox } from '../Checkbox/Checkbox.tsx';
import { Button } from '../Button/Button.tsx';
import { Tag } from '../Tag/Tag.tsx';
import { TextSwap } from '../Motion/Motion.tsx';

const i = { size: 16, strokeWidth: 1.75 } as const;
const NAV: ReadonlyArray<SettingsNavGroup> = [
  { title: 'Account', items: [{ id: 'profile', label: 'Profile', icon: <User {...i} /> }, { id: 'notifications', label: 'Notifications', icon: <Bell {...i} /> }] },
  { title: 'Workspace', items: [
    { id: 'general', label: 'General', icon: <Building2 {...i} /> }, { id: 'members', label: 'Members', icon: <Users {...i} /> },
    { id: 'brand', label: 'Brand', icon: <Palette {...i} /> }, { id: 'billing', label: 'Billing', icon: <CreditCard {...i} /> },
    { id: 'calendars', label: 'Calendars', icon: <CalendarDays {...i} /> },
  ] },
  { title: 'Data', items: [{ id: 'objects', label: 'Objects', icon: <Database {...i} /> }, { id: 'import', label: 'Import', icon: <Upload {...i} /> }] },
];

export function SettingsLayoutDemo() {
  const [current, setCurrent] = useState('general');
  const [saved, setSaved] = useState('Timefix');
  const [name, setName] = useState('Timefix');
  const [save, setSave] = useState<'idle' | 'saving' | 'saved'>('idle');
  const [week, setWeek] = useState('mon');
  const [clock, setClock] = useState('24h');
  const dirty = name.trim() !== saved && name.trim() !== '';
  const onSave = () => {
    setSave('saving');
    window.setTimeout(() => { setSaved(name.trim()); setSave('saved'); }, 700);
    window.setTimeout(() => setSave('idle'), 2000);
  };
  return (
    <div className="tf-demo" style={{ height: 640, padding: 0 }}>
      <SettingsLayout title="General" description="How your workspace looks and behaves for everyone in it." nav={<SettingsNav groups={NAV} current={current} onNavigate={setCurrent} />}>
        <SettingsSection
          title="Workspace name"
          description="Shown in the sidebar, invites and booking emails."
          footnote="Use 32 characters at most."
          action={
            <Button size="sm" variant="primary" isDisabled={!dirty && save === 'idle'} isPending={save === 'saving'} onPress={onSave}>
              <TextSwap swapKey={save}>{save === 'saved' ? <><Check size={14} strokeWidth={2.25} />Saved</> : 'Save'}</TextSwap>
            </Button>
          }
        >
          <SettingsField label="Name" value={name} onChange={setName} maxLength={32} />
          <SettingsField label="Booking link" value="timefix" onChange={() => undefined} prefix="timefix.com/" description="Changing it breaks links you have already shared." />
        </SettingsSection>
        <SettingsSection title="Calendar" description="Defaults for new booking pages and the bookings calendar." status={<Tag size="sm" status="done">Google connected</Tag>}>
          <SettingsRow title="Week starts on" description="Also the first column in month views." control={<SegmentedControl aria-label="Week starts on" size="sm" selectedKey={week} onSelectionChange={setWeek} items={[{ id: 'mon', label: 'Monday' }, { id: 'sun', label: 'Sunday' }]} />} />
          <SettingsRow title="Time format" description="How times read across Timefix." control={<SegmentedControl aria-label="Time format" size="sm" selectedKey={clock} onSelectionChange={setClock} items={[{ id: '12h', label: '12h' }, { id: '24h', label: '24h' }]} />} />
          <SettingsRow title="Show weekends" description="Saturday and Sunday in week views." control={<Switch aria-label="Show weekends" defaultSelected />} />
          <div style={{ paddingTop: 'var(--space-8)' }}>
            <ShowMore>
              <div className="tf-stack" style={{ gap: 'var(--space-8)' }}>
                <Checkbox defaultSelected>Decline bookings that overlap a busy event</Checkbox>
                <Checkbox>Hide private event titles from teammates</Checkbox>
              </div>
            </ShowMore>
          </div>
        </SettingsSection>
        <SettingsSection title="Danger zone" description="These cannot be undone." tone="danger">
          <SettingsRow title="Transfer ownership" description="Make another admin the owner of Timefix." control={<Button size="sm" variant="secondary">Transfer…</Button>} />
          <SettingsRow title="Delete workspace" description="Removes 1,284 companies, 3,412 people and every booking page." control={<Button size="sm" variant="secondary">Delete workspace…</Button>} />
        </SettingsSection>
      </SettingsLayout>
    </div>
  );
}
