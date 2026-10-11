import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import Providers from "./app/Providers";
import "./index.css";
import "flag-icons/css/flag-icons.min.css";

import { useAuthStore } from "./auth/authStore";
import { useI18nStore } from "./i18n/i18nStore";
import { loadTranslations } from "./i18n/translationLoader";

// Hydrate auth state before rendering to prevent redirect loops
useAuthStore.getState().hydrateFromStorage();

// The saved language's strings are code-split; wait for them so the first
// paint is already translated. A failed chunk fetch must not leave a blank
// page, so render anyway (untranslated keys fall back to their key text).
void loadTranslations(useI18nStore.getState().language)
  .catch(() => undefined)
  .then(() => {
    ReactDOM.createRoot(document.getElementById("root")!).render(
      <React.StrictMode>
        <Providers>
          <App />
        </Providers>
      </React.StrictMode>,
    );
  });
