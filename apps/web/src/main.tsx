// The root stylesheet comes first. The layer order itself comes from
// /layers.css, which layerOrder() (vite.config.ts) links ahead of every bundled
// stylesheet, since Vite links a shared chunk's CSS before this entry's
// (build.test.ts checks).
import '@crm/ui/styles.css';
import { createDataLayer, createIdMinter } from '@crm/data';
import { createToasts, LOADING_TIMING, UiProvider, type ToastContent } from '@crm/ui';
import { createThemeController, safeLocalStorage } from '@crm/ui/theme';
import { createRouter, RouterProvider } from '@tanstack/react-router';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { signInHref } from './features/auth/redirect.ts';
import { createFocusRecovery, focusFirstLoad, focusPage, isSamePage } from './features/navigation/focus.ts';
import { PRELOAD_DELAY_MS, startIntentPreload } from './features/navigation/preload.ts';
import { followPageTitle } from './features/navigation/title.ts';
import { rememberPlace, safeSessionStorage } from './features/settings/back.ts';
import { importSummaryHref } from './features/imports/paths.ts';
import { jobFinishedToast } from './features/settings/toast.ts';
import { bulkActionOf } from './features/workspace/bulk-jobs.ts';
import { jobsHref } from './features/workspace/objects.ts';
import { replacedToast } from './features/workspace/replaced.ts';
import { startMonitoring } from './monitoring/index.ts';
import { routeTree } from './routeTree.gen.ts';

// Monitoring first (spec 0010), so a fault from here on is kept. Without VITE_SENTRY_DSN_WEB in the build
// it does nothing; with it, the Sentry chunk loads beside the app, never in its way.
const monitor = startMonitoring({
  config: {
    dsn: import.meta.env.VITE_SENTRY_DSN_WEB,
    release: import.meta.env.APP_RELEASE,
    environment: import.meta.env.APP_ENVIRONMENT,
    // The route pattern open now (`/w/$slug/objects/$object`), never the filled address.
    route: () => router.state.matches.at(-1)?.routeId,
  },
  target: window,
  load: () => import('./monitoring/sentry.ts'),
});

// One toast queue for the app, shared by the screens and the data layer.
const toasts = createToasts();

// `router` is made after the data layer (it carries the layer in its
// context); the layer reaches it only once a session starts or ends, long
// after both exist.
const goTo = (href: string) => {
  void router.navigate({ href, replace: true });
};
// Who is signed in changed: the router's loaded pages belong to the last
// person, so none of them may show again (Back after someone else signs in).
const forgetPages = () => {
  router.clearCache();
};
// Someone changed an object's attributes (a live change): the pages showing
// them load again, so a new column appears.
const reloadPages = () => {
  void router.invalidate();
};

// Centrifugo's address, baked in at build time; unset (previews), live updates are off.
const realtimeUrl = import.meta.env.VITE_REALTIME_URL;

const data = createDataLayer({
  origin: window.location.origin,
  notify: (notice) => {
    toasts.toast(notice);
  },
  mintId: createIdMinter({
    now: () => Date.now(),
    fill: (bytes) => {
      crypto.getRandomValues(bytes);
    },
  }),
  // The session ended under the person: sign in says so, and whether a change was lost with it.
  onSignedOut: (redirectTo, { unsaved }) => {
    goTo(signInHref(redirectTo, unsaved ? 'unsaved' : 'ended'));
  },
  onSessionChange: forgetPages,
  currentPath: () => `${window.location.pathname}${window.location.search}`,
  ...(realtimeUrl === undefined || realtimeUrl === '' ? {} : { realtimeUrl }),
  onDefinitionsChange: reloadPages,
  // Someone else's later save replaced a value this tab saved (spec 0006): say so, with Use mine.
  onReplaced: (replaced) => {
    toasts.toast(replacedToast(replaced));
  },
  // A job this browser started ended (spec 0008, AC-119): say how, with a way to the Background jobs page.
  onJobFinished: (workspace, job) => {
    const onView = () => {
      void router.navigate({ href: jobsHref(workspace) });
    };
    // A bulk change (spec 0022): its own words, and Undo for a delete (its batch is the job's id), loaded only now.
    // Should that load fail (a new deploy, offline), the plain job toast still says how it ended.
    if (bulkActionOf(job.kind) !== undefined) {
      const toast = (content: ToastContent) => {
        toasts.toast(content);
      };
      void import('./features/workspace/bulk-finished.ts').then(
        ({ bulkFinished }) => bulkFinished({ data, toast, onView }, workspace, job),
        () => {
          toast(jobFinishedToast(job, onView));
        },
      );
      return;
    }
    // A records export (spec 0040, AC-1131): its end offers the file.
    const exported = data.exports.forJob(job.id);
    if (exported !== undefined && job.status === 'succeeded') {
      toasts.toast({
        tone: 'success',
        message: `${exported.fileName} is ready`,
        action: {
          label: 'Download',
          onAction: () => {
            window.location.assign(exported.downloadPath);
          },
        },
      });
      return;
    }
    // An import or its undo (spec 0040, AC-1125): View opens the import's summary, not the jobs page.
    const importId = data.imports.forJob(job.id);
    const objectId = job.subject?.id;
    if (importId !== undefined && objectId !== undefined) {
      data.objects.all(workspace).then(
        (objects) => {
          const object = objects.find((each) => each.id === objectId);
          const onImport = () => {
            if (object !== undefined) void router.navigate({ href: importSummaryHref(workspace, object, importId) });
          };
          toasts.toast(jobFinishedToast(job, object === undefined ? onView : onImport));
        },
        () => {
          toasts.toast(jobFinishedToast(job, onView));
        },
      );
      return;
    }
    toasts.toast(jobFinishedToast(job, onView));
  },
  // Faults the server never saw: an answer without one of our codes, or one thrown inside the layer.
  report: monitor.report,
});

// theme-boot.js already applied a saved choice before first paint; this keeps
// it in step with changes here and in other tabs.
const theme = createThemeController({
  storage: safeLocalStorage(window),
  root: document.documentElement,
  barMetas: [...document.querySelectorAll('meta[name="theme-color"]')],
  onStorage: (handler) => {
    const listener = (event: StorageEvent) => {
      handler(event.key, event.newValue);
    };
    window.addEventListener('storage', listener);
    return () => {
      window.removeEventListener('storage', listener);
    };
  },
});

const router = createRouter({
  routeTree,
  context: { data, theme, toasts },
  defaultPreload: 'intent',
  defaultPreloadDelay: PRELOAD_DELAY_MS,
  // A pending route shows its skeleton on the same timing as everything else (AC-13).
  defaultPendingMs: LOADING_TIMING.delayMs,
  defaultPendingMinMs: LOADING_TIMING.minimumMs,
});

// Every route a navigation matches starts loading its code (its page and its pending page) as the navigation
// begins. The router itself starts only after a route's beforeLoad (the workspace frame's waits on `me.get`), so
// a pending page could show before its own chunk had arrived: its lazy component suspended, painting nothing, and
// React warned "This library called use() to suspend…" on every first load.
router.subscribe('onBeforeLoad', ({ toLocation }) => {
  const [routes] = router.getMatchedRoutes(toLocation.pathname);
  for (const route of routes) router.loadRouteChunk(route)?.catch(() => undefined);
});

// After moving to another page, focus goes to its title (the page's h1), so
// a screen reader starts there and Tab continues from the top of the page;
// on /sign-in and /verify, to their one field (focus.ts). On the first load,
// only those one field pages move focus, into their field.
const focusRecovery = createFocusRecovery(document);
// Each workspace page reached outside Settings is where Settings' back link returns (spec 0026, AC-681).
router.subscribe('onResolved', (event) => {
  rememberPlace(safeSessionStorage(window), event.toLocation.href);
});
router.subscribe('onRendered', (event) => {
  const { pathname } = event.toLocation;
  if (event.fromLocation === undefined) {
    requestAnimationFrame(() => {
      focusFirstLoad(document, pathname);
    });
    return;
  }
  // The same page again (a Retry, a reload in place): focus stays where the person put it, unless it left with
  // the old content, when the title takes it.
  if (!event.pathChanged) {
    requestAnimationFrame(() => {
      focusRecovery.recover(pathname);
    });
    return;
  }
  // Another tab of the same page (spec 0017): the record page puts focus on the tab chosen itself.
  if (isSamePage(event.fromLocation.pathname, pathname)) return;
  requestAnimationFrame(() => {
    focusPage(document, pathname);
  });
});

// Every link, tab and row into a page preloads it on intent (its chunk and its loader's data), not only the
// router's own Link: the sidebar and the library's links navigate through UiProvider (preload.ts).
startIntentPreload({
  target: document,
  origin: window.location.origin,
  preload: (href) => {
    // An address, as the router's own navigate({ href }) takes; preloadRoute's type asks for `to`, which `href` replaces.
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-assertion -- tsc needs it; the lint resolves the type looser
    router.preloadRoute({ href } as unknown as Parameters<typeof router.preloadRoute>[0]).catch(() => undefined);
  },
  delayMs: PRELOAD_DELAY_MS,
  setTimer: (run, ms) => window.setTimeout(run, ms),
  clearTimer: (timer) => {
    window.clearTimeout(timer);
  },
});

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router;
  }
}

const root = document.getElementById('root');
if (!root) throw new Error('The page is missing its #root element.');

// The tab's title follows the page's h1 from the first load on (WCAG 2.4.2).
followPageTitle({
  doc: document,
  observe: (onChange) => {
    const observer = new MutationObserver(onChange);
    observer.observe(root, { childList: true, subtree: true, characterData: true });
    return () => {
      observer.disconnect();
    };
  },
  nextFrame: (run) => {
    requestAnimationFrame(run);
  },
});

// The browser's language and time zone until #23 adds them to the profile.
createRoot(root, monitor.rootOptions).render(
  <StrictMode>
    <UiProvider
      locale={navigator.languages[0] ?? 'en-US'}
      timeZone={Intl.DateTimeFormat().resolvedOptions().timeZone}
      navigate={(href) => {
        router.history.push(href);
      }}
      useHref={(href) => router.history.createHref(href)}
      toasts={toasts}
    >
      <RouterProvider router={router} />
    </UiProvider>
  </StrictMode>,
);
