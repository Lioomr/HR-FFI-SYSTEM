import type { PendingRequestType } from "../services/api/pendingRequestsApi";

/** Tag colours per request type — shared by the pending inbox and the HR dashboard. */
export const PENDING_TYPE_COLORS: Record<PendingRequestType, string> = {
  LEAVE: "blue",
  LOAN: "gold",
  ATTENDANCE: "orange",
  ASSET: "purple",
  EMPLOYEE_DELETION: "red",
};

export const PENDING_TYPE_LABEL_KEYS: Record<PendingRequestType, string> = {
  LEAVE: "pendingInbox.requestType.LEAVE",
  LOAN: "pendingInbox.requestType.LOAN",
  ATTENDANCE: "pendingInbox.requestType.ATTENDANCE",
  ASSET: "pendingInbox.requestType.ASSET",
  EMPLOYEE_DELETION: "pendingInbox.requestType.EMPLOYEE_DELETION",
};
