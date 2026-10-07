// What the data layer raises on the app's toast queue.

/** A message for the person, raised on the app's toast queue. The same shape as the library's `ToastContent`. */
export interface Notice {
  readonly tone: 'success' | 'danger';
  readonly message: string;
  readonly action?: { readonly label: string; readonly onAction: () => void };
}
