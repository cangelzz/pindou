import { invoke } from "@tauri-apps/api/core";
import type { VoiceCommand } from "../hooks/useVoiceControl";
import type { VoiceEnhancementResult, VoiceEnhancementService } from "../platform/services";
import { getGitHubToken } from "./githubToken";

const SYSTEM_PROMPT = `You are a voice command parser for a pixel bead art editor.
Return exactly one JSON object and no prose or Markdown.
The command field must be one of: up, down, left, right, cancel, confirm, summary, goto, still_here, unknown.
For repeated movement, include integer repeat from 1 to 99. Understand Arabic and 中文数字 such as 两次、三步.
For an absolute location, use command goto with one-based integer col and row fields.
JSON examples:
"向右两次" -> {"command":"right","repeat":2}
"上三步" -> {"command":"up","repeat":3}
"第3列第5行" -> {"command":"goto","col":3,"row":5}
"取消" -> {"command":"cancel"}`;

export const tauriVoiceEnhancementService: VoiceEnhancementService = {
  async interpret(transcript: string): Promise<VoiceEnhancementResult> {
    const token = getGitHubToken();
    if (!token) return { command: "unknown", enhanced: false };
    try {
      const raw = await invoke<string>("github_models_chat", { token, transcript, systemPrompt: SYSTEM_PROMPT });
      const cleaned = raw.replace(/```json\s*|```\s*/g, "").trim();
      const data = JSON.parse(cleaned);
      if (!data || typeof data !== "object" || Array.isArray(data)) throw new Error("Invalid command object");
      const valid: VoiceCommand[] = ["up", "down", "left", "right", "cancel", "confirm", "summary", "goto", "still_here"];
      const direction = ["up", "down", "left", "right"].includes(data.command);
      const repeatValid = data.repeat === undefined
        || (direction && Number.isInteger(data.repeat) && data.repeat >= 1 && data.repeat <= 99);
      const gotoValid = data.command !== "goto"
        || (Number.isInteger(data.col) && Number.isInteger(data.row));
      const command = valid.includes(data.command) && repeatValid && gotoValid ? data.command : "unknown";
      return {
        command,
        enhanced: true,
        repeat: command !== "unknown" && direction && data.repeat !== undefined ? data.repeat : undefined,
        gotoCol: command === "goto" ? data.col : undefined,
        gotoRow: command === "goto" ? data.row : undefined,
      };
    } catch {
      return { command: "unknown", enhanced: true };
    }
  },
};
