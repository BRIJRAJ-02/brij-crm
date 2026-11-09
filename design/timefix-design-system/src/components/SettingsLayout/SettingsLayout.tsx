import { Link as AriaLink, Input, TextField, Label, Text } from 'react-aria-components';
import type { ReactNode } from 'react';
import { cx } from '../../lib/cx.ts';
import './SettingsLayout.css';

/** Props for SettingsLayout. */
export interface SettingsLayoutProps {
  /** A `SettingsNav`. */
  readonly nav: ReactNode;
  /** The page: a heading, then `SettingsSection`s. */
  readonly children: ReactNode;
  /** The page title and its grey one-liner. */
  readonly title: string;
  readonly description?: string;
}

/** Settings: a grey icon list on the left, and section cards in a readable column on the right. */
export function SettingsLayout({ nav, children, title, description }: SettingsLayoutProps) {
  return (
    <div className="tf-settings">
      {nav}
      <div className="tf-settings__content">
        <div className="tf-settings__column">
          <header className="tf-settings__head">
            <h1 className="tf-settings__title">{title}</h1>
            {description !== undefined && <p className="tf-settings__lead">{description}</p>}
          </header>
          {children}
        </div>
      </div>
    </div>
  );
}

/** A group in the settings nav: a grey title and its pages. */
export interface SettingsNavGroup {
  readonly title: string;
  readonly items: ReadonlyArray<{ readonly id: string; readonly label: string; readonly icon?: ReactNode; readonly href?: string }>;
}

/** The settings navigation: grouped grey icon rows, the current page on a soft grey pill. */
export function SettingsNav({ groups, current, onNavigate, label = 'Settings' }: { readonly groups: ReadonlyArray<SettingsNavGroup>; readonly current: string; readonly onNavigate?: (id: string) => void; readonly label?: string }) {
  return (
    <nav className="tf-settings__nav" aria-label={label}>
      {groups.map((g) => (
        <div key={g.title} className="tf-settings__group">
          <p className="tf-settings__group-title">{g.title}</p>
          {g.items.map((it) => (
            <AriaLink key={it.id} href={it.href} onPress={() => onNavigate?.(it.id)} aria-current={it.id === current ? 'page' : undefined} className="tf-settings__link">
              {it.icon}<span>{it.label}</span>
            </AriaLink>
          ))}
        </div>
      ))}
    </nav>
  );
}

/** Props for SettingsSection. */
export interface SettingsSectionProps {
  readonly title: string;
  readonly description?: string;
  /** A status Tag in the header ("Active", "Pro plan"). */
  readonly status?: ReactNode;
  /** `SettingsRow`s, or a field. */
  readonly children: ReactNode;
  /** The grey note at the left of the footer ("Use 32 characters at most."). */
  readonly footnote?: ReactNode;
  /** The footer's action, usually an ink Save that is enabled once something changed. */
  readonly action?: ReactNode;
  /** `danger` tints the edge and footer red: things here cannot be undone. */
  readonly tone?: 'default' | 'danger';
}

/** A settings card: title and one-liner, rows or a field, and a footer with a note and Save (Vercel style). */
export function SettingsSection({ title, description, status, children, footnote, action, tone = 'default' }: SettingsSectionProps) {
  const id = `tf-set-${title.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`;
  return (
    <section className={cx('tf-settings__section', tone === 'danger' && 'tf-settings__section--danger')} aria-labelledby={id}>
      <div className="tf-settings__section-head">
        <div className="tf-settings__section-titles">
          <h2 id={id} className="tf-settings__section-title">{title}</h2>
          {description !== undefined && <p className="tf-settings__section-desc">{description}</p>}
        </div>
        {status}
      </div>
      <div className="tf-settings__section-body">{children}</div>
      {(footnote !== undefined || action !== undefined) && (
        <div className="tf-settings__section-foot">
          <span className="tf-settings__footnote">{footnote}</span>
          {action}
        </div>
      )}
    </section>
  );
}

/** One setting: title over a grey one-liner on the left, its control on the right. Switches save at once; no Save follows them. */
export function SettingsRow({ title, description, control, icon }: { readonly title: string; readonly description?: string; readonly control: ReactNode; readonly icon?: ReactNode }) {
  return (
    <div className="tf-settings__row">
      {icon !== undefined && <span className="tf-settings__row-icon">{icon}</span>}
      <div className="tf-settings__row-text">
        <span className="tf-settings__row-title">{title}</span>
        {description !== undefined && <span className="tf-settings__row-desc">{description}</span>}
      </div>
      <div className="tf-settings__row-control">{control}</div>
    </div>
  );
}

/**
 * A plain text field for a settings card (filled grey, accent edge on focus). Stand-in until the shared TextField lands.
 */
export function SettingsField({ label, value, onChange, description, prefix, maxLength }: { readonly label: string; readonly value: string; readonly onChange: (v: string) => void; readonly description?: string; readonly prefix?: string; readonly maxLength?: number }) {
  return (
    <TextField value={value} onChange={onChange} maxLength={maxLength} className="tf-settings__field">
      <Label className="tf-settings__field-label">{label}</Label>
      <div className="tf-settings__field-box">
        {prefix !== undefined && <span className="tf-settings__field-prefix">{prefix}</span>}
        <Input className="tf-settings__field-input" />
      </div>
      {description !== undefined && <Text slot="description" className="tf-settings__row-desc">{description}</Text>}
    </TextField>
  );
}
