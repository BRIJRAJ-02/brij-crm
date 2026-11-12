import { Kbd } from './Kbd.tsx';
export function KbdDemo() {
  return <div className="tf-demo tf-row" style={{ gap: 'var(--space-12)' }}><Kbd>⌘K</Kbd><Kbd>⌘1</Kbd><Kbd>⇧⌘P</Kbd><Kbd>Esc</Kbd><Kbd>C</Kbd><Kbd>↵</Kbd></div>;
}
