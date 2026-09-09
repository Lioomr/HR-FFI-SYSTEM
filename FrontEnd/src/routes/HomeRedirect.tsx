import { Navigate } from "react-router-dom";

import { useAuthStore } from "../auth/authStore";
import { getHomePath } from "./homeRoute";

export default function HomeRedirect() {
  const user = useAuthStore((state) => state.user);

  if (!user?.role) return <Navigate to="/unauthorized" replace />;

  return <Navigate to={getHomePath(user.role)} replace />;
}
