// `@crm/ui/public-form`: the hosted form's page entry (spec 0023,
// 0023-experience.md, The visitor). It mounts HostedForm, drawn with the
// library's own controls, into the page's root inside UiProvider, so the
// hosted page, the embed and the builder's preview are one component tree.
// The page's client sends the answers (`onSubmit`); nothing here touches the
// network. The mount is synchronous, so the page can measure the drawn form
// for an embed's height at once.
import { formStrings, type FormLayout, type PublicForm } from '@crm/contracts/forms';
import { createElement, lazy, Suspense, type ReactNode } from 'react';
import { flushSync } from 'react-dom';
import { createRoot } from 'react-dom/client';
import { UiProvider } from '../provider/UiProvider.tsx';
import { createToasts } from '../provider/toasts.tsx';
import { FormLoading, FormMessage, HostedForm, type HostedFormMode, type HostedFormProps } from './HostedForm.tsx';

export type { HostedFormMode, HostedSubmission, HostedSubmitOutcome } from './HostedForm.tsx';

/**
 * Steps and One at a time (spec 0063, AC-6306, AC-6331): their own chunk, loaded only when a form uses them, so a
 * Classic form's page never carries their code.
 */
const HostedFormSteps = lazy(() =>
  import('./HostedFormSteps.tsx').then((module) => ({ default: module.HostedFormSteps })),
);
export type { HostedUpload, HostedUploadOutcome, HostedUploadedFile, HostedRemoveUpload } from './files.ts';

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
 * Draws the form's shape before the form itself has arrived: the same ground,
 * the same card, and the places the headline, the questions and the button
 * will take. Mounted the moment the page's script runs, so the first paint is
 * the page rather than a blank window, and replaced in place by the form, the
 * message or the closed note once the read answers.
 */
export function mountFormLoading(
  root: HTMLElement,
  mode: HostedFormMode,
  layout: FormLayout = 'classic',
): HostedFormHandle {
  const view = mount(root);
  view.draw(createElement(FormLoading, { mode, words: formStrings('en'), layout }));
  return { update: () => undefined, destroy: view.destroy };
}

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
 * and the closed message; a form in Steps or One at a time with
 * HostedFormSteps, from its own chunk. In the preview everything is inert.
 */
export function mountHostedForm(root: HTMLElement, initial: PublicForm, options: HostedFormOptions): HostedFormHandle {
  const view = mount(root, initial.language);
  const draw = (form: PublicForm) => {
    if (form.layout === undefined || form.layout === 'classic') {
      view.draw(createElement(HostedForm, { ...options, form, key: form.key }));
      return;
    }
    // While the layout's chunk loads, its own loading shape holds its place, so the first paint never jumps.
    view.draw(
      createElement(Suspense, {
        fallback: createElement(FormLoading, {
          mode: options.mode,
          words: formStrings(form.language),
          layout: form.layout,
        }),
        children: createElement(HostedFormSteps, { ...options, form, key: form.key }),
      }),
    );
  };
  draw(initial);
  return { update: draw, destroy: view.destroy };
}
