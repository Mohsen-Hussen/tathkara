export const QUEUES = {
  /** Releases a hold that wasn't paid in time. Scheduled when the hold is created. */
  expireHold: "hold.expire",
  /** Renders ticket PDFs and emails them after payment. */
  issueTickets: "tickets.issue",
} as const;

export type ExpireHoldJob = { orderId: string };
export type IssueTicketsJob = { orderId: string };
