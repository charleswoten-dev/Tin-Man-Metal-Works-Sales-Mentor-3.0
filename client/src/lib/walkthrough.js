// The message that launches the guided 17-step walkthrough. Sent as a normal
// user message so the mentor (per the WALKTHROUGH MODE rules in the server
// system prompt) begins coaching through the steps one at a time. A generic
// launch has no project yet, so the mentor asks the user to name one first.
export const WALKTHROUGH_KICKOFF =
  "I'm ready to start Charles's 17-step selling system. Before step 1, ask me what I'd like to name this project, then walk me through it one step at a time, tailoring each step to my business.";

// Launch tied to an already-named project (from the Progress page). The mentor
// skips the naming question and goes straight to step 1.
export function walkthroughKickoffForProject(name) {
  return `I'm ready — walk me through Charles's 17-step selling system for my project "${name}". I've already named it, so skip the naming question and start at step 1, tailoring each step to my business.`;
}
