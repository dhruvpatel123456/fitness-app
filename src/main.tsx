import { QueryClientProvider } from '@tanstack/react-query';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import './index.css';
import { queryClient } from './lib/queries';
import { toast } from './lib/toast';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>
  </StrictMode>,
);

// The service worker keeps the app's files on the phone so it opens instantly.
// Browsers only allow it over HTTPS (or on localhost).
if (import.meta.env.PROD && 'serviceWorker' in navigator && window.isSecureContext) {
  window.addEventListener('load', () => {
    const hadWorker = Boolean(navigator.serviceWorker.controller);
    navigator.serviceWorker.register('/sw.js').catch(() => {
      // The app works without it; it just loads over the network each time.
    });
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (!hadWorker) return;
      toast('A new version of the app is ready.', {
        duration: 20000,
        action: { label: 'Reload', run: () => window.location.reload() },
      });
    });
  });
}
