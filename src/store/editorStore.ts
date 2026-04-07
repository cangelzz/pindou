import { create } from "zustand";
import type {
  CanvasCell,
  CanvasData,
  CanvasSize,
  EditorTool,
  GridConfig,
  HistoryAction,
} from "../types";

interface EditorState {
  // Canvas data
  canvasSize: CanvasSize;
  canvasData: CanvasData;
  gridConfig: GridConfig;

  // View state
  cellSize: number; // pixels per cell on screen
  offsetX: number;
  offsetY: number;
  zoom: number;

  // Tool state
  currentTool: EditorTool;
  selectedColorIndex: number | null;

  // History
  undoStack: HistoryAction[];
  redoStack: HistoryAction[];

  // File state
  projectPath: string | null;
  isDirty: boolean;

  // Actions
  newCanvas: (width: number, height: number) => void;
  setCell: (row: number, col: number, colorIndex: number | null) => void;
  batchSetCells: (entries: { row: number; col: number; colorIndex: number | null }[]) => void;
  setTool: (tool: EditorTool) => void;
  setSelectedColor: (index: number | null) => void;
  setZoom: (zoom: number) => void;
  setOffset: (x: number, y: number) => void;
  undo: () => void;
  redo: () => void;
  loadCanvasData: (data: CanvasData, size: CanvasSize) => void;
  setProjectPath: (path: string | null) => void;
}

function createEmptyCanvas(width: number, height: number): CanvasData {
  return Array.from({ length: height }, () =>
    Array.from({ length: width }, (): CanvasCell => ({ colorIndex: null }))
  );
}

const DEFAULT_GRID_CONFIG: GridConfig = {
  groupSize: 5,
  edgePadding: 2,
};

const MAX_HISTORY = 200;

export const useEditorStore = create<EditorState>((set, get) => ({
  canvasSize: { width: 52, height: 52 },
  canvasData: createEmptyCanvas(52, 52),
  gridConfig: DEFAULT_GRID_CONFIG,

  cellSize: 16,
  offsetX: 0,
  offsetY: 0,
  zoom: 1,

  currentTool: "pen",
  selectedColorIndex: 0,

  undoStack: [],
  redoStack: [],

  projectPath: null,
  isDirty: false,

  newCanvas: (width, height) => {
    set({
      canvasSize: { width, height },
      canvasData: createEmptyCanvas(width, height),
      undoStack: [],
      redoStack: [],
      isDirty: false,
      offsetX: 0,
      offsetY: 0,
    });
  },

  setCell: (row, col, colorIndex) => {
    const state = get();
    const prev = state.canvasData[row]?.[col]?.colorIndex ?? null;
    if (prev === colorIndex) return;

    const newData = state.canvasData.map((r) => r.map((c) => ({ ...c })));
    newData[row][col] = { colorIndex };

    const action: HistoryAction = [
      { row, col, prevColorIndex: prev, newColorIndex: colorIndex },
    ];

    const undoStack = [...state.undoStack, action].slice(-MAX_HISTORY);

    set({
      canvasData: newData,
      undoStack,
      redoStack: [],
      isDirty: true,
    });
  },

  batchSetCells: (entries) => {
    const state = get();
    const newData = state.canvasData.map((r) => r.map((c) => ({ ...c })));
    const action: HistoryAction = [];

    for (const { row, col, colorIndex } of entries) {
      const prev = newData[row]?.[col]?.colorIndex ?? null;
      if (prev !== colorIndex) {
        action.push({ row, col, prevColorIndex: prev, newColorIndex: colorIndex });
        newData[row][col] = { colorIndex };
      }
    }

    if (action.length === 0) return;

    const undoStack = [...state.undoStack, action].slice(-MAX_HISTORY);

    set({
      canvasData: newData,
      undoStack,
      redoStack: [],
      isDirty: true,
    });
  },

  setTool: (tool) => set({ currentTool: tool }),
  setSelectedColor: (index) => set({ selectedColorIndex: index }),

  setZoom: (zoom) => {
    const clamped = Math.max(0.5, Math.min(40, zoom));
    set({ zoom: clamped, cellSize: Math.round(16 * clamped) });
  },

  setOffset: (x, y) => set({ offsetX: x, offsetY: y }),

  undo: () => {
    const state = get();
    if (state.undoStack.length === 0) return;

    const action = state.undoStack[state.undoStack.length - 1];
    const newData = state.canvasData.map((r) => r.map((c) => ({ ...c })));

    for (const entry of action) {
      newData[entry.row][entry.col] = { colorIndex: entry.prevColorIndex };
    }

    set({
      canvasData: newData,
      undoStack: state.undoStack.slice(0, -1),
      redoStack: [...state.redoStack, action],
      isDirty: true,
    });
  },

  redo: () => {
    const state = get();
    if (state.redoStack.length === 0) return;

    const action = state.redoStack[state.redoStack.length - 1];
    const newData = state.canvasData.map((r) => r.map((c) => ({ ...c })));

    for (const entry of action) {
      newData[entry.row][entry.col] = { colorIndex: entry.newColorIndex };
    }

    set({
      canvasData: newData,
      undoStack: [...state.undoStack, action],
      redoStack: state.redoStack.slice(0, -1),
      isDirty: true,
    });
  },

  loadCanvasData: (data, size) => {
    set({
      canvasData: data,
      canvasSize: size,
      undoStack: [],
      redoStack: [],
      isDirty: false,
    });
  },

  setProjectPath: (path) => set({ projectPath: path }),
}));
