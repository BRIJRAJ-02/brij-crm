import { createRoot } from 'react-dom/client';
import { StrictMode } from 'react';
import { demos } from './registry.ts';

/** Renders a component's demo into #root (or the given element): what each preview.html calls. */
export function mount(name: string, el?: HTMLElement): void {
  const target = el ?? document.getElementById('root');
  const Demo = demos[name];
  if (!target || !Demo) {
    if (target) target.textContent = `No demo named ${name}`;
    return;
  }
  createRoot(target).render(<StrictMode><Demo /></StrictMode>);
}
