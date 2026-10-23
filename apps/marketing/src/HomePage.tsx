import { FirstFold } from './components/FirstFold/FirstFold.tsx';
import { SiteFooter } from './components/SiteFooter/SiteFooter.tsx';
import { SiteFrame } from './components/SiteFrame/SiteFrame.tsx';

/** timefix.ai: the first screen (the promise and the product to try), then the footer. */
export function HomePage({ year }: { readonly year: number }) {
  return (
    <SiteFrame>
      <FirstFold />
      <SiteFooter year={year} />
    </SiteFrame>
  );
}
