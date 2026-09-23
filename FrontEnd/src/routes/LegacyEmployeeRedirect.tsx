import { Navigate, useParams } from "react-router-dom";

export default function LegacyEmployeeRedirect() {
  const { id } = useParams();
  return <Navigate to={`/hr/employees/${id}`} replace />;
}
