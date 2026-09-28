import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.jsx';
import { useStore } from './store/useStore.js';
import * as db from './lib/db/index.js';

// Test builds only — lets the suite assert on which entities got written.
if (__B6_TEST__) window.__b6 = { store: useStore, db };

createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
