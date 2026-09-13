import { useAuthStore } from "../../auth/authStore";
import ExecutiveDashboard from "../../components/executive/ExecutiveDashboard";

export default function CFODashboardPage() {
  const company = useAuthStore((s) => s.user?.active_organization_id);
  return <ExecutiveDashboard key={company} role="CFO" />;
}
