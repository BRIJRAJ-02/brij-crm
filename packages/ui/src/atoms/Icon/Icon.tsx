import type { Hue } from '../../hue.ts';
import styles from './Icon.module.css';
import { icons, type IconName } from './icons.ts';

/** Icon sizes, from the `size-icon` tokens: `md` 16 (nav, menus, rows), `sm` 14 (buttons, chips), `xs` 12 (card footers). */
export type IconSize = 'md' | 'sm' | 'xs';

/** Icon colour: `inherit` takes the parent's, `muted` is `text-secondary`, `ai` is the AI sparkle only. */
export type IconTone = 'inherit' | 'muted' | 'ai';

interface IconBase {
  /** The icon, exactly as lucide.dev names it. Only names in the registry type check. */
  readonly name: IconName;
  /** Give it only when the icon is the sole content of a control; otherwise it is hidden from screen readers. */
  readonly label?: string;
}

interface PlainIcon extends IconBase {
  readonly size?: IconSize;
  readonly tone?: IconTone;
  readonly tile?: undefined;
}

interface TiledIcon extends IconBase {
  /** Sets the icon on its hue tile, for objects in the sidebar and top bar. A tile always holds an `sm` icon in the hue's colour. */
  readonly tile: Hue;
  readonly size?: never;
  readonly tone?: never;
}

/** Props for the Icon atom: a plain icon, or one on a hue tile. */
export type IconProps = PlainIcon | TiledIcon;

function accessibleName(label: string | undefined) {
  return label !== undefined && label !== ''
    ? ({ role: 'img', 'aria-label': label } as const)
    : ({ 'aria-hidden': true } as const);
}

/**
 * The one way the app draws an icon. Lucide only, through the registry, sized
 * and stroked from tokens. Decorative unless `label` is given.
 */
export function Icon(props: IconProps) {
  const Glyph = icons[props.name];

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
      focusable="false"
      {...accessibleName(props.label)}
    />
  );
}
