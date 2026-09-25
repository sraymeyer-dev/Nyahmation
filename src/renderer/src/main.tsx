import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { store } from './editor/store';
import './styles.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

// A handle for end-to-end tests and debugging from the developer tools.
(window as unknown as { __nyah: unknown }).__nyah = { store };
