// Where a form editor's tab draws its own tools: the end of the Form · Settings · Install · Submissions strip, as
// Captures' tabs do. The editor owns the element; the Submissions tab portals its filter and search into it.
import { createContext, useContext } from 'react';

/** The strip's end, once the editor has drawn it. */
export const FormToolbarSlot = createContext<HTMLElement | null>(null);

/** The element a tab draws its tools into, or null before the editor has one (the tab then draws them itself). */
export const useFormToolbarSlot = () => useContext(FormToolbarSlot);
