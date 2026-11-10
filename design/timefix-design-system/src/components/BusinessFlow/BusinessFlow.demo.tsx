import { ToastProvider } from '../Toast/Toast.tsx';
import { BusinessFlow } from './BusinessFlow.tsx';

/** Business booking, full screen: Lumen Hair Studio (services with staff) or Olive Kitchen (tables), switched from the Demo menu, which also opens the guest's business page. */
export function BusinessFlowDemo() {
  return (
    <div className="tf-demo tf-demo--canvas tf-bkf-demo">
      <ToastProvider>
        <BusinessFlow showDemoMenu />
      </ToastProvider>
    </div>
  );
}
