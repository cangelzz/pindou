import { readFileSync, readdirSync } from "node:fs";
import { extname, join, relative } from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import en from "./locales/en.json";
import zhCN from "./locales/zh-CN.json";

const srcRoot = join(process.cwd(), "src");
const productionRoots = [
  srcRoot,
  join(process.cwd(), "platforms", "vscode", "webview"),
  join(process.cwd(), "platforms", "android"),
  join(process.cwd(), "platforms", "ios"),
];
const ignored = (file: string) => /(?:\.test\.|\.spec\.|\.fixture\.|(?:^|\/)(?:tests|tests-e2e|e2e|dist|resources)\/|data\/mard221\.ts$|(?:^|\/)manifest[^/]*\.(?:ts|js)$)/.test(file.replaceAll("\\", "/"));
function sourceFiles(dir = srcRoot): string[] { return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => entry.isDirectory() ? sourceFiles(join(dir, entry.name)) : [join(dir, entry.name)]).filter((file) => [".ts", ".tsx", ".js", ".jsx"].includes(extname(file)) && !ignored(relative(process.cwd(), file))); }
function productionFiles(): string[] { return productionRoots.flatMap((root) => sourceFiles(root)); }
function flatten(value: unknown, prefix = ""): string[] { return typeof value === "string" ? [prefix] : Object.entries(value as Record<string, unknown>).flatMap(([key, child]) => flatten(child, prefix ? `${prefix}.${key}` : key)); }

const exactAllowedLiterals = new Set(["PindouVerse", "GitHub", "MARD", "__overrides__", "🌐 中文", "🌐 EN", "26", "78", "(E)", "(Ctrl+Z)", "(Ctrl+Y)", "RGB(", "Ctrl+O", "Ctrl+S", "Ctrl+Shift+S", "EN", "BETA", "Beta", "PNG", "JPEG", "px", "x", "i", "R", "G", "B", ",\r\n                  G", ",\r\n                  B", "bbox:", "px)", "CIELAB ΔE (", "Euclidean (RGB)", "#RRGGBB", "https://...", "palette", "stats", "layers", "select", "mirror", "floating", "moveToLayer", "zh-CN", "en-US", "prompt", "crop", "loupe"]);

describe("shared UI hardcoded audit", () => {
  it("does not embed functional Han text in shared production UI", () => {
    const findings: string[] = [];
    for (const file of productionFiles()) {
      const lines = readFileSync(file, "utf8").split(/\r?\n/);
      lines.forEach((line, index) => {
        if (!/\p{Script=Han}/u.test(line)) return;
        if (file.endsWith("LanguageSwitch.tsx") && line.includes('"🌐 中文"')) return;
        if (file.endsWith("useVoiceControl.ts") && (/patterns:\s*\//.test(line) || /if \(\//.test(line) || /cleaned\.match\(\//.test(line))) return;
        if (file.endsWith("voiceEnhancement.ts") && index >= 5 && index <= 14) return;
        const source = readFileSync(file, "utf8");
        const ast = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
        const position = source.split(/\r?\n/).slice(0, index).reduce((sum, value) => sum + value.length + 1, 0);
        const target = position + Math.max(0, line.search(/\p{Script=Han}/u));
        let token: ts.Node = ast;
        const findToken = (node: ts.Node) => { if (target < node.getFullStart() || target >= node.getEnd()) return; token = node; ts.forEachChild(node, findToken); };
        findToken(ast);
        const hasAncestor = (kind: ts.SyntaxKind) => { let parent = token.parent; while (parent) { if (parent.kind === kind) return true; parent = parent.parent; } return false; };
        if (ts.isRegularExpressionLiteral(token) || hasAncestor(ts.SyntaxKind.RegularExpressionLiteral)) return;
        if (hasAncestor(ts.SyntaxKind.TemplateExpression)) return;
        if (!ts.isStringLiteralLike(token) && !ts.isJsxText(token)) return;
        findings.push(`${relative(srcRoot, file)}:${index + 1}: ${line.trim()}`);
      });
    }
    expect(findings, findings.join("\n")).toEqual([]);
  });

  function auditLiteralUi(files: string[]): string[] {
    const findings: string[] = [];
    const seen = new Set<string>();
    for (const file of files) {
      const source = readFileSync(file, "utf8");
      const ast = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, file.endsWith("x") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
      const report = (node: ts.Node, text: string) => { const value = text.trim(); if (!value || exactAllowedLiterals.has(value) || /^[×▶◀+\-—–…✓●☁️\s]+$/u.test(value)) return; const id = `${file}:${node.getStart(ast)}:${value}`; if (seen.has(id)) return; seen.add(id); const line = ast.getLineAndCharacterOfPosition(node.getStart(ast)).line + 1; findings.push(`${relative(srcRoot, file)}:${line}: ${value}`); };
      const literalText = (node: ts.Node): string | undefined => {
        if (ts.isStringLiteralLike(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text;
        return undefined;
      };
      const reportUiExpression = (node: ts.Expression) => {
        if (ts.isAsExpression(node) || ts.isTypeAssertionExpression(node) || ts.isSatisfiesExpression(node) || ts.isNonNullExpression(node)) {
          reportUiExpression(node.expression);
          return;
        }
        const text = literalText(node);
        if (text && /[A-Za-z\p{Script=Han}]/u.test(text)) report(node, text);
        if (ts.isCallExpression(node)) {
          const callee = node.expression;
          if ((ts.isIdentifier(callee) && callee.text === "t")
            || (ts.isPropertyAccessExpression(callee) && callee.name.text === "t")
            || (ts.isPropertyAccessExpression(callee) && callee.name.text === "current" && ts.isIdentifier(callee.expression) && callee.expression.text === "tRef")) return;
          node.arguments.forEach(reportUiExpression);
        } else if (ts.isTemplateExpression(node)) {
          if (/[A-Za-z\p{Script=Han}]/u.test(node.head.text)) report(node.head, node.head.text);
          for (const span of node.templateSpans) {
            reportUiExpression(span.expression);
            if (/[A-Za-z\p{Script=Han}]/u.test(span.literal.text)) report(span.literal, span.literal.text);
          }
        } else if (ts.isConditionalExpression(node)) {
          reportUiExpression(node.whenTrue);
          reportUiExpression(node.whenFalse);
        } else if (ts.isBinaryExpression(node)) {
          reportUiExpression(node.left);
          reportUiExpression(node.right);
        } else if (ts.isParenthesizedExpression(node)) {
          reportUiExpression(node.expression);
        } else if (ts.isArrayLiteralExpression(node)) {
          node.elements.forEach((element) => { if (ts.isExpression(element)) reportUiExpression(element); });
        } else if (ts.isObjectLiteralExpression(node)) {
          node.properties.forEach((property) => {
            if (ts.isPropertyAssignment(property)) reportUiExpression(property.initializer);
            else if (ts.isShorthandPropertyAssignment(property) && property.objectAssignmentInitializer) reportUiExpression(property.objectAssignmentInitializer);
            else if (ts.isSpreadAssignment(property)) reportUiExpression(property.expression);
          });
        }
      };
      const visit = (node: ts.Node) => {
        if (ts.isJsxText(node) && /[A-Za-z\p{Script=Han}]/u.test(node.text)) report(node, node.text);
        if (ts.isJsxExpression(node) && node.expression && !ts.isJsxAttribute(node.parent)) reportUiExpression(node.expression);
        if (ts.isJsxAttribute(node) && ["alt", "value", "label", "title", "aria-label", "placeholder", "message", "description", "helperText", "caption"].includes(node.name.getText(ast)) && node.initializer) {
          if (ts.isStringLiteral(node.initializer)) report(node, node.initializer.text);
          else if (ts.isJsxExpression(node.initializer) && node.initializer.expression) reportUiExpression(node.initializer.expression);
        }
        if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && ["appAlert", "appConfirm", "appPrompt", "setError", "setSuccess", "setAutoDetectResult", "setReimportError", "setRedetectError"].includes(node.expression.text) && node.arguments[0]) {
          node.arguments.forEach(reportUiExpression);
          if (node.arguments[0].getText(ast).includes("String(")) report(node, node.arguments[0].getText(ast));
        }
        if (ts.isBinaryExpression(node)) {
          const assignmentOperators = new Set([
            ts.SyntaxKind.EqualsToken, ts.SyntaxKind.PlusEqualsToken,
            ts.SyntaxKind.BarBarEqualsToken, ts.SyntaxKind.AmpersandAmpersandEqualsToken, ts.SyntaxKind.QuestionQuestionEqualsToken,
          ]);
          const sink = ts.isPropertyAccessExpression(node.left) ? node.left.name.text
            : ts.isElementAccessExpression(node.left) && node.left.argumentExpression && ts.isStringLiteralLike(node.left.argumentExpression) ? node.left.argumentExpression.text
              : undefined;
          if (sink && assignmentOperators.has(node.operatorToken.kind) && ["textContent", "innerText", "innerHTML"].includes(sink)) reportUiExpression(node.right);
        }
        if (ts.isNewExpression(node) && node.expression.getText(ast) === "Error" && node.arguments?.[0] && ts.isStringLiteralLike(node.arguments[0]) && /\p{Script=Han}/u.test(node.arguments[0].text)) report(node, node.arguments[0].text);
        if (ts.isPropertyAssignment(node) && ["label", "title", "placeholder", "message"].includes(node.name.getText(ast))) {
          let parent: ts.Node | undefined = node.parent;
          while (parent && !ts.isJsxExpression(parent)) parent = parent.parent;
          if (parent) reportUiExpression(node.initializer);
        }
        if (ts.isPropertyAssignment(node) && node.name.getText(ast) === "name" && ts.isStringLiteralLike(node.initializer) && /image/i.test(node.initializer.text)) report(node, node.initializer.text);
        ts.forEachChild(node, visit);
      };
      visit(ast);
    }
    return findings;
  }

  it("flags literal JSX text and user-facing string attributes/calls", () => {
    const findings = auditLiteralUi(productionFiles());
    expect(findings, findings.join("\n")).toEqual([]);
  });

  it("covers JSX expression strings, templates, and user-facing attributes", () => {
    const fixture = join(srcRoot, "i18n", "hardcodedUi.fixture.tsx");
    expect(auditLiteralUi([fixture]).map((finding) => finding.replace(/^.*?:\d+: /, ""))).toEqual([
      "literal text content", "literal inner text", "literal inner html", "中文 HTML", "element access assignment", "logical assignment", "wrapped assignment", "satisfies assignment", "中文语句标题", "中文语句替换", "expression text", "template text", "中文头部", "中文尾部", "conditional text", "alternate condition", "alternate text", "中文属性", "中文尾部", "object label", "literal value", "中文调用", "中文尾部",
      "literal label", "literal title", "literal placeholder", "literal message", "中文描述", "中文描述替换", "中文替换", "concat", "中文连接", "中文对象", "中文对象替换", "中文标题", "中文标题替换",
    ]);
  });
});

describe("translation key usage", () => {
  it("keeps locale parity and rejects unused static keys", () => {
    const enKeys = flatten(en).sort(), zhKeys = flatten(zhCN).sort();
    expect(enKeys).toEqual(zhKeys);
    const source = sourceFiles().map((file) => readFileSync(file, "utf8")).join("\n");
    const referenced = new Set([...source.matchAll(/(?:\bt|sharedI18n\.t|getFixedT\([^)]*\))\(\s*["']([^"']+)["']/g)].map((match) => match[1]));
    const dynamicExact = [
      "errors.saveProject", "errors.saveAs", "github.cancel", "github.close", "export.exporting", "export.button",
      "palette.clearHighlight", "palette.highlight", "compare.hideHighlights", "compare.showHighlights",
      "selection.menu.discard", "selection.menu.deselect", "import.blueprint.fromMetadata", "import.blueprint.fromImage",
      "import.blueprint.redetectHint", "import.blueprint.boxUnchanged", "import.blueprint.redetecting", "import.blueprint.redetect",
      "import.blueprint.reimportHint", "import.blueprint.unchanged", "import.blueprint.reimporting", "import.blueprint.reimport",
      "import.image.selectSample", "import.image.addReference", "import.image.adjust.none", "import.image.adjust.changed",
      "import.image.changeTargetTitle", "import.image.chooseTarget", "cloud.sync", "cloud.uploadCurrent", "cloud.loading", "cloud.refresh",
      "status.saved", "status.autosaved", "github.status.authorized", "github.status.waiting", "github.status.slowDown", "github.status.expired", "github.status.denied", "github.status.error", "github.status.retrying",
      "import.blueprint.errors.grid-not-found", "import.blueprint.errors.geometry-not-recovered", "import.blueprint.errors.grid-too-small", "import.blueprint.errors.unknown",
      "import.image.errors.invalid-file", "import.image.errors.read-failed", "import.image.errors.decode-failed", "import.image.errors.canvas-unavailable", "import.image.errors.unknown",
    ];
    for (const key of dynamicExact) referenced.add(key);
    for (const stage of ["loading-image", "detecting-grid", "sampling-colors", "matching-colors", "finalizing"]) referenced.add(`import.blueprint.progress.${stage}`);
    for (const item of ["blueprint", "mirrorBlueprint", "preview", "mirrorPreview"]) { referenced.add(`export.items.${item}`); referenced.add(`export.errors.${item}`); }
    for (const key of ["exposure", "contrast", "saturation", "vibrance", "temperature", "tint"]) referenced.add(`import.image.adjust.${key}`);
    for (const id of ["mard221", "all", "solid", "morandi", "pearl", "special"]) { referenced.add(`palette.groups.${id}`); referenced.add(`import.image.colorGroups.${id}`); }
    for (const key of ["select", "wand", "pen", "fill", "eyedropper", "pan", "line", "rect", "circle", "eraserCell", "eraserFill"]) referenced.add(`tools.${key}`);
    const explicitlyRetained = new Set(["brand", "beta.title", "canvas.eyedropperEmpty", "canvas.eyedropperError", "canvas.title", "canvas.zoom", "cloud.title", "dialogs.title", "errors.title", "errors.unknown", "errors.startup", "export.title", "github.title", "import.title", "language.name", "language.english", "language.simplifiedChinese", "language.saveError", "language.switchError", "language.title", "layers.hiddenMessage", "layers.hiddenTitle", "menu.title", "project.title", "selection.guard.message", "selection.guard.title", "snapshots.title", "status.loading", "status.ready", "status.saving", "status.title", "tools.title", "voice.stillThere", "voice.voiceOff", "voice.voiceOn"]);
    for (const key of ["up", "down", "left", "right", "cancel", "confirm", "summary", "stillHere", "goto"]) explicitlyRetained.add(`voice.commands.${key}`);
    for (const key of ["A", "B", "C", "D", "E", "F"]) explicitlyRetained.add(`voice.presets.${key}`);
    for (const key of ["colorCount", "continue", "edge", "empty", "goto", "join", "outOfRange", "repeat", "selectGrid", "separator", "summary"]) explicitlyRetained.add(`voice.speech.${key}`);
    const unused = enKeys.filter((key) => !referenced.has(key) && !explicitlyRetained.has(key));
    expect(unused, `Unused translation keys:\n${unused.join("\n")}`).toEqual([]);
  });
});
