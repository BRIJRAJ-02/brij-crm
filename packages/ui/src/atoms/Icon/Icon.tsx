import { createContext, useContext, useMemo, type ReactNode } from 'react';
import type { Hue } from '../../hue.ts';
import { baseIcons } from './base-icons.ts';
import styles from './Icon.module.css';
import type { icons, IconName } from './icons.ts';

/** One glyph, as the registry holds it. */
type IconGlyph = (typeof icons)[keyof typeof icons];

/** The glyphs the scopes around an Icon add to the base set: UiProvider's registry, and the editor's set inside it. */
const EMPTY: Readonly<Partial<Record<IconName, IconGlyph>>> = {};
const ScopedIcons = createContext(EMPTY);

/** Props for IconScope. */
export interface IconScopeProps {
  /** A scoped set, such as `editorIcons`: icons that load with the part of the library that draws them. */
  readonly icons: Readonly<Partial<Record<IconName, IconGlyph>>>;
  readonly children: ReactNode;
}

/**
 * Lets the Icons inside draw a scoped set's icons as well as the registry's. A lazy part of the library (the
 * note editor) wraps itself in one, so its icons ship in its own chunk instead of the registry every page loads.
 */
export function IconScope({ icons: scoped, children }: IconScopeProps) {
  // Adds to the scope around it rather than replacing it: the editor's set inside UiProvider's registry.
  const outer = useContext(ScopedIcons);
  const value = useMemo(() => (outer === EMPTY ? scoped : { ...outer, ...scoped }), [outer, scoped]);
  return <ScopedIcons.Provider value={value}>{children}</ScopedIcons.Provider>;
}

/** Icon sizes, from the `size-icon` tokens: `md` 16 (nav, menus, rows), `sm` 14 (buttons, chips), `xs` 12 (card footers). */
export type IconSize = 'md' | 'sm' | 'xs';

/** Icon colour: `inherit` takes the parent's, `muted` is `text-secondary`, `ai` is the AI sparkle only. */
export type IconTone = 'inherit' | 'muted' | 'ai' | 'success' | 'danger';

interface IconBase {
  /** The icon, exactly as lucide.dev names it. Only names in the registry type check. */
  readonly name: IconName;
  /** Give it only when the icon is the sole content of a control; otherwise it is hidden from screen readers. */
  readonly label?: string;
}

interface PlainIcon extends IconBase {
  readonly size?: IconSize;
  readonly tone?: IconTone;
  /** Fills the glyph's shape with its colour: a chosen star in a rating. */
  readonly isFilled?: boolean;
  readonly tile?: undefined;
}

interface TiledIcon extends IconBase {
  /** Sets the icon on its hue tile, for objects in the sidebar and top bar, and attribute names in a record's details (gray). A tile always holds an `sm` icon in the hue's colour. */
  readonly tile: Hue;
  readonly size?: never;
  readonly tone?: never;
  readonly isFilled?: never;
}

/** Props for the Icon atom: a plain icon, or one on a hue tile. */
export type IconProps = PlainIcon | TiledIcon;

function accessibleName(label: string | undefined) {
  return label !== undefined && label !== ''
    ? ({ role: 'img', 'aria-label': label } as const)
    : ({ 'aria-hidden': true } as const);
}

/**
 * The one way the app draws an icon. Lucide only, through the registry (or a
 * scoped set inside its IconScope), sized and stroked from tokens. Decorative
 * unless `label` is given.
 */
export function Icon(props: IconProps) {
  const scoped = useContext(ScopedIcons);
  const Glyph = scoped[props.name] ?? (baseIcons as Readonly<Partial<Record<IconName, IconGlyph>>>)[props.name];
  // In no scope and not in the base set: a registry icon outside UiProvider (under the hosted form's
  // UiProviderBase), or an editor icon outside its IconScope. Nothing to draw (icons.test.ts checks both).
  if (Glyph === undefined) return null;

  if (props.tile !== undefined) {
    return (
      <span className={styles.tile} data-hue={props.tile} {...accessibleName(props.label)}>
        <Glyph className={styles.icon} data-size="sm" aria-hidden focusable="false" />
      </span>
    );
  }

  return (
    <Glyph
      className={styles.icon}
      data-size={props.size ?? 'md'}
      data-tone={props.tone ?? 'inherit'}
      data-filled={props.isFilled === true || undefined}
      focusable="false"
      {...accessibleName(props.label)}
    />
  );
}
