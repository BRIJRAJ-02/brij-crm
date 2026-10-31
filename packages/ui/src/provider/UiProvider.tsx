import { IconScope } from '../atoms/Icon/Icon.tsx';
import { icons } from '../atoms/Icon/icons.ts';
import { providerArt } from '../atoms/ProviderMark/art.ts';
import { ProviderArtContext } from '../atoms/ProviderMark/art-context.ts';
import { ToastRegion } from './ToastRegion.tsx';
import { UiProviderBase, type UiProviderProps } from './UiProviderBase.tsx';

export { useFormatSettings, useKeyboardPlatform, useNow, useToasts, type FormatSettings } from './context.ts';
export { detectKeyboardPlatform, type UiProviderProps } from './UiProviderBase.tsx';

/**
 * Wraps the app once: React Aria's language and router, the shared clock and
 * the toast region, with the parts of the library the hosted form never draws in
 * reach: the whole icon registry for Icon, and the brand marks' artwork for
 * ProviderMark. Components read the language, time zone and time only from
 * here, never from the browser.
 */
export function UiProvider(props: UiProviderProps) {
  return (
    <IconScope icons={icons}>
      <ProviderArtContext value={providerArt}>
        <UiProviderBase {...props} toastRegion={<ToastRegion toasts={props.toasts} />} />
      </ProviderArtContext>
    </IconScope>
  );
}
