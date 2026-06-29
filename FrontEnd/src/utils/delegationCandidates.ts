import type { DelegationCandidate } from "../services/api/employeesApi";

export function formatDelegationCandidateLabel(candidate: DelegationCandidate) {
  const name =
    candidate.full_name_en || candidate.full_name || candidate.employee_id;
  const disabledReason = candidate.disabled_reason
    ? ` - ${candidate.disabled_reason}`
    : "";

  return `${name} (${candidate.employee_id})${disabledReason}`;
}
