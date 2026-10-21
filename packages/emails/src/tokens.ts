// The design tokens as an email can use them (spec 0002's tokens.json, read
// as data): an inbox can't load the app's CSS variables, so every colour,
// space, radius, size and type style an email draws is looked up here by its
// token name and written inline as a literal. A name tokens.json doesn't have
// throws, so a renamed token fails the tests instead of drawing a default.
import tokens from '@crm/tokens/tokens.json' with { type: 'json' };

/** The two themes every colour has a value for. */
export type Scheme = 'light' | 'dark';

const ALIAS = /^\{([A-Za-z0-9][A-Za-z0-9_.-]{0,63})\}$/;
const OPAQUE_HEX = /^#[0-9a-f]{6}$/i;

/**
 * A colour token's value in one theme, aliases followed. Only an opaque
 * six digit hex comes back: Outlook and older clients can't read an alpha
 * channel, so a translucent token can't be used in an email at all.
 */
export function colorToken(name: string, scheme: Scheme): string {
  const seen = new Set<string>();
  let current = name;
  for (;;) {
    const token = tokens.color.tokens.find((candidate) => candidate.name === current);
    if (token === undefined) throw new Error(`No colour token called ${current} in tokens.json.`);
    const value: unknown =
      typeof token.value === 'string' ? token.value : (token.value as Record<string, string>)[scheme];
    if (typeof value !== 'string') throw new Error(`Colour token ${current} has no ${scheme} value.`);
    const alias = ALIAS.exec(value)?.[1];
    if (alias === undefined) {
      if (!OPAQUE_HEX.test(value)) throw new Error(`Colour token ${current} (${scheme}) isn't an opaque hex colour.`);
      return value.toLowerCase();
    }
    if (seen.has(alias)) throw new Error(`Colour token ${name} (${scheme}) aliases itself.`);
    seen.add(current);
    current = alias;
  }
}

/** A plain family's token value as written (`16px`, `1px`), by family and name. Throws for a name it doesn't have. */
function plainToken(
  family: { readonly tokens: readonly { readonly name: string; readonly value: string | number }[] },
  label: string,
  name: string,
): string {
  const token = family.tokens.find((candidate) => candidate.name === name);
  if (token === undefined) throw new Error(`No ${label} token called ${name} in tokens.json.`);
  return String(token.value);
}

/** A spacing token, such as `space-16` (`16px`). */
export const spaceToken = (name: string): string => plainToken(tokens.spacing, 'spacing', name);

/** A radius token, such as `radius-xl` (`12px`). */
export const radiusToken = (name: string): string => plainToken(tokens.radius, 'radius', name);

/** A size token, such as `size-column-min` (`80px`). */
export const sizeToken = (name: string): string => plainToken(tokens.size, 'size', name);

/** A border width token, such as `border-width-hairline` (`1px`). */
export const borderWidthToken = (name: string): string => plainToken(tokens.borderWidth, 'border width', name);

/** A breakpoint token, such as `bp-container-md` (`480px`): the only lengths a media query may name. */
export const breakpointToken = (name: string): string => plainToken(tokens.breakpoint, 'breakpoint', name);

/** A pixel length's number, for an HTML `width` or `height` attribute (`16px` is 16). */
export function pixels(length: string): number {
  const match = /^(\d+(?:\.\d+)?)px$/.exec(length);
  if (match?.[1] === undefined) throw new Error(`${length} isn't a pixel length.`);
  return Number(match[1]);
}

/** A font family stack from the type tokens: `sans` or `mono`. */
export function fontStack(family: 'sans' | 'mono'): string {
  const stack = (tokens.type.families as Record<string, string | undefined>)[family];
  if (stack === undefined) throw new Error(`No font family called ${family} in tokens.json.`);
  return stack;
}

/** One type style as inline CSS: size, line height, weight, tracking and family. */
export interface TypeStyle {
  readonly fontFamily: string;
  readonly fontSize: string;
  readonly lineHeight: string;
  readonly fontWeight: number;
  readonly letterSpacing: string;
}

/** A type style token, such as `body` or `heading`, as inline CSS. */
export function typeToken(name: string): TypeStyle {
  for (const group of tokens.type.groups) {
    const style = group.styles.find((candidate) => candidate.name === name);
    if (style === undefined) continue;
    // A style names its own family, or leaves it empty to take its group's (as the CSS generator reads it).
    const own = 'family' in style ? style.family : undefined;
    const family = (own === undefined || own === '' ? group.family : own) as 'sans' | 'mono';
    return {
      fontFamily: fontStack(family),
      fontSize: style.fontSize,
      lineHeight: style.lineHeight,
      fontWeight: Number(style.fontWeight),
      letterSpacing: style.letterSpacing,
    };
  }
  throw new Error(`No type style called ${name} in tokens.json.`);
}
