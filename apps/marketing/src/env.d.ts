/** The build's year and moment (vite.config.ts `define`). */
declare const __BUILD_YEAR__: number;
declare const __BUILD_TIME__: number;

interface ImportMetaEnv {
  /** Where the visit beacon posts (spec 0047); the built site's default is the app's own api. */
  readonly VITE_SITE_HIT_URL?: string;
  /** Google Analytics 4's measurement id (`G-…`), the old site's NEXT_PUBLIC_GA_MEASUREMENT_ID; unset keeps it off. */
  readonly VITE_GA_MEASUREMENT_ID?: string;
  /** Microsoft Clarity's project id, the old site's NEXT_PUBLIC_CLARITY_PROJECT_ID; unset keeps it off. */
  readonly VITE_CLARITY_PROJECT_ID?: string;
  /** The old site's names for the same two ids, which the Vercel project still holds (vite.config.ts `envPrefix`). */
  readonly NEXT_PUBLIC_GA_MEASUREMENT_ID?: string;
  readonly NEXT_PUBLIC_CLARITY_PROJECT_ID?: string;
  /** `1` loads Vercel's Web Analytics and Speed Insights, once the Vercel project has them switched on. */
  readonly VITE_VERCEL_ANALYTICS?: string;
}
