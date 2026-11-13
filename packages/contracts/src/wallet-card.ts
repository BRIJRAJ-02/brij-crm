// A Wallet card drawn from one colour (13 November 2026): a partner's own Apple Wallet card takes any colour at all,
// and this says what that colour becomes, once, for the server that draws the pass and the console that previews
// it. Plain TypeScript with no Zod and no imports, as the contrast guard is, so the browser runs the same lines.

/**
 * The colour of Timefix's own card: the orange hue's dot (`packages/tokens/tokens.css`), which every pass without a
 * brand of its own is drawn from. The console shows it as the default. Core's pass test holds it to the hue.
 */
export const TIMEFIX_WALLET_COLOUR = '#fb8f3c';

/** A colour as its three channels, 0 to 255. */
export type WalletChannels = readonly [number, number, number];

/** The colours of a card drawn from one colour. */
export interface WalletCardColours {
  /** The top edge of the card's ground. */
  readonly top: WalletChannels;
  /** The foot of the ground: the colour itself, and what a phone shows where it can't draw the ground. */
  readonly bottom: WalletChannels;
  readonly text: WalletChannels;
  /** A field's label: the text's colour, a little way back towards the card. */
  readonly label: WalletChannels;
  /** Whether the text is the white one, which decides which Timefix wordmark a card with no logo carries. */
  readonly isTextWhite: boolean;
}

const WHITE: WalletChannels = [255, 255, 255];
const BLACK: WalletChannels = [0, 0, 0];
/** The app's ink, for a card too pale to carry white. */
const INK: WalletChannels = [17, 17, 19];

/** How far down the card the colour has arrived, 0 at the top to 1 at the foot: it eases in. */
export const WALLET_RAMP_EASE = 1.25;

function channelsOf(hex: string): WalletChannels {
  const digits = hex.replace('#', '');
  const at = (from: number) => Number.parseInt(digits.slice(from, from + 2), 16) || 0;
  return [at(0), at(2), at(4)];
}

function luminanceOf([red, green, blue]: WalletChannels): number {
  const part = (value: number) => {
    const share = value / 255;
    return share <= 0.04045 ? share / 12.92 : ((share + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * part(red) + 0.7152 * part(green) + 0.0722 * part(blue);
}

function mix(from: WalletChannels, to: WalletChannels, share: number): WalletChannels {
  return [
    from[0] + (to[0] - from[0]) * share,
    from[1] + (to[1] - from[1]) * share,
    from[2] + (to[2] - from[2]) * share,
  ];
}

/**
 * The card one colour makes. A colour white text reads on (3:1, the bar for large text) deepens most of the way to
 * black at the top, the way a lit card falls off, under white text; a pale one only lifts a little, under the
 * app's ink, so dark text has the same ground all the way down. `hex` is `#` and six hex digits.
 */
export function walletCardColours(hex: string): WalletCardColours {
  const bottom = channelsOf(hex);
  const isTextWhite = 1.05 / (luminanceOf(bottom) + 0.05) >= 3;
  const text = isTextWhite ? WHITE : INK;
  return {
    top: isTextWhite ? mix(bottom, BLACK, 0.78) : mix(bottom, WHITE, 0.18),
    bottom,
    text,
    label: mix(text, bottom, isTextWhite ? 0.28 : 0.36),
    isTextWhite,
  };
}

/** The ground's colour `along` the way down the card (0 to 1), as the pass's picture and the preview both draw it. */
export function walletRampAt(colours: Pick<WalletCardColours, 'top' | 'bottom'>, along: number): WalletChannels {
  return mix(colours.top, colours.bottom, Math.max(0, Math.min(1, along)) ** WALLET_RAMP_EASE);
}
