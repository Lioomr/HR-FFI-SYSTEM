import type { PendingRequestType } from "../services/api/pendingRequestsApi";

/** Tag colours per request type — shared by the pending inbox and the HR dashboard. */
export const PENDING_TYPE_COLORS: Record<PendingRequestType, string> = {
  LEAVE: "blue",
  LOAN: "gold",
  ATTENDANCE: "orange",
  ASSET: "purple",
  EMPLOYEE_DELETION: "red",
  CONTRACT_DECISION: "cyan",
  CONTRACT_RATING: "geekblue",
  ANNUAL_LEAVE_PAYMENT: "green",
};

export const PENDING_TYPE_LABEL_KEYS: Record<PendingRequestType, string> = {
  LEAVE: "pendingInbox.requestType.LEAVE",
  LOAN: "pendingInbox.requestType.LOAN",
  ATTENDANCE: "pendingInbox.requestType.ATTENDANCE",
  ASSET: "pendingInbox.requestType.ASSET",
  EMPLOYEE_DELETION: "pendingInbox.requestType.EMPLOYEE_DELETION",
  CONTRACT_DECISION: "pendingInbox.requestType.CONTRACT_DECISION",
  CONTRACT_RATING: "pendingInbox.requestType.CONTRACT_RATING",
  ANNUAL_LEAVE_PAYMENT: "pendingInbox.requestType.ANNUAL_LEAVE_PAYMENT",
};
