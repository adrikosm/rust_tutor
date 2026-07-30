import type * as Monaco from "monaco-editor/esm/vs/editor/editor.api.js";
import EditorWorker from "monaco-editor/esm/vs/editor/editor.worker?worker";
import "monaco-editor/min/vs/editor/editor.main.css";
import { useEffect, useRef } from "react";
import type { EvaluationResult } from "../../lib/api-contract";
import { completeRust } from "../../lib/service-client";

(
  globalThis as typeof globalThis & { MonacoEnvironment?: { getWorker: () => Worker } }
).MonacoEnvironment = { getWorker: () => new EditorWorker() };

type Diagnostic = EvaluationResult["diagnostics"][number];

const LIGHT_EDITOR_THEME = "rust-tutor-light";
const DARK_EDITOR_THEME = "rust-tutor-dark";

function defineRustTutorThemes(api: typeof Monaco) {
  api.editor.defineTheme(LIGHT_EDITOR_THEME, {
    base: "vs-dark",
    inherit: true,
    rules: [
      { token: "comment", foreground: "8B9C88", fontStyle: "italic" },
      { token: "keyword", foreground: "E5A13B", fontStyle: "bold" },
      { token: "number", foreground: "76D1C6" },
      { token: "string", foreground: "A3BD7E" },
      { token: "identifier", foreground: "E7E3D3" },
    ],
    colors: {
      "editor.background": "#1d2620",
      "editor.foreground": "#e7e3d3",
      "editorLineNumber.foreground": "#6f806f",
      "editorLineNumber.activeForeground": "#e5a13b",
      "editorCursor.foreground": "#0b6481",
      "editor.selectionBackground": "#33463a",
      "editor.inactiveSelectionBackground": "#26372d",
      "editor.lineHighlightBackground": "#243029",
      "editorIndentGuide.background1": "#33463a",
      "editorIndentGuide.activeBackground1": "#687a70",
      "editorWhitespace.foreground": "#33463a",
      "editorError.foreground": "#f09a77",
      "editorWarning.foreground": "#e5a13b",
      "editorInfo.foreground": "#76d1c6",
      "editorWidget.background": "#18241e",
      "editorWidget.border": "#687a70",
      "input.background": "#203027",
      "input.foreground": "#f2ede1",
      "input.border": "#687a70",
      focusBorder: "#0b6481",
    },
  });

  api.editor.defineTheme(DARK_EDITOR_THEME, {
    base: "vs-dark",
    inherit: true,
    rules: [
      { token: "comment", foreground: "8B9C88", fontStyle: "italic" },
      { token: "keyword", foreground: "E5A13B", fontStyle: "bold" },
      { token: "number", foreground: "76D1C6" },
      { token: "string", foreground: "A3BD7E" },
      { token: "identifier", foreground: "E7E3D3" },
    ],
    colors: {
      "editor.background": "#1d2620",
      "editor.foreground": "#e7e3d3",
      "editorLineNumber.foreground": "#6f806f",
      "editorLineNumber.activeForeground": "#e5a13b",
      "editorCursor.foreground": "#f2ede1",
      "editor.selectionBackground": "#33463a",
      "editor.inactiveSelectionBackground": "#26372d",
      "editor.lineHighlightBackground": "#243029",
      "editorIndentGuide.background1": "#33463a",
      "editorIndentGuide.activeBackground1": "#687a70",
      "editorWhitespace.foreground": "#33463a",
      "editorError.foreground": "#f09a77",
      "editorWarning.foreground": "#e5a13b",
      "editorInfo.foreground": "#76d1c6",
      "editorWidget.background": "#18241e",
      "editorWidget.border": "#687a70",
      "input.background": "#203027",
      "input.foreground": "#f2ede1",
      "input.border": "#687a70",
      focusBorder: "#f3b34c",
    },
  });
}

function editorTheme(forcedColors: boolean) {
  const dark = document.documentElement.dataset.theme === "dark";
  if (forcedColors) return dark ? "hc-black" : "hc-light";
  return dark ? DARK_EDITOR_THEME : LIGHT_EDITOR_THEME;
}

export function rustColumnToUtf16(line: string, oneBasedColumn: number) {
  return (
    Array.from(line)
      .slice(0, Math.max(0, oneBasedColumn - 1))
      .join("").length + 1
  );
}

export function MonacoSourceEditor({
  exerciseId,
  filePath,
  source,
  sourceVersion,
  autocompleteEnabled,
  diagnostics,
  onChange,
}: {
  exerciseId: string;
  filePath?: string;
  source: string;
  sourceVersion: number;
  autocompleteEnabled: boolean;
  diagnostics: Diagnostic[];
  onChange: (source: string) => void;
}) {
  const host = useRef<HTMLDivElement>(null);
  const editor = useRef<Monaco.editor.IStandaloneCodeEditor | undefined>(undefined);
  const monaco = useRef<typeof Monaco | undefined>(undefined);
  const changingFromProps = useRef(false);
  const current = useRef({
    exerciseId,
    filePath,
    source,
    sourceVersion,
    autocompleteEnabled,
    onChange,
  });
  current.current = { exerciseId, filePath, source, sourceVersion, autocompleteEnabled, onChange };

  useEffect(() => {
    let disposed = false;
    let completionProvider: Monaco.IDisposable | undefined;
    let changeListener: Monaco.IDisposable | undefined;
    let themeObserver: MutationObserver | undefined;
    let forcedColors: MediaQueryList | undefined;
    let handleThemeChange: (() => void) | undefined;
    void import("monaco-editor/esm/vs/editor/editor.api.js").then((api) => {
      if (disposed || !host.current) return;
      monaco.current = api;
      defineRustTutorThemes(api);
      forcedColors = window.matchMedia("(forced-colors: active)");
      handleThemeChange = () => api.editor.setTheme(editorTheme(forcedColors?.matches ?? false));
      themeObserver = new MutationObserver(handleThemeChange);
      themeObserver.observe(document.documentElement, {
        attributes: true,
        attributeFilter: ["data-theme"],
      });
      forcedColors.addEventListener("change", handleThemeChange);
      if (!api.languages.getLanguages().some((language) => language.id === "rust-tutor")) {
        api.languages.register({ id: "rust-tutor", extensions: [".rs"] });
        api.languages.setMonarchTokensProvider("rust-tutor", {
          keywords: [
            "as",
            "async",
            "await",
            "break",
            "const",
            "continue",
            "crate",
            "else",
            "enum",
            "fn",
            "for",
            "if",
            "impl",
            "in",
            "let",
            "loop",
            "match",
            "mod",
            "move",
            "mut",
            "pub",
            "ref",
            "return",
            "self",
            "Self",
            "static",
            "struct",
            "super",
            "trait",
            "type",
            "unsafe",
            "use",
            "where",
            "while",
          ],
          tokenizer: {
            root: [
              [/\/\/.*$/, "comment"],
              [/"([^"\\]|\\.)*"/, "string"],
              [/[a-zA-Z_][\w]*/, { cases: { "@keywords": "keyword", "@default": "identifier" } }],
              [/\d+/, "number"],
            ],
          },
        });
      }
      const model = api.editor.createModel(current.current.source, "rust-tutor");
      editor.current = api.editor.create(host.current, {
        model,
        theme: editorTheme(forcedColors.matches),
        autoDetectHighContrast: true,
        automaticLayout: true,
        minimap: { enabled: false },
        fontFamily:
          '"JetBrains Mono", "SFMono-Regular", Menlo, Consolas, "Liberation Mono", monospace',
        fontSize: 14,
        lineHeight: 22,
        padding: { top: 12, bottom: 12 },
        scrollBeyondLastLine: false,
        quickSuggestions: { other: true, comments: false, strings: false },
        suggestOnTriggerCharacters: true,
        tabFocusMode: false,
        insertSpaces: true,
        tabSize: 2,
        detectIndentation: false,
        wordWrap: "on",
        ariaLabel: `${current.current.filePath ?? "src/main.rs"} code editor`,
      });
      changeListener = editor.current.onDidChangeModelContent(() => {
        if (!changingFromProps.current) current.current.onChange(model.getValue());
      });
      completionProvider = api.languages.registerCompletionItemProvider("rust-tutor", {
        triggerCharacters: ["."],
        provideCompletionItems: async (model, position, _context, token) => {
          if (!current.current.autocompleteEnabled) return { suggestions: [] };
          const result = await completeRust({
            exerciseId: current.current.exerciseId,
            source: model.getValue(),
            version: current.current.sourceVersion,
            line: position.lineNumber - 1,
            character: position.column - 1,
          });
          if (token.isCancellationRequested) return { suggestions: [] };
          const word = model.getWordUntilPosition(position);
          const range = new api.Range(
            position.lineNumber,
            word.startColumn,
            position.lineNumber,
            word.endColumn,
          );
          return {
            suggestions: result.items.map((item) => ({
              label: item.label,
              kind: item.kind ?? api.languages.CompletionItemKind.Text,
              detail: item.detail ?? undefined,
              documentation: item.documentation ?? undefined,
              insertText: item.insertText ?? item.label,
              insertTextRules:
                item.insertTextFormat === 2
                  ? api.languages.CompletionItemInsertTextRule.InsertAsSnippet
                  : undefined,
              range,
            })),
          };
        },
      });
    });
    return () => {
      disposed = true;
      themeObserver?.disconnect();
      if (forcedColors && handleThemeChange) {
        forcedColors.removeEventListener("change", handleThemeChange);
      }
      completionProvider?.dispose();
      changeListener?.dispose();
      editor.current?.getModel()?.dispose();
      editor.current?.dispose();
      editor.current = undefined;
    };
  }, []);

  useEffect(() => {
    const model = editor.current?.getModel();
    if (!model || model.getValue() === source) return;
    changingFromProps.current = true;
    model.setValue(source);
    changingFromProps.current = false;
  }, [source]);

  useEffect(() => {
    const api = monaco.current;
    const model = editor.current?.getModel();
    if (!api || !model) return;
    const lines = source.split("\n");
    const markers = diagnostics.flatMap((diagnostic) =>
      diagnostic.spans
        .filter((span) => span.file === (filePath ?? "src/main.rs"))
        .map((span) => ({
          severity:
            diagnostic.severity === "error"
              ? api.MarkerSeverity.Error
              : diagnostic.severity === "warning"
                ? api.MarkerSeverity.Warning
                : api.MarkerSeverity.Info,
          message: `${diagnostic.code ?? diagnostic.severity}: ${diagnostic.message}`,
          startLineNumber: span.lineStart,
          endLineNumber: span.lineEnd,
          startColumn: rustColumnToUtf16(lines[span.lineStart - 1] ?? "", span.columnStart),
          endColumn: rustColumnToUtf16(lines[span.lineEnd - 1] ?? "", span.columnEnd),
          relatedInformation: diagnostic.spans
            .filter((related) => !related.primary && related.file === (filePath ?? "src/main.rs"))
            .map((related) => ({
              resource: model.uri,
              message: related.label ?? diagnostic.message,
              startLineNumber: related.lineStart,
              endLineNumber: related.lineEnd,
              startColumn: rustColumnToUtf16(
                lines[related.lineStart - 1] ?? "",
                related.columnStart,
              ),
              endColumn: rustColumnToUtf16(lines[related.lineEnd - 1] ?? "", related.columnEnd),
            })),
        })),
    );
    api.editor.setModelMarkers(model, "rust-tutor", markers);
  }, [diagnostics, filePath, source]);

  return <div className="monaco-source-editor" ref={host} />;
}
