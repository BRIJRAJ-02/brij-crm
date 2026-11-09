// The Bookings flow as a full-screen page: no card frame, no padding.
import '../src/styles/base.css';
import { createRoot } from 'react-dom/client';
import { StrictMode } from 'react';
import { ToastProvider } from '../src/components/Toast/Toast.tsx';
import { BookingsFlow } from '../src/components/BookingsFlow/BookingsFlow.tsx';

const root = document.getElementById('root');
if (root) createRoot(root).render(<StrictMode><ToastProvider><BookingsFlow showDemoMenu /></ToastProvider></StrictMode>);
