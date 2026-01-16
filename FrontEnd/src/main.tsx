import React from "react";
import ReactDOM from "react-dom/client";
import { createBrowserRouter, RouterProvider } from "react-router-dom";
import { routes } from "./routes/routes";
import Providers from "./app/Providers";

import { useAuthStore } from "./auth/authStore";

const router = createBrowserRouter(routes);

// Hydrate auth state before rendering to prevent redirect loops
useAuthStore.getState().hydrateFromStorage();

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <Providers>
      <RouterProvider router={router} />
    </Providers>
  </React.StrictMode>
);
