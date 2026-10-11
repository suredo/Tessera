# D7. Progress streaming

Requirements: `CLI-07`, `GEN-16`.

Claude Code has a streaming output mode. Open question: does it report useful progress while keeping the final structured output intact? If it does, the person sees real progress ("writing the interface…"). If not, the app shows the stage name and elapsed time.

**Recommendation:** run a spike (a short experiment) in M2. Fall back to elapsed time if streaming complicates the adapter.
