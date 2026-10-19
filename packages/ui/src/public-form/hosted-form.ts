// `@crm/ui/public-form`: the hosted form's page entry (spec 0023,
// 0023-experience.md, The visitor). It mounts HostedForm, drawn with the
// library's own controls, into the page's root inside UiProvider, so the
// hosted page, the embed and the builder's preview are one component tree.
// The page's client sends the answers (`onSubmit`); nothing here touches the
// network. The mount is synchronous, so the page can measure the drawn form
// for an embed's height at once.
import { formStrings, type PublicForm } from '@crm/contracts/forms';
import { createElement, type ReactNode } from 'react';
import { flushSync } from 'react-dom';
import { createRoot } from 'react-dom/client';
import { UiProvider } from '../provider/UiProvider.tsx';
import { createToasts } from '../provider/toasts.tsx';
import { FormMessage, HostedForm, type HostedFormMode, type HostedFormProps } from './HostedForm.tsx';

export type { HostedFormMode, HostedSubmission, HostedSubmitOutcome } from './HostedForm.tsx';

/** How a hosted form is drawn and where its answers go. */
export type HostedFormOptions = Omit<HostedFormProps, 'form'>;

/** A drawn form: `update` draws a changed form in place, `destroy` removes it. */
export interface HostedFormHandle {
  update(form: PublicForm): void;
  destroy(): void;
}

/** Mounts `children` into a new element at the end of `root`, inside the provider, and draws it now. */
function mount(
  root: HTMLElement,
  language?: string,
): { readonly draw: (children: ReactNode) => void; readonly destroy: () => void } {
  const container = document.createElement('div');
  root.append(container);
  const react = createRoot(container);
  const toasts = createToasts();
  const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  // A form speaks its own language, so its country names match the answers it saves.
  const locale = language ?? navigator.languages[0] ?? 'en-US';
  return {
    draw: (children) =>
      flushSync(() =>
        react.render(
          createElement(UiProvider, {
            locale,
            timeZone,
            toasts,
            navigate: (href: string) => globalThis.location.assign(href),
            children,
          }),
        ),
      ),
    destroy: () => {
      react.unmount();
      container.remove();
    },
  };
}

/** A page with no form to draw: an address that names none, or a load that failed. */
export type FormMessageKind = 'missing' | 'failed';

/**
 * Draws a message in the form's place: a plain not found page with no
 * workspace details, or a load that failed. Answers the page title to use.
 */
export function mountFormMessage(
  root: HTMLElement,
  message: { readonly mode: HostedFormMode; readonly kind: FormMessageKind },
): HostedFormHandle & { readonly title: string } {
  const words = formStrings('en');
  const title = message.kind === 'missing' ? words.notFoundTitle : words.failed;
  const view = mount(root);
  view.draw(
    createElement(FormMessage, {
      mode: message.mode,
      title,
      ...(message.kind === 'missing' ? { text: words.notFound } : {}),
    }),
  );
  return { title, update: () => undefined, destroy: view.destroy };
}

/**
 * Draws `form` into `root` with HostedForm: the headline, the sub heading,
 * every question in order and the button, the answer check, the thank you
 * and the closed message. In the preview everything is inert.
 */
export function mountHostedForm(root: HTMLElement, initial: PublicForm, options: HostedFormOptions): HostedFormHandle {
  const view = mount(root, initial.language);
  const draw = (form: PublicForm) => view.draw(createElement(HostedForm, { ...options, form, key: form.key }));
  draw(initial);
  return { update: draw, destroy: view.destroy };
}
