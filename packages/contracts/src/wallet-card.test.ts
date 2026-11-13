// The card one colour makes (13 November 2026): the rule the pass's picture and the console's preview share.
import { describe, expect, it } from 'vitest';
import { walletCardColours, walletRampAt } from './wallet-card.ts';

describe('walletCardColours', () => {
  it('deepens a dark colour towards black at the top, under white text', () => {
    const navy = walletCardColours('#13265b');
    expect(navy.isTextWhite).toBe(true);
    expect(navy.text).toEqual([255, 255, 255]);
    expect(navy.bottom).toEqual([19, 38, 91]);
    // Most of the way to black: every channel far under the colour's own, and still the colour's blue.
    expect(navy.top.every((value, at) => value < (navy.bottom[at] ?? 0) / 3)).toBe(true);
    expect(navy.top[2]).toBeGreaterThan(navy.top[0]);
  });

  it('only lifts a pale colour, under the app’s ink, so dark text has one ground all the way down', () => {
    const cream = walletCardColours('#f5e9c8');
    expect(cream.isTextWhite).toBe(false);
    expect(cream.text).toEqual([17, 17, 19]);
    expect(cream.top.every((value, at) => value >= (cream.bottom[at] ?? 0))).toBe(true);
  });

  it('draws its labels between the text and the card, nearer the text', () => {
    const { text, bottom, label } = walletCardColours('#13265b');
    label.forEach((value, at) => {
      expect(value).toBeLessThan(text[at] ?? 0);
      expect(value).toBeGreaterThan(((text[at] ?? 0) + (bottom[at] ?? 0)) / 2);
    });
  });
});

describe('walletRampAt', () => {
  it('starts at the top colour, ends at the colour itself, and never leaves the card', () => {
    const colours = walletCardColours('#13265b');
    expect(walletRampAt(colours, 0)).toEqual(colours.top);
    expect(walletRampAt(colours, 1)).toEqual(colours.bottom);
    expect(walletRampAt(colours, -3)).toEqual(colours.top);
    expect(walletRampAt(colours, 9)).toEqual(colours.bottom);
  });

  it('eases in: halfway down the card is still nearer the top than the foot', () => {
    const colours = walletCardColours('#13265b');
    const middle = walletRampAt(colours, 0.5);
    expect(middle[2] - colours.top[2]).toBeLessThan(colours.bottom[2] - middle[2]);
  });
});
