// Business booking as a full-screen page: a salon and a restaurant, switchable from the Demo menu.
import '../src/styles/base.css';
import { createRoot } from 'react-dom/client';
import { StrictMode } from 'react';
import { ToastProvider } from '../src/components/Toast/Toast.tsx';
import { BusinessFlow } from '../src/components/BusinessFlow/BusinessFlow.tsx';

const root = document.getElementById('root');
if (root) createRoot(root).render(<StrictMode><ToastProvider><BusinessFlow showDemoMenu /></ToastProvider></StrictMode>);
