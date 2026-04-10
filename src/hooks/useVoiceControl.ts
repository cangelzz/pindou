import { useRef, useState, useCallback, useEffect } from "react";

export type VoiceCommand =
  | "up"
  | "down"
  | "left"
  | "right"
  | "cancel"
  | "confirm"
  | "unknown";

interface VoiceCommandResult {
  command: VoiceCommand;
  raw: string;
  confidence: number;
}

// ─── Command matching table ──────────────────────────────────────

const COMMAND_PATTERNS: { patterns: RegExp; command: VoiceCommand }[] = [
  { patterns: /^(上|向上|往上|上面|上移|shàng)$/i, command: "up" },
  { patterns: /^(下|向下|往下|下面|下移|xià)$/i, command: "down" },
  { patterns: /^(左|向左|往左|左边|左移|zuǒ)$/i, command: "left" },
  { patterns: /^(右|向右|往右|右边|右移|yòu)$/i, command: "right" },
  { patterns: /^(取消|关闭|清除|取消高亮|qǔxiāo)$/i, command: "cancel" },
  { patterns: /^(确认|好了|完成|确定|quèrèn)$/i, command: "confirm" },
  // English fallback
  { patterns: /^(up|go up|move up)$/i, command: "up" },
  { patterns: /^(down|go down|move down)$/i, command: "down" },
  { patterns: /^(left|go left|move left)$/i, command: "left" },
  { patterns: /^(right|go right|move right)$/i, command: "right" },
  { patterns: /^(cancel|clear|stop)$/i, command: "cancel" },
  { patterns: /^(confirm|ok|done|yes)$/i, command: "confirm" },
];

function matchCommand(text: string): VoiceCommand {
  const cleaned = text.trim();
  for (const { patterns, command } of COMMAND_PATTERNS) {
    if (patterns.test(cleaned)) return command;
  }
  // Fuzzy: check if any keyword is contained in the text
  if (/上/.test(cleaned)) return "up";
  if (/下/.test(cleaned)) return "down";
  if (/左/.test(cleaned)) return "left";
  if (/右/.test(cleaned)) return "right";
  if (/取消|关闭|清除/.test(cleaned)) return "cancel";
  if (/确认|完成|好/.test(cleaned)) return "confirm";
  return "unknown";
}

// ─── Hook ────────────────────────────────────────────────────────

interface UseVoiceControlOptions {
  lang?: string;
  onCommand: (result: VoiceCommandResult) => void;
}

export function useVoiceControl({ lang = "zh-CN", onCommand }: UseVoiceControlOptions) {
  const [isListening, setIsListening] = useState(false);
  const [lastResult, setLastResult] = useState<VoiceCommandResult | null>(null);
  const [isSupported] = useState(() => typeof window !== "undefined" && ("SpeechRecognition" in window || "webkitSpeechRecognition" in window));
  const recognitionRef = useRef<SpeechRecognition | null>(null);
  const onCommandRef = useRef(onCommand);
  onCommandRef.current = onCommand;

  const start = useCallback(() => {
    if (!isSupported) return;
    if (recognitionRef.current) {
      recognitionRef.current.abort();
    }

    const SpeechRecognition = window.SpeechRecognition || (window as unknown as { webkitSpeechRecognition: typeof window.SpeechRecognition }).webkitSpeechRecognition;
    const recognition = new SpeechRecognition();
    recognition.lang = lang;
    recognition.continuous = true;
    recognition.interimResults = false;
    recognition.maxAlternatives = 3;

    recognition.onresult = (event: SpeechRecognitionEvent) => {
      const last = event.results[event.results.length - 1];
      if (!last.isFinal) return;

      const transcript = last[0].transcript.trim();
      const confidence = last[0].confidence;
      const command = matchCommand(transcript);

      const result: VoiceCommandResult = { command, raw: transcript, confidence };
      setLastResult(result);
      onCommandRef.current(result);
    };

    recognition.onerror = (event) => {
      // "no-speech" is normal when user is silent — just keep listening
      if (event.error === "no-speech" || event.error === "aborted") return;
      console.warn("Voice recognition error:", event.error);
    };

    recognition.onend = () => {
      // Auto-restart if still supposed to be listening
      if (recognitionRef.current === recognition) {
        try {
          recognition.start();
        } catch {
          // Already started or stopped
        }
      }
    };

    recognitionRef.current = recognition;
    recognition.start();
    setIsListening(true);
  }, [isSupported, lang]);

  const stop = useCallback(() => {
    if (recognitionRef.current) {
      const ref = recognitionRef.current;
      recognitionRef.current = null; // prevent auto-restart
      ref.abort();
    }
    setIsListening(false);
    setLastResult(null);
  }, []);

  const toggle = useCallback(() => {
    if (isListening) {
      stop();
    } else {
      start();
    }
  }, [isListening, start, stop]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (recognitionRef.current) {
        recognitionRef.current.abort();
        recognitionRef.current = null;
      }
    };
  }, []);

  return { isListening, isSupported, lastResult, start, stop, toggle };
}
