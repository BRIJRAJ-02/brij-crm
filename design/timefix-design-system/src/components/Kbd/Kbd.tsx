import './Kbd.css';
/** A keycap for a shortcut: one per combination ("⌘K", "Esc"). */
export function Kbd({ children }: { readonly children: string }) {
  return <kbd className="tf-kbd">{children}</kbd>;
}
