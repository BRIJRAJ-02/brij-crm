// Brief
// Purpose: makes the command menu (spec 0039) answerable from anywhere in a workspace: ⌘K, `/`, and `useCommandMenu()`.
// Main task: open the menu in commands or search mode, instantly, loading its code on idle so the first ⌘K finds it ready.
// Leaves out: the menu itself (CommandMenu.tsx, its own chunk) and where the sidebar draws its buttons (spec 0034's).
import { useKeyboardPlatform } from '@crm/ui';
import { useRouteContext } from '@tanstack/react-router';
import {
  createContext,
  lazy,
  Suspense,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import type { KeyTarget } from '../workspace/undo.ts';
import type { CommandMode, CommandRecord } from './commands.ts';
import { commandKey } from './keys.ts';

/** What the sidebar and any screen may do with the command menu (agreed with spec 0034's sidebar lane). */
export interface CommandMenuControl {
  /** Opens the menu: everything (`commands`, the default: Quick actions, ⌘K) or search only (`search`, `/`). */
  readonly open: (mode?: CommandMode) => void;
  /**
   * The record page open now, for its own actions (New note on <name>, New task on <name>): a record page sets it
   * while the person may add to it, and clears it as it goes.
   */
  readonly setRecord: (record: CommandRecord | undefined) => void;
}

/** Outside a workspace (a page still loading, an error page) there is no menu, and opening it does nothing. */
const NO_MENU: CommandMenuControl = { open: () => undefined, setRecord: () => undefined };

const CommandMenuContext = createContext<CommandMenuControl>(NO_MENU);

/**
 * The command menu's control: `open()` for Quick actions, `open('search')`
 * for search. The sidebar's WorkspaceFrame calls it; the keys need nothing.
 */
export function useCommandMenu(): CommandMenuControl {
  return useContext(CommandMenuContext);
}

const loadMenu = () => import('./CommandMenu.tsx');
const CommandMenu = lazy(() => loadMenu().then((module) => ({ default: module.CommandMenu })));

/** Where the menu stands: open or not, in which mode, and which opening (each starts empty, AC-1073). */
interface MenuState {
  readonly isOpen: boolean;
  readonly mode: CommandMode;
  readonly opening: number;
}

/** Props for CommandMenuProvider. */
export interface CommandMenuProviderProps {
  /** The workspace's address. */
  readonly slug: string;
  readonly children: ReactNode;
}

/**
 * Holds the menu's open state for a workspace, listens for ⌘K and `/` on the
 * document (AC-1071), and draws the menu (a lazy chunk, AC-1074) only once
 * it has been opened. The chunk starts loading when the browser is idle after
 * the frame paints, so the first ⌘K normally finds it ready; if not, the menu
 * opens as soon as it lands.
 */
export function CommandMenuProvider({ slug, children }: CommandMenuProviderProps) {
  const platform = useKeyboardPlatform();
  const { data } = useRouteContext({ from: '__root__' });
  const [state, setState] = useState<MenuState>({ isOpen: false, mode: 'commands', opening: 0 });
  const [record, setRecord] = useState<CommandRecord | undefined>(undefined);
  const open = useCallback((mode: CommandMode = 'commands') => {
    setState((now) => ({ isOpen: true, mode, opening: now.isOpen ? now.opening : now.opening + 1 }));
  }, []);
  const setOpen = useCallback((isOpen: boolean) => {
    setState((now) => (now.isOpen === isOpen ? now : { ...now, isOpen }));
  }, []);

  // What the listener reads of the state; the listener stays one function for the frame's life.
  const isOpenNow = useRef(state.isOpen);
  useEffect(() => {
    isOpenNow.current = state.isOpen;
  }, [state.isOpen]);
  useEffect(() => {
    const listener = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return;
      const target = event.target instanceof Element ? (event.target as Element & KeyTarget) : null;
      const action = commandKey(event, target, platform, isOpenNow.current);
      if (action === undefined) return;
      event.preventDefault();
      if (action.kind === 'close') {
        isOpenNow.current = false;
        setState((now) => ({ ...now, isOpen: false }));
        return;
      }
      isOpenNow.current = true;
      setState((now) => ({ isOpen: true, mode: action.mode, opening: now.opening + 1 }));
    };
    document.addEventListener('keydown', listener);
    return () => {
      document.removeEventListener('keydown', listener);
    };
  }, [platform]);

  // The menu's chunk on idle, after the frame paints (AC-1074).
  useEffect(() => {
    // The menu's chunk and the search's own, so the first ⌘K waits on neither.
    const start = () => {
      void loadMenu().catch(() => undefined);
      void data.search.preload().catch(() => undefined);
    };
    if (typeof window.requestIdleCallback === 'function') {
      const id = window.requestIdleCallback(start, { timeout: 5_000 });
      return () => {
        window.cancelIdleCallback(id);
      };
    }
    const timer = window.setTimeout(start, 2_000);
    return () => {
      window.clearTimeout(timer);
    };
  }, [data]);

  const control = useMemo<CommandMenuControl>(() => ({ open, setRecord }), [open]);
  return (
    <CommandMenuContext.Provider value={control}>
      {children}
      {state.opening > 0 && (
        <Suspense fallback={null}>
          <CommandMenu
            // Each opening starts afresh: an empty field, its own search (AC-1073).
            key={state.opening}
            slug={slug}
            mode={state.mode}
            isOpen={state.isOpen}
            onOpenChange={setOpen}
            {...(record === undefined ? {} : { record })}
          />
        </Suspense>
      )}
    </CommandMenuContext.Provider>
  );
}
