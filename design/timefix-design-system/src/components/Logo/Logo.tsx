import markSvg from './mark.svg';
import wordLight from './timefix-wordmark-light.png';
import wordDark from './timefix-wordmark-dark.png';
import './Logo.css';
import { cx } from '../../lib/cx.ts';

/** Timefix's mark: the brand file's paths, with the ink circle and tick bound to text and surface so it flips per theme. */
export function LogoMark({ size = 24, className }: { readonly size?: number; readonly className?: string }) {
  const paths = markSvg.replace(/<\/?svg[^>]*>/g, '').replace('fill="#151515"', 'class="tf-logo__ink"').replace('fill="white"', 'class="tf-logo__tick"');
  return <svg className={cx('tf-logo__mark', className)} width={size} height={size} viewBox="0 0 32 32" role="img" aria-label="Timefix" dangerouslySetInnerHTML={{ __html: paths }} />;
}

/** The mark plus the brand's own wordmark files (dark ink in light theme, white in dark). */
export function Logo({ size = 24 }: { readonly size?: number }) {
  return (
    <span className="tf-logo" style={{ '--tf-logo-size': `${size}px` } as React.CSSProperties} role="img" aria-label="Timefix">
      <LogoMark size={size} />
      <img className="tf-logo__word tf-logo__word--light" src={wordLight} alt="" />
      <img className="tf-logo__word tf-logo__word--dark" src={wordDark} alt="" />
    </span>
  );
}
