// The business page's settings: the page and its link first, then the profile and opening hours. Changes apply as you make them.
import { Copy, Play } from 'lucide-react';
import { HoursEditor } from '../HoursEditor/HoursEditor.tsx';
import { TextField, TextArea } from '../Field/Field.tsx';
import { ChoiceChips } from '../ChoiceChips/ChoiceChips.tsx';
import { Switch } from '../Checkbox/Checkbox.tsx';
import { Callout } from '../Callout/Callout.tsx';
import { ShowMore } from '../Disclosure/Disclosure.tsx';
import { Button } from '../Button/Button.tsx';
import { Tag } from '../Tag/Tag.tsx';
import { useToast } from '../Toast/Toast.tsx';
import { Section, SettingRow, i14 } from '../BookingsFlow/parts.tsx';
import { pageProblems, type BizAction, type BizState, type Business } from './state.ts';

const AMENITIES = ['Wi-Fi', 'Card payments', 'Wheelchair access', 'Parking', 'Outdoor seating', 'Vegetarian options', 'Kid friendly', 'Air conditioning'];

/** The Business page tab. Problems that stop the page going live show at the top, each with where to fix it. */
export function BusinessTab({ state, dispatch, onGuest, onGo }: { readonly state: BizState; readonly dispatch: (a: BizAction) => void; readonly onGuest: () => void; readonly onGo: (tab: string) => void }) {
  const { toast } = useToast();
  const b = state.business;
  const set = (p: Partial<Business>) => dispatch({ type: 'patch', patch: { business: { ...b, ...p } } });
  const problems = pageProblems(state);
  const url = `timefix.com/${b.handle}`;
  const fixTab = (id: string) => (id === 'services' ? 'services' : id === 'staff' ? 'team' : id === 'tables' ? 'tables' : undefined);
  return (
    <div className="tf-bkf__tab">
      <div className="tf-bkf-cards">
        <Section className="tf-bkf-card" title="Your page" description={b.published ? 'Guests find you and book here.' : 'Not live yet. Publish when it’s ready.'}
          action={<Tag size="sm" hue={b.published && problems.length === 0 ? 'green' : 'gray'}>{b.published && problems.length === 0 ? 'Live' : 'Not live'}</Tag>}>
          <div className="tf-bzf-link">
            <span className="tf-bzf-link__url tf-num">{url}</span>
            <Button size="sm" variant="secondary" icon={<Copy {...i14} />} onPress={() => { void navigator.clipboard?.writeText(`https://${url}`).catch(() => undefined); toast({ message: 'Link copied', tone: 'success' }); }}>Copy</Button>
            <Button size="sm" variant="ghost" icon={<Play {...i14} />} onPress={onGuest}>See it as a guest</Button>
            {b.published
              ? <Button size="sm" variant="ghost" onPress={() => { set({ published: false }); toast({ message: 'The page is off. Its link says you’re not taking bookings online.', action: { label: 'Undo', onAction: () => set({ published: true }) } }); }}>Take it offline</Button>
              : <Button size="sm" variant="primary" isDisabled={problems.length > 0} onPress={() => { set({ published: true }); toast({ message: `Live at ${url}`, tone: 'success' }); }}>Publish</Button>}
          </div>
          {problems.length > 0 && (
            <Callout tone="warning">
              <span className="tf-bzf-problems">
                {problems.map((p) => (
                  <span key={p.id} className="tf-bzf-problem">{p.text}{fixTab(p.id) && <Button size="sm" variant="ghost" onPress={() => onGo(fixTab(p.id) ?? '')}>Fix</Button>}</span>
                ))}
              </span>
            </Callout>
          )}
        </Section>
        <Section className="tf-bkf-card" title="Profile" description="What guests read at the top of your page.">
          <div className="tf-bkf__stack">
            <div className="tf-bkf__pair">
              <TextField label="Name" value={b.name} onChange={(name) => set({ name })} isInvalid={!b.name.trim()} errorMessage="Add your business name." />
              <TextField label="Kind of business" value={b.kindLabel} onChange={(kindLabel) => set({ kindLabel })} placeholder="Hair salon" />
            </div>
            <TextField label="Address" value={b.address} onChange={(address) => set({ address })} isInvalid={!b.address.trim()} errorMessage="Guests need it to find you." />
            <TextField label="Phone" type="tel" value={b.phone} onChange={(phone) => set({ phone })} />
            <TextArea label="About" aside="Optional" rows={3} value={b.about} onChange={(about) => set({ about })} />
          </div>
        </Section>
        <Section className="tf-bkf-card" title="Opening hours" description={state.business.kind === 'salon' ? 'Nobody can be booked outside these.' : 'Bookings fit inside these; add a second range for dinner.'}>
          <HoursEditor value={b.hours} onChange={(hours) => set({ hours })} />
        </Section>
        <ShowMore showLabel="More options" hideLabel="Fewer options">
          <div className="tf-bkf-card">
            <div className="tf-bkf-settings">
              <SettingRow title="Page link" description="Letters, numbers and dashes.">
                <TextField label="Page link" isLabelHidden value={b.handle} onChange={(v) => set({ handle: v.toLowerCase().replace(/[^a-z0-9-]/g, '-') })} icon={<span className="tf-bkf__prefix">timefix.com/</span>} />
              </SettingRow>
              <SettingRow title="Show in search" description="Lets people find the page from search engines and maps.">
                <Switch aria-label="Show in search" isSelected={b.showInSearch} onChange={(showInSearch) => set({ showInSearch })} />
              </SettingRow>
            </div>
            <ChoiceChips label="Amenities" selectionMode="multiple" size="sm" selectedKeys={b.amenities} onSelectionChange={(k) => set({ amenities: AMENITIES.filter((a) => k.has(a)) })} items={AMENITIES.map((a) => ({ id: a, label: a }))} />
          </div>
        </ShowMore>
      </div>
    </div>
  );
}
