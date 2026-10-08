// The public build time variables this app reads (Vite bakes them in; Turbo
// hashes every VITE_* into the build).
interface ImportMetaEnv {
  /** Centrifugo's WebSocket address (spec 0005). Unset or empty (previews): live updates are off. */
  readonly VITE_REALTIME_URL?: string;
}
