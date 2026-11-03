// `@crm/ui/photo`: the one way a picture is made ready to send (spec 0068, AC-6809). `PhotoCrop` (from `@crm/ui`)
// answers the part of the photo a person kept; `preparePhoto` draws that part again in the browser, sized and typed
// for its kind, so the server only ever receives finished files. No React here, so a screen's helper or a test can
// load it alone.
export {
  PHOTO_KINDS,
  planPhoto,
  preparePhoto,
  type PhotoKind,
  type PhotoKindRule,
  type PhotoPlan,
  type PreparedPhoto,
} from './lib/photo/prepare.ts';
export type { PhotoRect, PhotoSize } from './lib/photo/crop-math.ts';
