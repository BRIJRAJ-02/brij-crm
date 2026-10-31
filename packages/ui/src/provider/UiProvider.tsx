import { IconScope } from '../atoms/Icon/Icon.tsx';
import { icons } from '../atoms/Icon/icons.ts';
import { providerArt } from '../atoms/ProviderMark/art.ts';
import { ProviderArtContext } from '../atoms/ProviderMark/art-context.ts';
<<<<<<< HEAD
<<<<<<< HEAD
import { ToastRegion } from './ToastRegion.tsx';
=======
>>>>>>> 26186211b (perf(ui): the hosted form mounts UiProviderBase, without the icon registry or brand art)
=======
import { ToastRegion } from './ToastRegion.tsx';
>>>>>>> 65ed904c5 (perf(ui): draw toasts from ToastRegion.tsx, so the hosted form loads no toast region)
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
<<<<<<< HEAD
<<<<<<< HEAD
        <UiProviderBase {...props} toastRegion={<ToastRegion toasts={props.toasts} />} />
=======
        <UiProviderBase {...props} />
>>>>>>> 26186211b (perf(ui): the hosted form mounts UiProviderBase, without the icon registry or brand art)
=======
        <UiProviderBase {...props} toastRegion={<ToastRegion toasts={props.toasts} />} />
>>>>>>> 65ed904c5 (perf(ui): draw toasts from ToastRegion.tsx, so the hosted form loads no toast region)
      </ProviderArtContext>
    </IconScope>
  );
}
