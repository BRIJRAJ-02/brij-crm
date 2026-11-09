import { DialogTrigger, Button as AriaButton, Autocomplete, ListBox, ListBoxItem, ToggleButtonGroup, ToggleButton, useFilter, type Key } from 'react-aria-components';
import { useEffect, useRef, useState, type ComponentType } from 'react';
import {
  Building2, Briefcase, Store, Factory, Landmark, Handshake, Wallet, CreditCard, Receipt, PiggyBank, ChartLine, ChartPie, Target, Rocket, Trophy,
  Users, User, UserRound, Contact, IdCard, Baby, GraduationCap, HeartHandshake, Mail, MessageSquare, Phone, Video, Megaphone, Send, AtSign, Inbox,
  Calendar, CalendarDays, Clock, Timer, AlarmClock, Hourglass, Repeat, History, Folder, FileText, Book, Bookmark, Tag, Package, Box, Gift, Key as KeyIcon,
  Lock, Star, Heart, Flag, Lightbulb, Zap, Globe, MapPin, House, Coffee, Utensils, Scissors, Stethoscope, Dumbbell, Car, Plane, Music, Camera, Palette,
  Code, Wrench, Settings, Sparkles, Leaf, Sun, ChevronDown, type LucideProps,
} from 'lucide-react';
import { cx } from '../../lib/cx.ts';
import type { Hue } from '../Tag/Tag.tsx';
import { Popover, PopoverSearch } from '../Popover/Popover.tsx';
import './IconPicker.css';

/** A group of icons in the picker's category row. */
export type IconCategory = 'business' | 'people' | 'talk' | 'time' | 'things' | 'places';
/** One curated icon: a stable name (what is saved), its Lucide component, a category and search words. */
export interface IconEntry { readonly name: string; readonly Icon: ComponentType<LucideProps>; readonly category: IconCategory; readonly keywords?: string }

const e = (name: string, Icon: ComponentType<LucideProps>, category: IconCategory, keywords?: string): IconEntry => ({ name, Icon, category, keywords });
/** The curated set objects and pages choose from; the bundle carries only these. */
export const ICONS: ReadonlyArray<IconEntry> = [
  e('Building', Building2, 'business', 'company office'), e('Briefcase', Briefcase, 'business', 'work job deal'), e('Store', Store, 'business', 'shop retail'),
  e('Factory', Factory, 'business', 'manufacturing'), e('Bank', Landmark, 'business', 'finance'), e('Handshake', Handshake, 'business', 'deal partner'),
  e('Wallet', Wallet, 'business', 'money'), e('Card', CreditCard, 'business', 'payment billing'), e('Receipt', Receipt, 'business', 'invoice'),
  e('Savings', PiggyBank, 'business', 'money'), e('Growth', ChartLine, 'business', 'chart revenue'), e('Share', ChartPie, 'business', 'chart pie'),
  e('Target', Target, 'business', 'goal'), e('Launch', Rocket, 'business', 'rocket start'), e('Trophy', Trophy, 'business', 'win award'),
  e('Team', Users, 'people', 'group members'), e('Person', User, 'people', 'contact'), e('Guest', UserRound, 'people', 'attendee'),
  e('Contact', Contact, 'people', 'address book'), e('ID card', IdCard, 'people', 'badge identity'), e('Child', Baby, 'people', 'kid'),
  e('Student', GraduationCap, 'people', 'education school'), e('Care', HeartHandshake, 'people', 'support volunteer'),
  e('Email', Mail, 'talk', 'mail'), e('Message', MessageSquare, 'talk', 'chat'), e('Phone', Phone, 'talk', 'call'), e('Video', Video, 'talk', 'meeting call'),
  e('Announce', Megaphone, 'talk', 'campaign marketing'), e('Send', Send, 'talk', 'outreach'), e('Mention', AtSign, 'talk', 'at'), e('Inbox', Inbox, 'talk', 'requests'),
  e('Calendar', Calendar, 'time', 'date'), e('Schedule', CalendarDays, 'time', 'booking'), e('Clock', Clock, 'time', 'hours'), e('Timer', Timer, 'time', 'duration'),
  e('Alarm', AlarmClock, 'time', 'reminder'), e('Waiting', Hourglass, 'time', 'pending'), e('Recurring', Repeat, 'time', 'repeat'), e('History', History, 'time', 'past'),
  e('Folder', Folder, 'things', 'project'), e('Document', FileText, 'things', 'file contract'), e('Book', Book, 'things', 'guide'), e('Bookmark', Bookmark, 'things', 'saved'),
  e('Tag', Tag, 'things', 'label'), e('Package', Package, 'things', 'product order'), e('Box', Box, 'things', 'inventory'), e('Gift', Gift, 'things', 'present'),
  e('Key', KeyIcon, 'things', 'access'), e('Lock', Lock, 'things', 'private'), e('Star', Star, 'things', 'favourite'), e('Heart', Heart, 'things', 'like'),
  e('Flag', Flag, 'things', 'milestone'), e('Idea', Lightbulb, 'things', 'lightbulb'), e('Lightning', Zap, 'things', 'fast'), e('Code', Code, 'things', 'developer'),
  e('Tools', Wrench, 'things', 'service repair'), e('Settings', Settings, 'things', 'gear'), e('Magic', Sparkles, 'things', 'ai'), e('Music', Music, 'things', 'audio'),
  e('Camera', Camera, 'things', 'photo'), e('Palette', Palette, 'things', 'design'),
  e('Globe', Globe, 'places', 'world web'), e('Pin', MapPin, 'places', 'location map'), e('Home', House, 'places', 'house'), e('Café', Coffee, 'places', 'coffee'),
  e('Restaurant', Utensils, 'places', 'food menu'), e('Salon', Scissors, 'places', 'hair beauty'), e('Clinic', Stethoscope, 'places', 'health doctor'),
  e('Gym', Dumbbell, 'places', 'fitness'), e('Car', Car, 'places', 'travel drive'), e('Travel', Plane, 'places', 'flight'), e('Garden', Leaf, 'places', 'nature'), e('Outdoors', Sun, 'places', 'weather'),
];

const CATEGORIES: ReadonlyArray<{ readonly id: IconCategory | 'all'; readonly label: string }> = [
  { id: 'all', label: 'All' }, { id: 'business', label: 'Business' }, { id: 'people', label: 'People' }, { id: 'talk', label: 'Talk' },
  { id: 'time', label: 'Time' }, { id: 'things', label: 'Things' }, { id: 'places', label: 'Places' },
];

/** Draws a saved icon name on its hue's tile: how an object or page shows it everywhere. */
export function IconTile({ name, hue = 'gray', size = 'md' }: { readonly name: string; readonly hue?: Hue; readonly size?: 'sm' | 'md' }) {
  const entry = ICONS.find((i) => i.name === name) ?? ICONS[0];
  if (!entry) return null;
  return (
    <span className={cx('tf-icontile', `tf-icontile--${size}`)} style={{ background: `var(--tag-${hue}-bg)`, color: `var(--tag-${hue}-text)` }} aria-hidden="true">
      <entry.Icon size={size === 'sm' ? 14 : 16} strokeWidth={1.75} />
    </span>
  );
}

/** Props for IconPicker. */
export interface IconPickerProps {
  readonly label: string;
  /** The saved icon's name from ICONS. */
  readonly value: string;
  readonly onChange?: (name: string) => void;
  /** Draws the icons on this hue, as the object will show them. */
  readonly hue?: Hue;
  readonly isDisabled?: boolean;
}

/** An object's or page's icon: the tile opens a grid of curated Lucide icons with a search and categories; arrows move through the grid, Enter chooses. */
export function IconPicker({ label, value, onChange, hue = 'gray', isDisabled }: IconPickerProps) {
  const [open, setOpen] = useState(false);
  const [category, setCategory] = useState<IconCategory | 'all'>('all');
  const { contains } = useFilter({ sensitivity: 'base' });
  const timer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(timer.current), []);
  const shown = category === 'all' ? ICONS : ICONS.filter((i) => i.category === category);
  const choose = (key: Key) => {
    onChange?.(String(key));
    timer.current = window.setTimeout(() => setOpen(false), 120);
  };
  return (
    <DialogTrigger isOpen={open} onOpenChange={(o) => { setOpen(o); if (!o) setCategory('all'); }}>
      <AriaButton className="tf-iconpick__trigger" aria-label={`${label}: ${value}`} isDisabled={isDisabled}>
        <IconTile name={value} hue={hue} />
        <ChevronDown className="tf-iconpick__chev" size={14} strokeWidth={1.75} aria-hidden="true" />
      </AriaButton>
      <Popover label={label} className="tf-iconpick__pop">
        <Autocomplete filter={contains}>
          <PopoverSearch placeholder="Search icons…" />
          <ToggleButtonGroup
            aria-label="Category" className="tf-iconpick__cats" selectionMode="single" disallowEmptySelection selectedKeys={[category]}
            onSelectionChange={(keys) => { const k = [...keys][0]; if (k !== undefined) setCategory(k as IconCategory | 'all'); }}
          >
            {CATEGORIES.map((c) => <ToggleButton key={c.id} id={c.id} className="tf-iconpick__cat">{c.label}</ToggleButton>)}
          </ToggleButtonGroup>
          <ListBox
            aria-label={label} layout="grid" className="tf-iconpick__grid" items={shown} selectionMode="single" disallowEmptySelection selectedKeys={[value]}
            onSelectionChange={(keys) => { const k = keys === 'all' ? undefined : [...keys][0]; if (k !== undefined) choose(k); }}
            renderEmptyState={() => <div className="tf-iconpick__empty">No icons match</div>}
          >
            {(item) => (
              <ListBoxItem id={item.name} textValue={`${item.name} ${item.keywords ?? ''}`} aria-label={item.name} className="tf-iconpick__cell" style={{ color: `var(--tag-${hue}-text)` }}>
                <item.Icon size={16} strokeWidth={1.75} aria-hidden="true" />
              </ListBoxItem>
            )}
          </ListBox>
        </Autocomplete>
      </Popover>
    </DialogTrigger>
  );
}
