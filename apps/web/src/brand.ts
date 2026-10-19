// The product's own look outside the design system: its wordmark files, served
// from public/brand/ (the mark and the favicon are linked from index.html).
import type { ProductLogo } from '@crm/ui';

/** Timefix's wordmark: dark ink on the light theme, white on the dark one. AuthLayout shows the one for the theme. */
export const PRODUCT_LOGO: ProductLogo = {
  light: '/brand/timefix-wordmark-light.png',
  dark: '/brand/timefix-wordmark-dark.png',
};
