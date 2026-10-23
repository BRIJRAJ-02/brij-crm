/** The build's year and moment (vite.config.ts `define`). */
declare const __BUILD_YEAR__: number;
declare const __BUILD_TIME__: number;

interface ImportMetaEnv {
  /** Where the visit beacon posts (spec 0047); the built site's default is the app's own api. */
  readonly VITE_SITE_HIT_URL?: string;
}
