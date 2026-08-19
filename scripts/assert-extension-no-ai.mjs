import { readFileSync, readdirSync, statSync } from "node:fs";
import { extname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const defaultRoot = fileURLToPath(new URL("../platforms/extension/dist/", import.meta.url));
const forbidden = [
  "__pindouExtensionTest", "pindou:test", "Store action is not available to E2E",
  "github_models_chat", "models.inference.ai.azure.com", "__TAURI", "@tauri", "Tauri",
  "AI语音", "AI 语音增强", "matchCommand", "fromLLM", "[AI]", "aiVoice", "client_secret",
  "@anthropic-ai/sdk", "api.anthropic.com", "anthropic-version",
  "@openai/", "api.openai.com", "@google/generative-ai",
];
const textExtensions = new Set([".js", ".mjs", ".html", ".json", ".css", ".txt", ".svg", ".xml"]);
const binaryExtensions = new Set([".png", ".jpg", ".jpeg", ".gif", ".webp", ".ico", ".woff", ".woff2", ".ttf", ".otf"]);
const forbiddenExtensions = new Set([".ts", ".tsx"]);

function files(dir) {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? files(path) : [path];
  });
}

function decodeText(bytes, file) {
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return bytes.subarray(2).toString("utf16le");
  if (bytes[0] === 0xfe && bytes[1] === 0xff) {
    const swapped = Buffer.alloc(bytes.length - 2);
    for (let index = 2; index + 1 < bytes.length; index += 2) {
      swapped[index - 2] = bytes[index + 1]; swapped[index - 1] = bytes[index];
    }
    return swapped.toString("utf16le");
  }
  if (bytes.includes(0)) throw new Error(`${file} contains NUL bytes in a known text artifact`);
  const offset = bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf ? 3 : 0;
  return bytes.subarray(offset).toString("utf8");
}

export function scanExtensionArtifacts(root = defaultRoot) {
  for (const file of files(root)) {
    const lower = file.toLowerCase();
    const extension = extname(lower);
    if (extension === ".map") throw new Error(`${file} contains forbidden source map artifact`);
    if (forbiddenExtensions.has(extension) || /(?:\.spec|\.test)\.[^.]+$/.test(lower)) throw new Error(`${file} contains forbidden source or test artifact`);
    if (binaryExtensions.has(extension)) continue;
    if (!textExtensions.has(extension)) throw new Error(`${file} has an unknown extension and cannot be safely scanned`);
    const text = decodeText(readFileSync(file), file);
    for (const token of forbidden) if (text.includes(token)) throw new Error(`${file} contains forbidden AI token: ${token}`);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  scanExtensionArtifacts();
  console.log("Extension bundle contains no AI command or endpoint strings.");
}
