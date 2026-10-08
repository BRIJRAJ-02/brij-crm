// The public build time variables this app reads (Vite bakes them in; Turbo
// hashes every VITE_* into the build).
interface ImportMetaEnv {
  /** Centrifugo's WebSocket address (spec 0005). Unset or empty (previews): live updates are off. */
  readonly VITE_REALTIME_URL?: string;
  /** The brij-crm-web Sentry project's DSN (Vercel Production and Preview); unset means monitoring is off. */
  readonly VITE_SENTRY_DSN_WEB?: string;
  /** The commit the build came from (`GITHUB_SHA`, set by `vite.config.ts`), else `local`. */
  readonly APP_RELEASE: string;
  /** `production` or `preview` (`VERCEL_ENV` at build, set by `vite.config.ts`), else `local`. */
  readonly APP_ENVIRONMENT: string;
}
