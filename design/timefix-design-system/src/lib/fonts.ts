// The guest looks' font list, shared by the menu, reservation and business pages and the link page.
import '../styles/packs.css';

/** The guest looks' closed font list (the real app's MENU_FONTS): the phone's own, the app's two, and six packs. */
export type MenuFont = 'device' | 'sans' | 'mono' | 'grotesk' | 'editorial' | 'classic' | 'friendly' | 'geometric' | 'display';
/** Each face's name as owners read it and its font stack (styles/packs.css), in the real app's order. */
export const MENU_FONTS: ReadonlyArray<{ readonly id: MenuFont; readonly label: string; readonly face: string }> = [
  { id: 'device', label: 'Phone’s own', face: 'var(--font-pack-device)' }, { id: 'sans', label: 'Modern', face: 'var(--font-pack-sans)' }, { id: 'mono', label: 'Mono', face: 'var(--font-pack-mono)' },
  { id: 'grotesk', label: 'Grotesk', face: 'var(--font-pack-grotesk)' }, { id: 'editorial', label: 'Editorial', face: 'var(--font-pack-editorial)' }, { id: 'classic', label: 'Classic', face: 'var(--font-pack-classic)' },
  { id: 'friendly', label: 'Friendly', face: 'var(--font-pack-friendly)' }, { id: 'geometric', label: 'Geometric', face: 'var(--font-pack-geometric)' }, { id: 'display', label: 'Display', face: 'var(--font-pack-display)' },
];
/** A face's font stack; Modern is the app's own. */
export const fontFace = (f: MenuFont | undefined): string => MENU_FONTS.find((x) => x.id === f)?.face ?? 'var(--font-pack-sans)';
/** The font list as Select items, each name drawn in its own face. */
export const fontItems = (): ReadonlyArray<{ readonly id: string; readonly label: string; readonly face: string }> => MENU_FONTS.map((f) => ({ id: f.id, label: f.label, face: f.face }));
