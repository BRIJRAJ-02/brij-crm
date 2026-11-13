// Saving a drawn QR code as a PNG or an SVG (spec 0051, AC-5122; spec 0061, AC-6124). The code moved into the
// library beside QrCode (spec 0073, batch 2), so ShareSheet and these screens save a code one way; this file keeps
// the screens' imports until each is ported onto ShareSheet or `downloadQr`.
export { qrPng, qrSvg, saveFile } from '@crm/ui';
