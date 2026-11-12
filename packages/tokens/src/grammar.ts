// The design system artifact's token grammar (its tokens.json), as Zod schemas.
// Every family is a list of { name, value, usage }, never a name to value map.
// Values are checked as strings here; generate.ts applies the rules that need
// the whole file (themes, aliases, one namespace, fonts on disk).
import { z } from 'zod';

const TokenName = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$/, 'a token name');

/** A value per theme id (`{ light, dark }`), or one string meaning the first theme only. */
const ThemedValue = z.union([z.string(), z.record(z.string(), z.string())]);

const ThemedToken = z.object({
  name: TokenName,
  value: ThemedValue,
  usage: z.string().optional(),
});

/** A plain family's value: written as a string in the artifact, numbers allowed. */
const PlainValue = z.union([z.string(), z.number()]).transform(String);

/** One token of a plain family (spacing, radius, size, duration, zIndex, …). */
export const PlainToken = z.object({
  name: TokenName,
  value: PlainValue,
  usage: z.string().optional(),
});
export type PlainToken = z.infer<typeof PlainToken>;

/** Any top level `{ tokens: [...] }` family other than colour, shadow and type. */
export const PlainFamily = z.object({
  note: z.string().optional(),
  tokens: z.array(PlainToken),
});
export type PlainFamily = z.infer<typeof PlainFamily>;

/** The colour family: its themes, then one flat list of tokens. */
export const ColorFamily = z.object({
  themes: z.array(z.object({ id: z.string(), name: z.string() })).min(1),
  tokens: z.array(ThemedToken),
});
export type ColorFamily = z.infer<typeof ColorFamily>;

/** Shadows, with a value per theme like colours. */
export const ShadowFamily = z.object({
  note: z.string().optional(),
  tokens: z.array(ThemedToken),
});
export type ShadowFamily = z.infer<typeof ShadowFamily>;

/** One named type style, such as `body` or `heading`. */
export const TypeStyle = z.object({
  name: TokenName,
  fontSize: z.string(),
  lineHeight: z.string(),
  // The prototype's source writes weights as numbers (500); older files wrote strings ("500").
  fontWeight: z.union([z.string(), z.number()]).transform(String),
  letterSpacing: z.string().optional(),
  fontStyle: z.enum(['normal', 'italic']).optional(),
  opticalSize: z.number().nullable().optional(),
  family: z.string().optional(),
  sample: z.string().optional(),
  usage: z.string().optional(),
});
export type TypeStyle = z.infer<typeof TypeStyle>;

/** Type: the font files, the family stacks and the grouped styles. */
export const TypeFamily = z.object({
  fonts: z.array(
    z.object({
      family: z.string(),
      file: z.string(),
      weight: z.string(),
      style: z.enum(['normal', 'italic', 'oblique']).optional(),
    }),
  ),
  families: z.record(z.string(), z.string()),
  groups: z.array(
    z.object({
      name: z.string(),
      family: z.string(),
      note: z.string().optional(),
      styles: z.array(TypeStyle),
    }),
  ),
});
export type TypeFamily = z.infer<typeof TypeFamily>;

/** The top level of tokens.json. Other keys are read family by family in generate.ts. */
export const TokensFile = z
  .object({
    color: ColorFamily,
    type: TypeFamily,
    shadow: ShadowFamily.optional(),
  })
  .loose();
export type TokensFile = z.infer<typeof TokensFile>;

/**
 * packages/tokens/source.json: where tokens.json is copied from (`source`, a path relative to this package), the
 * artifact that is published from that file, and its published version (`unpublished` until someone publishes).
 */
export const TokenSource = z.object({
  source: z.string().min(1),
  artifact: z.url(),
  version: z.string().min(1),
  synced: z.iso.date(),
});
export type TokenSource = z.infer<typeof TokenSource>;

/** Why a legacy token exists at all: the port phase that removes it (spec 0071, AC-13). */
const Retire = z.string().min(1);

/** A legacy colour or shadow: a value per theme, like the source's, plus when it goes. */
export const LegacyThemedToken = ThemedToken.extend({ retire: Retire });
export type LegacyThemedToken = z.infer<typeof LegacyThemedToken>;

/** A legacy token of a plain family: the source's shape plus when it goes. */
export const LegacyPlainToken = PlainToken.extend({ retire: Retire });
export type LegacyPlainToken = z.infer<typeof LegacyPlainToken>;

/**
 * packages/tokens/legacy.json: tokens the code still needs that the source doesn't have, at their shipped values.
 * Every family is optional and every token names the phase that retires it. Never scaled (spec 0071, AC-13).
 */
export const LegacyFile = z
  .object({
    note: z.string().optional(),
    color: z.object({ tokens: z.array(LegacyThemedToken) }).optional(),
    shadow: z.object({ tokens: z.array(LegacyThemedToken) }).optional(),
  })
  .catchall(z.object({ tokens: z.array(LegacyPlainToken) }));
export type LegacyFile = z.infer<typeof LegacyFile>;
