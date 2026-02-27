import { createBrowserRouter, RouterProvider } from "react-router-dom";
import { routes } from "./routes/routes";
import { useIdleTimeout } from "./hooks/useIdleTimeout";

const router = createBrowserRouter(routes);

function App() {
  useIdleTimeout();
  return <RouterProvider router={router} />;
}

export default App;

