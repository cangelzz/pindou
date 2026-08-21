import { useRef, useState, useCallback, useEffect } from "react";
import { getPlatformServices } from "../platform/serviceRegistry";
import type { VoiceEnhancementResult } from "../platform/services";
import { i18n } from "../i18n";

export type VoiceCommand =
  | "up"
  | "down"
  | "left"
  | "right"
  | "cancel"
  | "confirm"
  | "summary"
  | "goto"
  | "still_here"
  | "unknown";

interface VoiceCommandResult {
  command: VoiceCommand;
  raw: string;
  confidence: number;
  repeat?: number;       // repeat count for directional commands
  gotoCol?: number;      // target column for "goto" command
  gotoRow?: number;      // target row for "goto" command
}

// ─── Command matching table ──────────────────────────────────────

// Exact matches
const EXACT_PATTERNS: { patterns: RegExp; command: VoiceCommand }[] = [
  { patterns: /^(上|向上|往上|上面|上移|上去|上方)$/i, command: "up" },
  { patterns: /^(下|向下|往下|下面|下移|下去|下方)$/i, command: "down" },
  { patterns: /^(左|向左|往左|左边|左移|左面|左方)$/i, command: "left" },
  { patterns: /^(右|向右|往右|右边|右移|右面|右方)$/i, command: "right" },
  { patterns: /^(取消|关闭|清除|取消高亮)$/i, command: "cancel" },
  { patterns: /^(确认|好了|完成|确定)$/i, command: "confirm" },
  { patterns: /^(总结|统计|汇总|报告|播报|念一下|读一下|数一下|数数|看看|说说|告诉我|报数|清点|盘点|多少|几种)$/i, command: "summary" },
  { patterns: /^(还在|还在呢|我在|我在呢|在的|在|继续|我还在)$/i, command: "still_here" },
  { patterns: /^(up|go up|move up)$/i, command: "up" },
  { patterns: /^(down|go down|move down)$/i, command: "down" },
  { patterns: /^(left|go left|move left)$/i, command: "left" },
  { patterns: /^(right|go right|move right)$/i, command: "right" },
  { patterns: /^(cancel|clear|stop)$/i, command: "cancel" },
  { patterns: /^(confirm|ok|done|yes)$/i, command: "confirm" },
  { patterns: /^(summary|summarize|statistics|stats|report|count colors)$/i, command: "summary" },
  { patterns: /^(still here|i am here|i'm here|continue)$/i, command: "still_here" },
];

// Homophone / misrecognition mapping — all characters sharing the same sound
const HOMOPHONES: { patterns: RegExp; command: VoiceCommand }[] = [
  // shàng/shǎng/shāng — 上的同音字
  { patterns: /^[尚伤赏商晌裳殇觞墒熵]$/, command: "up" },
  // xià/xiá/xiā — 下的同音字
  { patterns: /^[吓夏瞎虾侠狭峡霞辖暇遐黠匣]$/, command: "down" },
  // zuǒ/zuò/zuō — 左的同音字
  { patterns: /^[做坐作座昨琢撮佐]$/, command: "left" },
  // yòu/yǒu/yóu — 右的同音字
  { patterns: /^[又有由油友幼游优忧悠尤犹邮铀柚佑诱釉鼬莠]$/, command: "right" },
  // Longer misrecognitions with filler words (anchored to avoid conflicts)
  { patterns: /^[尚伤赏商][啊吧呢嘛哦呀]?$|上[啊吧呢嘛哦呀]/, command: "up" },
  { patterns: /^[吓夏瞎虾侠][啊吧呢嘛哦呀]?$|下[啊吧呢嘛哦呀]/, command: "down" },
  { patterns: /左[啊吧呢嘛哦呀]/, command: "left" },
  { patterns: /^[又有由][啊吧呢嘛哦呀]?$|右[啊吧呢嘛哦呀]/, command: "right" },
];

// Pinyin romanization matching (speech API sometimes returns pinyin)
const PINYIN_PATTERNS: { patterns: RegExp; command: VoiceCommand }[] = [
  { patterns: /^sh[aà]ng$/i, command: "up" },
  { patterns: /^xi[aà]$/i, command: "down" },
  { patterns: /^zu[oǒ]$/i, command: "left" },
  { patterns: /^y[oò]u$/i, command: "right" },
  { patterns: /^q[uǔ]xi[aā]o$/i, command: "cancel" },
  { patterns: /^qu[eè]r[eè]n$/i, command: "confirm" },
];

function matchBuiltinCommand(text: string): VoiceCommand {
  const cleaned = text.trim();

  // 1. Exact match
  for (const { patterns, command } of EXACT_PATTERNS) {
    if (patterns.test(cleaned)) return command;
  }
  // 2. Homophone match
  for (const { patterns, command } of HOMOPHONES) {
    if (patterns.test(cleaned)) return command;
  }
  // 3. Pinyin romanization match
  for (const { patterns, command } of PINYIN_PATTERNS) {
    if (patterns.test(cleaned)) return command;
  }
  // 4. Fuzzy contain
  if (/上/.test(cleaned)) return "up";
  if (/下/.test(cleaned)) return "down";
  if (/左/.test(cleaned)) return "left";
  if (/右/.test(cleaned)) return "right";
  if (/取消|关闭|清除/.test(cleaned)) return "cancel";
  if (/确认|完成/.test(cleaned)) return "confirm";
  if (/总结|统计|汇总|报告|播报|念|读|数[一数]|清点|盘点|几种|多少/.test(cleaned)) return "summary";
  if (/还在|我在|在的|继续/.test(cleaned)) return "still_here";
  if (/\bup\b/i.test(cleaned)) return "up";
  if (/\bdown\b/i.test(cleaned)) return "down";
  if (/\bleft\b/i.test(cleaned)) return "left";
  if (/\bright\b/i.test(cleaned)) return "right";
  if (/\bsummary\b/i.test(cleaned)) return "summary";
  return "unknown";
}

export function voiceUnknownFeedback(transcript: string): string {
  return transcript;
}

/** Try matching across all alternatives, return first match */
export function parseVoiceCommand(text: string, confidence = 1): VoiceCommandResult {
  const cleaned = text.trim();
  const goto = cleaned.match(/^(?:go to|goto)\s+(\d+)[,\s]+(\d+)$/i)
    ?? cleaned.match(/^column\s+(\d+)\s+row\s+(\d+)$/i)
    ?? cleaned.match(/^(?:定位到?)?第?(\d+)列第?(\d+)行$/);
  if (goto) return { command: "goto", raw: cleaned, confidence, gotoCol: Number(goto[1]), gotoRow: Number(goto[2]) };
  return { command: matchBuiltinCommand(cleaned), raw: cleaned, confidence };
}

export function resolveEnhancedVoiceCommand(
  regexResult: VoiceCommandResult,
  enhancedResult: VoiceEnhancementResult,
): VoiceCommandResult {
  if (enhancedResult.command === "unknown") return regexResult;
  return {
    command: enhancedResult.command,
    raw: regexResult.raw,
    confidence: regexResult.confidence,
    repeat: enhancedResult.repeat,
    gotoCol: enhancedResult.gotoCol,
    gotoRow: enhancedResult.gotoRow,
  };
}

function matchFromAlternatives(result: SpeechRecognitionResult): VoiceCommandResult {
  for (let i = 0; i < result.length; i++) {
    const alt = result[i];
    const parsed = parseVoiceCommand(alt.transcript, alt.confidence);
    if (parsed.command !== "unknown") return parsed;
  }
  return { command: "unknown", raw: result[0].transcript.trim(), confidence: result[0].confidence };
}

// ─── Hook ────────────────────────────────────────────────────────

interface UseVoiceControlOptions {
  lang?: string;
  useLLM?: boolean;
  onCommand: (result: VoiceCommandResult) => void;
}

export function beginVoiceLifecycle(
  mountedRef: { current: boolean },
  stopWithoutState: () => void,
): () => void {
  mountedRef.current = true;
  return () => {
    mountedRef.current = false;
    stopWithoutState();
  };
}

export function useVoiceControl({ lang = i18n.language === "zh-CN" ? "zh-CN" : "en-US", useLLM = false, onCommand }: UseVoiceControlOptions) {
  const [isListening, setIsListening] = useState(false);
  const [lastResult, setLastResult] = useState<VoiceCommandResult | null>(null);
  const [isSupported] = useState(() => typeof window !== "undefined" && ("SpeechRecognition" in window || "webkitSpeechRecognition" in window));
  const recognitionRef = useRef<SpeechRecognition | null>(null);
  const onCommandRef = useRef(onCommand);
  const useLLMRef = useRef(useLLM);
  const mountedRef = useRef(true);
  const sessionGenerationRef = useRef(0);
  onCommandRef.current = onCommand;
  useLLMRef.current = useLLM;

  const idleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const promptTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const IDLE_TIMEOUT = 10 * 60 * 1000;
  const PROMPT_TIMEOUT = 2 * 60 * 1000;

  const clearTimers = useCallback(() => {
    if (idleTimerRef.current) clearTimeout(idleTimerRef.current);
    if (promptTimerRef.current) clearTimeout(promptTimerRef.current);
    idleTimerRef.current = null;
    promptTimerRef.current = null;
  }, []);

  const stopInternal = useCallback((updateState: boolean) => {
    sessionGenerationRef.current += 1;
    clearTimers();
    const recognition = recognitionRef.current;
    recognitionRef.current = null;
    recognition?.abort();
    if (updateState && mountedRef.current) {
      setIsListening(false);
      setLastResult(null);
    }
  }, [clearTimers]);

  const resetIdleTimer = useCallback(() => {
    clearTimers();
    idleTimerRef.current = setTimeout(() => {
      if (!mountedRef.current || !recognitionRef.current) return;
      if ("speechSynthesis" in window) {
        window.speechSynthesis.cancel();
        const utterance = new SpeechSynthesisUtterance(i18n.t("voice.stillThere"));
        utterance.lang = i18n.language === "zh-CN" ? "zh-CN" : "en-US";
        utterance.rate = 1.2;
        utterance.volume = 0.9;
        window.speechSynthesis.speak(utterance);
      }
      promptTimerRef.current = setTimeout(() => stopInternal(true), PROMPT_TIMEOUT);
    }, IDLE_TIMEOUT);
  }, [clearTimers, stopInternal]);

  const start = useCallback(() => {
    if (!isSupported || !mountedRef.current) return;
    stopInternal(false);
    const generation = ++sessionGenerationRef.current;
    const SpeechRecognition = window.SpeechRecognition || (window as unknown as { webkitSpeechRecognition: typeof window.SpeechRecognition }).webkitSpeechRecognition;
    const recognition = new SpeechRecognition();
    recognition.lang = lang;
    recognition.continuous = true;
    recognition.interimResults = false;
    recognition.maxAlternatives = 3;

    const isCurrent = () => mountedRef.current
      && recognitionRef.current === recognition
      && sessionGenerationRef.current === generation;

    recognition.onresult = (event: SpeechRecognitionEvent) => {
      const last = event.results[event.results.length - 1];
      if (!last.isFinal || !isCurrent()) return;
      const regexResult = matchFromAlternatives(last);
      const transcript = regexResult.raw;
      const voiceEnhancement = getPlatformServices().voiceEnhancement;
      if (useLLMRef.current && getPlatformServices().capabilities.ai && voiceEnhancement) {
        void Promise.race([
          voiceEnhancement.interpret(transcript),
          new Promise<VoiceEnhancementResult>((resolve) => setTimeout(() => resolve({ command: "unknown", enhanced: false }), 5000)),
        ]).then((llmResult) => {
          if (!isCurrent()) return;
          const finalResult = resolveEnhancedVoiceCommand(regexResult, llmResult);
          setLastResult(finalResult);
          onCommandRef.current(finalResult);
          if (finalResult.command !== "unknown") resetIdleTimer();
        });
        return;
      }
      setLastResult(regexResult);
      onCommandRef.current(regexResult);
      if (regexResult.command !== "unknown") resetIdleTimer();
    };

    recognition.onerror = (event) => {
      if (!isCurrent() || event.error === "no-speech" || event.error === "aborted") return;
      if (event.error === "not-allowed" || event.error === "service-not-allowed" || event.error === "audio-capture") {
        stopInternal(true);
        return;
      }
      console.warn("Voice recognition error:", event.error);
    };
    recognition.onend = () => {
      if (!isCurrent()) return;
      try { recognition.start(); } catch { /* already running */ }
    };
    recognitionRef.current = recognition;
    recognition.start();
    setIsListening(true);
    resetIdleTimer();
  }, [isSupported, lang, resetIdleTimer, stopInternal]);

  const stop = useCallback(() => stopInternal(true), [stopInternal]);
  const toggle = useCallback(() => isListening ? stop() : start(), [isListening, start, stop]);

  useEffect(() => {
    if (!isListening) return;
    start();
  }, [lang]);

  useEffect(
    () => beginVoiceLifecycle(mountedRef, () => stopInternal(false)),
    [stopInternal],
  );

  return { isListening, isSupported, lastResult, start, stop, toggle };
}
