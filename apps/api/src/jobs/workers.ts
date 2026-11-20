import type { Deps } from "../context.js";
import { expireHold } from "../services/booking.js";
import { issueTickets } from "../services/tickets.js";
import { QUEUES, type ExpireHoldJob, type IssueTicketsJob } from "./queues.js";

export async function createQueues(deps: Pick<Deps, "boss">) {
  await deps.boss.createQueue(QUEUES.expireHold, { retryLimit: 5, retryBackoff: true });
  await deps.boss.createQueue(QUEUES.issueTickets, { retryLimit: 5, retryBackoff: true });
}

/** Both handlers are idempotent, so pg-boss retries (or a duplicate delivery) are harmless. */
export async function startWorkers(deps: Deps) {
  await deps.boss.work<ExpireHoldJob>(QUEUES.expireHold, { pollingIntervalSeconds: 1 }, async (jobs) => {
    for (const job of jobs) await expireHold(deps, job.data.orderId);
  });
  await deps.boss.work<IssueTicketsJob>(QUEUES.issueTickets, { pollingIntervalSeconds: 1 }, async (jobs) => {
    for (const job of jobs) await issueTickets(deps, job.data.orderId);
  });
}
