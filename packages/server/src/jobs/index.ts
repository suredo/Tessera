// Docs: docs/code/server/jobs.md
// Job control: AI jobs one at a time, cancelled before they start, replaced by a newer request (CLI-06).
export {
  JOBS_AT_ONCE,
  JobQueue,
  type Job,
  type JobOutcome,
  type JobQueueOptions,
  type JobState,
  type JobWork,
} from "./jobs.ts";
