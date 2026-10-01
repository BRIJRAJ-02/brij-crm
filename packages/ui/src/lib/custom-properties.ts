// Inline styles may only hand CSS custom properties to a component's module
// (`style={{ '--progress': '42%' }}`; lint refuses anything else). React's
// style type doesn't know custom properties, so this teaches it.
import 'react';

declare module 'react' {
  interface CSSProperties {
    readonly [property: `--${string}`]: string | undefined;
  }
}
