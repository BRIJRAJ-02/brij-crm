// Every story renders inside UiProvider (a fresh toast queue and a frozen
// clock per story) and a StoryRoot frame. The toolbar switches the theme and
// the language, so formats and the week start can be checked by eye.
import type { Decorator, Preview } from '@storybook/react-vite';
import { useLayoutEffect, useState, type ReactNode } from 'react';
import '../src/styles/index.css';
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

interface StoryProvidersProps {
  readonly locale: string;
  readonly theme: ThemeGlobal;
  readonly platform: KeyboardPlatform;
  readonly children: ReactNode;
}

function StoryProviders({ locale, theme, platform, children }: StoryProvidersProps) {
  const [toasts] = useState(createToasts);
  const [clock] = useState(() => createFixedClock(STORY_NOW));

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
  parameters: {
    layout: 'fullscreen',
    // Any axe violation fails the story's test (AC-6).
    a11y: { test: 'error' },
    controls: { expanded: true },
  },
};

export default preview;
