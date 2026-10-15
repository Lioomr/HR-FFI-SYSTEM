import type { ReactNode } from "react";
import { payrollRebuildEnabled } from "../services/api/payrollTransport";

/**
 * Picks the rebuilt payroll page once the rebuild API is enabled (mocks or
 * VITE_PAYROLL_REBUILD=1); until then the legacy page keeps serving the live
 * API. Decided at render time, so only the chosen lazy page is loaded.
 */
export default function PayrollRebuildSwitch({
  rebuilt,
  legacy,
}: {
  rebuilt: ReactNode;
  legacy: ReactNode;
}) {
  return <>{payrollRebuildEnabled() ? rebuilt : legacy}</>;
}
