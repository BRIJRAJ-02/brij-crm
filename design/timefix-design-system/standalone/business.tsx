// Business booking as a full-screen page: a salon and a restaurant, switchable from the Demo menu.
import '../src/styles/base.css';
import { createRoot } from 'react-dom/client';
import { StrictMode } from 'react';
import { ToastProvider } from '../src/components/Toast/Toast.tsx';
import { BookingsApp } from '../src/components/BusinessFlow/app.tsx';

const root = document.getElementById('root');
if (root) createRoot(root).render(<StrictMode><ToastProvider><BookingsApp start="lumen" /></ToastProvider></StrictMode>);
