// The hosted form page's own entry (spec 0023, 0023-public-surface.md): a
// second build entry beside the app, sharing nothing with its shell. It loads
// the library's styles and the one form page, reads the public key from the
// address (/f/<publicKey>), and talks to the public endpoints only.
import '@crm/ui/styles.css';
import { createPublicFormClient, loadCaptcha } from '@crm/data/public-form';
import { createToasts, UiProvider } from '@crm/ui';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { PublicFormPage } from './PublicFormPage.tsx';

const root = document.querySelector('[data-app-root]');
if (root === null) throw new Error('The page has no root.');

const publicKey = decodeURIComponent(window.location.pathname.replace(/^\/f\//, '').split('/')[0] ?? '');
const client = createPublicFormClient();

createRoot(root).render(
  <StrictMode>
    <UiProvider
      locale={navigator.languages[0] ?? 'en-US'}
      timeZone={Intl.DateTimeFormat().resolvedOptions().timeZone}
      navigate={(href) => {
        window.location.assign(href);
      }}
      toasts={createToasts()}
    >
      <PublicFormPage publicKey={publicKey} client={client} captcha={loadCaptcha} />
    </UiProvider>
  </StrictMode>,
);
