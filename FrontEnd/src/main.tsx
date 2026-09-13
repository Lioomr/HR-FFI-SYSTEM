import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import Providers from "./app/Providers";
import "./index.css";
import "flag-icons/css/flag-icons.min.css";

import { useAuthStore } from "./auth/authStore";

// Hydrate auth state before rendering to prevent redirect loops
useAuthStore.getState().hydrateFromStorage();

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <Providers>
      <App />
    </Providers>
  </React.StrictMode>,
);
