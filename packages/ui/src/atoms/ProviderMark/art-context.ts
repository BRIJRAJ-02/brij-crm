import { createContext } from 'react';
import type { ProviderName } from './ProviderMark.tsx';

/** One brand's artwork: one image, or a light and a dark one for a black mark. */
export type ProviderArt = Readonly<Record<ProviderName, string | { readonly light: string; readonly dark: string }>>;

/**
 * The artwork ProviderMark draws, given by UiProvider (`art.ts`). Without it, as under the hosted form's
 * UiProviderBase, ProviderMark draws nothing.
 */
export const ProviderArtContext = createContext<ProviderArt | undefined>(undefined);
