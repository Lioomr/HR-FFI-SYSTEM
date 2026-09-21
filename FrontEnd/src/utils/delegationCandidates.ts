import type { DelegationCandidate } from "../services/api/employeesApi";

export function formatDelegationCandidateLabel(candidate: DelegationCandidate) {
  return candidate.full_name_en || candidate.full_name || "";
}
