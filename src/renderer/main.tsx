import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { connectStore } from './state/store';

const container = document.getElementById('root');
if (!container) {
  throw new Error('Missing #root element');
}

// One event stream for the window's lifetime; it reconnects by itself.
connectStore();

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
