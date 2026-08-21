import type { AutosaveTicket } from "../store/editorStore";

export function autosaveErrorKey(ticket: AutosaveTicket, code: string): string {
  return `${ticket.projectGeneration}:${ticket.projectId}:${code}`;
}
