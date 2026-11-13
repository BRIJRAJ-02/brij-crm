// Every story renders inside UiProvider (a fresh toast queue and a frozen
// clock per story) and a StoryRoot frame. The toolbar switches the theme and
// the language, so formats and the week start can be checked by eye.
import type { Decorator, Preview } from '@storybook/react-vite';
import { useLayoutEffect, useState, type ReactNode } from 'react';
import '../src/styles/app.css';
import type { KeyboardPlatform } from '../src/atoms/Kbd/shortcuts.ts';
import { createFixedClock } from '../src/provider/clock.ts';
import { createToasts } from '../src/provider/toasts.tsx';
import { UiProvider } from '../src/provider/UiProvider.tsx';
import { StoryRoot } from '../src/workbench/StoryRoot/StoryRoot.tsx';

/** The moment every story sees: 8 October 2026, 14:30 UTC. */
const STORY_NOW = Date.UTC(2026, 9, 8, 14, 30);

/** Skeletons show at once in stories, so loading states render without waiting. */
const NO_DELAY = { delayMs: 0, minimumMs: 0 } as const;

type ThemeGlobal = 'light' | 'dark' | 'system';

/**
 * Stories of parts that only public pages draw (spec 0071): shot at full size, as a guest sees them. Everything else
 * draws at the app's density, as the app does. A story may set `parameters.scale` to override.
 */
const PUBLIC_TITLES = [
  'Public form/',
  'Modules/BookingChanges',
  'Modules/BookingChat',
  'Modules/BookingDetails',
  'Modules/BookingFrame',
  'Modules/BookingReceipt',
  'Modules/BusinessPage',
  'Modules/DayStrip',
  'Modules/GuestLook',
  'Modules/ItemSheet',
  'Modules/LinkPage',
  'Modules/MatchCalendar',
  'Modules/MenuList',
  'Modules/MonthTiles',
  'Modules/PartyBand',
  'Modules/SlotList',
  'Modules/VisitorBar',
  'Molecules/SocialLinks',
  'Molecules/Stepper',
];

type ScaleGlobal = 'app' | 'full';

function scaleOf(title: string, parameter: unknown): ScaleGlobal {
  if (parameter === 'app' || parameter === 'full') return parameter;
  const isPublic = PUBLIC_TITLES.some((prefix) =>
    prefix.endsWith('/') ? title.startsWith(prefix) : title === prefix || title.startsWith(`${prefix}/`),
  );
  return isPublic ? 'full' : 'app';
}

interface StoryProvidersProps {
  readonly locale: string;
  readonly theme: ThemeGlobal;
  readonly scale: ScaleGlobal;
  readonly platform: KeyboardPlatform;
  readonly children: ReactNode;
}

function StoryProviders({ locale, theme, scale, platform, children }: StoryProvidersProps) {
  const [toasts] = useState(createToasts);
  const [clock] = useState(() => createFixedClock(STORY_NOW));

  // The page is shared across stories (and files), so the scale goes back to what it was when the story ends.
  useLayoutEffect(() => {
    const root = document.documentElement;
    const before = root.dataset.scale;
    if (scale === 'app') root.dataset.scale = 'app';
    else delete root.dataset.scale;
    return () => {
      if (before === undefined) delete root.dataset.scale;
      else root.dataset.scale = before;
    };
  }, [scale]);

  // System sets nothing, so the OS decides through CSS, as in the app.
  useLayoutEffect(() => {
    if (theme === 'system') delete document.documentElement.dataset.theme;
    else document.documentElement.dataset.theme = theme;
  }, [theme]);

  return (
    <UiProvider
      locale={locale}
      timeZone="Europe/London"
      navigate={() => undefined}
      toasts={toasts}
      clock={clock}
      loadingTiming={NO_DELAY}
      platform={platform}
    >
      <StoryRoot>{children}</StoryRoot>
    </UiProvider>
  );
}

function themeOf(value: unknown): ThemeGlobal {
  return value === 'dark' || value === 'system' ? value : 'light';
}

const withProviders: Decorator = (Story, context) => {
  const { locale, theme, platform } = context.globals as { locale?: unknown; theme?: unknown; platform?: unknown };
  return (
    <StoryProviders
      locale={typeof locale === 'string' ? locale : 'en-US'}
      theme={themeOf(theme)}
      scale={scaleOf(context.title, context.parameters.scale)}
      platform={platform === 'other' ? 'other' : 'mac'}
    >
      <Story />
    </StoryProviders>
  );
};

const preview: Preview = {
  decorators: [withProviders],
  tags: ['autodocs'],
  globalTypes: {
    theme: {
      description: 'Colour theme',
      toolbar: {
        title: 'Theme',
        icon: 'mirror',
        items: [
          { value: 'light', title: 'Light' },
          { value: 'dark', title: 'Dark' },
          { value: 'system', title: 'System' },
        ],
        dynamicTitle: true,
      },
    },
    locale: {
      description: 'Language, for dates, numbers and the week start',
      toolbar: {
        title: 'Language',
        icon: 'globe',
        items: [
          { value: 'en-US', title: 'English (US)' },
          { value: 'en-GB', title: 'English (UK)' },
          { value: 'de-DE', title: 'Deutsch' },
        ],
        dynamicTitle: true,
      },
    },
    platform: {
      description: 'Keyboard, for the shortcuts keycaps show',
      toolbar: {
        title: 'Keyboard',
        icon: 'command',
        items: [
          { value: 'mac', title: 'Mac (⌘)' },
          { value: 'other', title: 'Windows and Linux (Ctrl)' },
        ],
        dynamicTitle: true,
      },
    },
  },
  initialGlobals: { theme: 'light', locale: 'en-US', platform: 'mac' },
  // Storybook runs project afterEach hooks last registered first, so this runs before the a11y addon's axe pass.
  // An overlay still fading in or out reads at part opacity, which axe takes for low contrast (Firefox ran it
  // mid fade often enough to fail CI), so finish every finite animation and let React settle first.
  afterEach: async () => {
    for (const animation of document.getAnimations()) {
      if (animation.effect?.getComputedTiming().iterations !== Infinity) animation.finish();
    }
    await new Promise((resolve) => requestAnimationFrame(resolve));
  },
  parameters: {
    layout: 'fullscreen',
    // Any axe violation fails the story's test (AC-6).
    a11y: { test: 'error' },
    controls: { expanded: true },
  },
};

export default preview;
