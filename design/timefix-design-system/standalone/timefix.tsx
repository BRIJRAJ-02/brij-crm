// The whole Timefix app as a full-screen page.
import '../src/styles/base.css';
import { createRoot } from 'react-dom/client';
import { StrictMode } from 'react';
import { TimefixApp } from '../src/components/TimefixApp/TimefixApp.tsx';

const root = document.getElementById('root');
if (root) createRoot(root).render(<StrictMode><TimefixApp /></StrictMode>);
