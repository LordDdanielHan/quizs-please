"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import quizData from "./quiz-data.json";
import type {
  AnswerValue,
  DocumentDropAnswer,
  HighlightStroke,
  QuizData,
  QuizDocument,
  QuizQuestion,
  QuizTurn,
} from "@/lib/quiz-types";

interface PlacedItem {
  x: number;
  y: number;
  width: number;
  height: number;
  z: number;
  aspectRatio?: number;
  introFrom?: "left" | "bottom";
  introDelayMs?: number;
}

interface ToolSpec {
  id: "calculator" | "notepad" | "converter" | "highlighter" | "eraser";
  title: string;
  width: number;
  height: number;
}

type MarkupMode = "none" | "highlight" | "erase";

interface DrawingSession {
  key: string;
  mode: Exclude<MarkupMode, "none">;
  rect: DOMRect;
}

interface ToolCursorState {
  x: number;
  y: number;
  mode: Exclude<MarkupMode, "none">;
}

interface UnitDefinition {
  key: string;
  label: string;
  category: "length" | "mass" | "time" | "volume" | "temperature";
  toBase: (value: number) => number;
  fromBase: (base: number) => number;
}

const data = quizData as QuizData;
const PEEK_SIZE = 24;
const MIN_WIDTH = 220;
const MIN_HEIGHT = 150;

const tools: ToolSpec[] = [
  { id: "calculator", title: "Pocket Calculator", width: 280, height: 360 },
  { id: "notepad", title: "Inspector Notepad", width: 340, height: 290 },
  { id: "converter", title: "Unit Converter", width: 340, height: 300 },
  { id: "highlighter", title: "Highlighter Pen", width: 260, height: 190 },
  { id: "eraser", title: "Eraser", width: 240, height: 180 },
];

const unitDefinitions: UnitDefinition[] = [
  { key: "m", label: "Meters (m)", category: "length", toBase: (v) => v, fromBase: (v) => v },
  { key: "km", label: "Kilometers (km)", category: "length", toBase: (v) => v * 1000, fromBase: (v) => v / 1000 },
  { key: "cm", label: "Centimeters (cm)", category: "length", toBase: (v) => v / 100, fromBase: (v) => v * 100 },
  { key: "mm", label: "Millimeters (mm)", category: "length", toBase: (v) => v / 1000, fromBase: (v) => v * 1000 },
  { key: "in", label: "Inches (in)", category: "length", toBase: (v) => v * 0.0254, fromBase: (v) => v / 0.0254 },
  { key: "ft", label: "Feet (ft)", category: "length", toBase: (v) => v * 0.3048, fromBase: (v) => v / 0.3048 },
  { key: "kg", label: "Kilograms (kg)", category: "mass", toBase: (v) => v, fromBase: (v) => v },
  { key: "g", label: "Grams (g)", category: "mass", toBase: (v) => v / 1000, fromBase: (v) => v * 1000 },
  { key: "lb", label: "Pounds (lb)", category: "mass", toBase: (v) => v * 0.45359237, fromBase: (v) => v / 0.45359237 },
  { key: "oz", label: "Ounces (oz)", category: "mass", toBase: (v) => v * 0.0283495231, fromBase: (v) => v / 0.0283495231 },
  { key: "s", label: "Seconds (s)", category: "time", toBase: (v) => v, fromBase: (v) => v },
  { key: "min", label: "Minutes (min)", category: "time", toBase: (v) => v * 60, fromBase: (v) => v / 60 },
  { key: "h", label: "Hours (h)", category: "time", toBase: (v) => v * 3600, fromBase: (v) => v / 3600 },
  { key: "L", label: "Liters (L)", category: "volume", toBase: (v) => v, fromBase: (v) => v },
  { key: "mL", label: "Milliliters (mL)", category: "volume", toBase: (v) => v / 1000, fromBase: (v) => v * 1000 },
  { key: "gal", label: "US Gallons (gal)", category: "volume", toBase: (v) => v * 3.785411784, fromBase: (v) => v / 3.785411784 },
  { key: "C", label: "Celsius (C)", category: "temperature", toBase: (v) => v, fromBase: (v) => v },
  { key: "F", label: "Fahrenheit (F)", category: "temperature", toBase: (v) => (v - 32) * (5 / 9), fromBase: (v) => v * (9 / 5) + 32 },
  { key: "K", label: "Kelvin (K)", category: "temperature", toBase: (v) => v - 273.15, fromBase: (v) => v + 273.15 },
];

const unitByKey = Object.fromEntries(unitDefinitions.map((unit) => [unit.key, unit])) as Record<
  string,
  UnitDefinition
>;
const unitCategories = ["length", "mass", "time", "volume", "temperature"] as const;
const highlightWidth = 14;
const eraserRadiusPx = 16;

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function normalizeText(value: string): string {
  return value.replace(/\\n/g, "\n");
}

function isQuestionAnswered(question: QuizQuestion, answer: AnswerValue | undefined): boolean {
  if (question.kind === "multiple-response") {
    return Array.isArray(answer) && answer.length > 0;
  }

  if (question.kind === "match") {
    if (!answer || typeof answer !== "object" || Array.isArray(answer)) {
      return false;
    }
    const mapping = answer as Record<string, string>;
    return (question.matchLeft ?? []).every((left) => Boolean(mapping[left]));
  }

  if (question.kind === "sequence") {
    return Array.isArray(answer) && answer.length > 0;
  }

  if (question.kind === "document-upload") {
    if (!answer || typeof answer !== "object" || Array.isArray(answer)) {
      return false;
    }
    return typeof (answer as DocumentDropAnswer).docId === "string";
  }

  return typeof answer === "string" && answer.trim().length > 0;
}

function isDocumentDropAnswer(answer: AnswerValue | undefined): answer is DocumentDropAnswer {
  if (!answer || typeof answer !== "object" || Array.isArray(answer)) {
    return false;
  }
  return (answer as DocumentDropAnswer).type === "document-drop";
}

function normalizeMarkupValue(value: number): number {
  return clamp(value, 0, 1);
}

function buildStrokePath(stroke: HighlightStroke): string {
  if (stroke.points.length === 0) {
    return "";
  }
  const [first, ...rest] = stroke.points;
  return `M ${first.x} ${first.y} ${rest.map((point) => `L ${point.x} ${point.y}`).join(" ")}`;
}

function buildMarkerColor(hue: number, alpha: number): string {
  return `hsla(${Math.round(hue)}, 82%, 52%, ${alpha})`;
}

export default function QuizPage() {
  const [userId, setUserId] = useState("");
  const [turnIndex, setTurnIndex] = useState(0);
  const [answers, setAnswers] = useState<Record<string, AnswerValue>>({});
  const [placed, setPlaced] = useState<Record<string, PlacedItem>>({});
  const [boardSize, setBoardSize] = useState({ width: 1280, height: 720 });
  const [turnModalOpen, setTurnModalOpen] = useState(false);
  const [finished, setFinished] = useState(false);
  const [submissionId, setSubmissionId] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");

  const [calcExpr, setCalcExpr] = useState("0");
  const [calcError, setCalcError] = useState("");
  const [notepadText, setNotepadText] = useState("");

  const [converterCategory, setConverterCategory] = useState<(typeof unitCategories)[number]>("length");
  const [converterInput, setConverterInput] = useState("1");
  const [fromUnit, setFromUnit] = useState("m");
  const [toUnit, setToUnit] = useState("ft");
  const [strokesByItem, setStrokesByItem] = useState<Record<string, HighlightStroke[]>>({});
  const [markupMode, setMarkupMode] = useState<MarkupMode>("none");
  const [draggingDocId, setDraggingDocId] = useState<string>("");
  const [documentDropLoadingQuestionId, setDocumentDropLoadingQuestionId] = useState("");
  const [highlighterHue, setHighlighterHue] = useState(0);
  const [colorWheelOpen, setColorWheelOpen] = useState(false);
  const [toolCursor, setToolCursor] = useState<ToolCursorState | null>(null);

  const boardRef = useRef<HTMLDivElement | null>(null);
  const colorWheelRef = useRef<HTMLDivElement | null>(null);
  const zRef = useRef(100);
  const drawingRef = useRef<DrawingSession | null>(null);
  const interactionRef = useRef<{
    mode: "drag" | "resize";
    key: string;
    startX: number;
    startY: number;
    originX: number;
    originY: number;
    originW: number;
    originH: number;
  } | null>(null);

  const turn: QuizTurn = data.turns[turnIndex];
  const totalTurns = data.turns.length;

  const visibleDocs = useMemo(() => {
    const docs: QuizDocument[] = [];
    const seen = new Set<string>();

    for (let i = 0; i <= turnIndex; i += 1) {
      for (const doc of data.turns[i].documents) {
        if ((i === turnIndex || doc.persistent) && !seen.has(doc.id)) {
          docs.push(doc);
          seen.add(doc.id);
        }
      }
    }

    return docs;
  }, [turnIndex]);

  const activeDocKeys = useMemo(() => new Set(visibleDocs.map((doc) => `doc:${doc.id}`)), [visibleDocs]);
  const visibleDocById = useMemo(
    () => Object.fromEntries(visibleDocs.map((doc) => [doc.id, doc])) as Record<string, QuizDocument>,
    [visibleDocs]
  );
  const allDocById = useMemo(() => {
    const docs = new Map<string, QuizDocument>();
    for (const quizTurn of data.turns) {
      for (const doc of quizTurn.documents) {
        docs.set(doc.id, doc);
      }
    }
    return docs;
  }, []);
  const topLayerKey = useMemo(() => {
    const keys = Object.keys(placed);
    if (keys.length === 0) {
      return "";
    }
    return keys.reduce((top, key) => (placed[key].z > placed[top].z ? key : top), keys[0]);
  }, [placed]);

  const turnTotalMarks = useMemo(
    () => turn.questions.reduce((sum, question) => sum + question.marks, 0),
    [turn.questions]
  );

  useEffect(() => {
    setAnswers((prev) => {
      let changed = false;
      const next = { ...prev };

      for (const question of turn.questions) {
        if (question.kind !== "sequence") {
          continue;
        }
        if (!Array.isArray(prev[question.id])) {
          next[question.id] = [...(question.sequencePool ?? [])];
          changed = true;
        }
      }

      return changed ? next : prev;
    });
  }, [turn.questions]);

  const converterUnits = useMemo(
    () => unitDefinitions.filter((unit) => unit.category === converterCategory),
    [converterCategory]
  );

  const converterOutput = useMemo(() => {
    const value = Number.parseFloat(converterInput);
    if (Number.isNaN(value)) {
      return "Enter a valid number";
    }

    const source = unitByKey[fromUnit];
    const target = unitByKey[toUnit];

    if (!source || !target) {
      return "Select valid units";
    }

    const base = source.toBase(value);
    const converted = target.fromBase(base);
    return `${converted.toFixed(6).replace(/\.0+$/, "").replace(/(\.\d*?)0+$/, "$1")} ${target.key}`;
  }, [converterInput, fromUnit, toUnit]);
  const activeHighlightStrokeColor = useMemo(() => buildMarkerColor(highlighterHue, 0.38), [highlighterHue]);
  const activeHighlightSolidColor = useMemo(() => buildMarkerColor(highlighterHue, 0.95), [highlighterHue]);

  useEffect(() => {
    const units = unitDefinitions.filter((unit) => unit.category === converterCategory);
    if (units.length === 0) {
      return;
    }
    if (!units.some((unit) => unit.key === fromUnit)) {
      setFromUnit(units[0].key);
    }
    if (!units.some((unit) => unit.key === toUnit)) {
      setToUnit(units[Math.min(1, units.length - 1)].key);
    }
  }, [converterCategory, fromUnit, toUnit]);

  function nextZ(): number {
    zRef.current += 1;
    return zRef.current;
  }

  const clampItem = useCallback(
    (x: number, y: number, width: number): Pick<PlacedItem, "x" | "y"> => {
      const minX = -width + PEEK_SIZE;
      const maxX = boardSize.width - width - 8;
      const minY = 8;
      const maxY = boardSize.height - PEEK_SIZE;
      return { x: clamp(x, minX, maxX), y: clamp(y, minY, maxY) };
    },
    [boardSize.height, boardSize.width]
  );

  const clampItemSize = useCallback(
    (
      x: number,
      y: number,
      width: number,
      height: number,
      aspectRatio?: number
    ): Pick<PlacedItem, "x" | "y" | "width" | "height"> => {
      const maxWidth = Math.max(MIN_WIDTH, boardSize.width + Math.abs(x) - 16);
      const maxHeight = Math.max(MIN_HEIGHT, boardSize.height + Math.abs(y) - 24);
      let w = width;
      let h = height;

      if (aspectRatio && Number.isFinite(aspectRatio) && aspectRatio > 0) {
        const byWidth = { width: w, height: w / aspectRatio };
        const byHeight = { width: h * aspectRatio, height: h };
        const widthError = Math.abs(byWidth.height - h);
        const heightError = Math.abs(byHeight.width - w);
        if (widthError <= heightError) {
          w = byWidth.width;
          h = byWidth.height;
        } else {
          w = byHeight.width;
          h = byHeight.height;
        }

        let minWidthByRatio = Math.max(MIN_WIDTH, MIN_HEIGHT * aspectRatio);
        const maxWidthByRatio = Math.max(1, Math.min(maxWidth, maxHeight * aspectRatio));
        if (minWidthByRatio > maxWidthByRatio) {
          minWidthByRatio = Math.max(1, Math.min(MIN_WIDTH, maxWidthByRatio));
        }
        w = clamp(w, minWidthByRatio, maxWidthByRatio);
        h = w / aspectRatio;
      } else {
        w = clamp(w, MIN_WIDTH, maxWidth);
        h = clamp(h, MIN_HEIGHT, maxHeight);
      }

      const pos = clampItem(x, y, w);
      return { x: pos.x, y: pos.y, width: w, height: h };
    },
    [boardSize.height, boardSize.width, clampItem]
  );

  const appendHighlightPoint = useCallback((key: string, point: { x: number; y: number }) => {
    setStrokesByItem((prev) => {
      const strokes = prev[key] ?? [];
      if (strokes.length === 0) {
        return prev;
      }
      const updated = [...strokes];
      const lastIndex = updated.length - 1;
      const lastStroke = updated[lastIndex];
      updated[lastIndex] = { ...lastStroke, points: [...lastStroke.points, point] };
      return { ...prev, [key]: updated };
    });
  }, []);

  const eraseHighlightAtPoint = useCallback(
    (key: string, point: { x: number; y: number }, rect: DOMRect) => {
      setStrokesByItem((prev) => {
        const source = prev[key];
        if (!source || source.length === 0) {
          return prev;
        }

        const radiusSq = eraserRadiusPx * eraserRadiusPx;
        const nextStrokes: HighlightStroke[] = [];
        let mutated = false;

        for (const stroke of source) {
          if (stroke.points.length < 2) {
            continue;
          }

          let segment: HighlightStroke["points"] = [];
          let splitCount = 0;

          for (const entry of stroke.points) {
            const px = entry.x * rect.width;
            const py = entry.y * rect.height;
            const ex = point.x * rect.width;
            const ey = point.y * rect.height;
            const dx = px - ex;
            const dy = py - ey;
            const eraseHere = dx * dx + dy * dy <= radiusSq;

            if (eraseHere) {
              if (segment.length > 1) {
                nextStrokes.push({
                  ...stroke,
                  id: splitCount === 0 ? stroke.id : `${stroke.id}-split-${splitCount}`,
                  points: segment,
                });
              }
              splitCount += 1;
              segment = [];
              mutated = true;
            } else {
              segment.push(entry);
            }
          }

          if (segment.length > 1) {
            nextStrokes.push({
              ...stroke,
              id: splitCount === 0 ? stroke.id : `${stroke.id}-tail-${splitCount}`,
              points: segment,
            });
          }
        }

        if (!mutated) {
          return prev;
        }

        return { ...prev, [key]: nextStrokes };
      });
    },
    []
  );

  function bringToFront(key: string): void {
    setPlaced((prev) => {
      const current = prev[key];
      if (!current) {
        return prev;
      }
      return { ...prev, [key]: { ...current, z: nextZ() } };
    });
  }

  useEffect(() => {
    if (!boardRef.current) {
      return;
    }

    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry) {
        return;
      }
      setBoardSize({
        width: Math.max(640, Math.floor(entry.contentRect.width)),
        height: Math.max(400, Math.floor(entry.contentRect.height)),
      });
    });

    observer.observe(boardRef.current);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const clampSizeForPlacementEffect = (
      x: number,
      y: number,
      width: number,
      height: number,
      aspectRatio?: number
    ): Pick<PlacedItem, "x" | "y" | "width" | "height"> => {
      const maxWidth = Math.max(MIN_WIDTH, boardSize.width + Math.abs(x) - 16);
      const maxHeight = Math.max(MIN_HEIGHT, boardSize.height + Math.abs(y) - 24);
      let w = width;
      let h = height;

      if (aspectRatio && Number.isFinite(aspectRatio) && aspectRatio > 0) {
        const byWidth = { width: w, height: w / aspectRatio };
        const byHeight = { width: h * aspectRatio, height: h };
        const widthError = Math.abs(byWidth.height - h);
        const heightError = Math.abs(byHeight.width - w);
        if (widthError <= heightError) {
          w = byWidth.width;
          h = byWidth.height;
        } else {
          w = byHeight.width;
          h = byHeight.height;
        }

        let minWidthByRatio = Math.max(MIN_WIDTH, MIN_HEIGHT * aspectRatio);
        const maxWidthByRatio = Math.max(1, Math.min(maxWidth, maxHeight * aspectRatio));
        if (minWidthByRatio > maxWidthByRatio) {
          minWidthByRatio = Math.max(1, Math.min(MIN_WIDTH, maxWidthByRatio));
        }
        w = clamp(w, minWidthByRatio, maxWidthByRatio);
        h = w / aspectRatio;
      } else {
        w = clamp(w, MIN_WIDTH, maxWidth);
        h = clamp(h, MIN_HEIGHT, maxHeight);
      }

      const pos = clampItem(x, y, w);
      return { x: pos.x, y: pos.y, width: w, height: h };
    };

    setPlaced((prev) => {
      const next: Record<string, PlacedItem> = {};
      let stack = 0;

      for (const doc of visibleDocs) {
        const key = `doc:${doc.id}`;
        const existing = prev[key];
        const width = doc.width ?? 340;
        const height = doc.height ?? 260;
        const aspectRatio = doc.type === "image" && height > 0 ? width / height : undefined;

        if (existing) {
          const normalizedHeight =
            aspectRatio && existing.width > 0 ? existing.width / aspectRatio : existing.height;
          const resized = clampSizeForPlacementEffect(
            existing.x,
            existing.y,
            existing.width,
            normalizedHeight,
            aspectRatio
          );
          next[key] = { ...existing, ...resized, aspectRatio };
          continue;
        }

        const initial = clampItem(24 + stack * 28, 76 + stack * 18, width);
        next[key] = {
          x: initial.x,
          y: initial.y,
          width,
          height,
          z: nextZ(),
          aspectRatio,
          introFrom: "left",
          introDelayMs: stack * 110,
        };
        stack += 1;
      }

      for (let index = 0; index < tools.length; index += 1) {
        const tool = tools[index];
        const key = `tool:${tool.id}`;
        const existing = prev[key];
        if (existing) {
          const pos = clampItem(existing.x, existing.y, existing.width);
          next[key] = { ...existing, ...pos };
          continue;
        }

        const initial = clampItem(42 + index * 172, boardSize.height - PEEK_SIZE, tool.width);
        next[key] = {
          x: initial.x,
          y: initial.y,
          width: tool.width,
          height: tool.height,
          z: nextZ(),
          introFrom: "bottom",
          introDelayMs: index * 110,
        };
      }

      for (const [key, value] of Object.entries(prev)) {
        if (key.startsWith("tool:") && !next[key]) {
          next[key] = value;
        }
        if (key.startsWith("doc:") && activeDocKeys.has(key) && !next[key]) {
          next[key] = value;
        }
      }

      return next;
    });
  }, [activeDocKeys, boardSize.height, boardSize.width, clampItem, visibleDocs]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setPlaced((prev) => {
        const next: Record<string, PlacedItem> = {};
        let changed = false;
        for (const [key, item] of Object.entries(prev)) {
          if (item.introFrom) {
            next[key] = { ...item, introFrom: undefined, introDelayMs: undefined };
            changed = true;
          } else {
            next[key] = item;
          }
        }
        return changed ? next : prev;
      });
    }, 1200);
    return () => window.clearTimeout(timer);
  }, [turnIndex]);

  useEffect(() => {
    if (markupMode === "none") {
      drawingRef.current = null;
      setToolCursor(null);
    }
  }, [markupMode]);

  useEffect(() => {
    setStrokesByItem((prev) => {
      const validKeys = new Set(Object.keys(placed));
      const next: Record<string, HighlightStroke[]> = {};
      let changed = false;
      for (const [key, value] of Object.entries(prev)) {
        if (validKeys.has(key)) {
          next[key] = value;
        } else {
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, [placed]);

  useEffect(() => {
    const handlePointerMove = (event: PointerEvent) => {
      const action = interactionRef.current;
      if (action) {
        const dx = event.clientX - action.startX;
        const dy = event.clientY - action.startY;

        setPlaced((prev) => {
          const current = prev[action.key];
          if (!current) {
            return prev;
          }

          if (action.mode === "drag") {
            const pos = clampItem(action.originX + dx, action.originY + dy, current.width);
            return { ...prev, [action.key]: { ...current, x: pos.x, y: pos.y } };
          }

          const resized = clampItemSize(
            current.x,
            current.y,
            action.originW + dx,
            action.originH + dy,
            current.aspectRatio
          );
          return { ...prev, [action.key]: { ...current, ...resized } };
        });
      }

      const drawing = drawingRef.current;
      if (!drawing) {
        return;
      }

      const point = {
        x: normalizeMarkupValue((event.clientX - drawing.rect.left) / Math.max(drawing.rect.width, 1)),
        y: normalizeMarkupValue((event.clientY - drawing.rect.top) / Math.max(drawing.rect.height, 1)),
      };

      if (drawing.mode === "highlight") {
        appendHighlightPoint(drawing.key, point);
      } else {
        eraseHighlightAtPoint(drawing.key, point, drawing.rect);
      }
      setToolCursor({ x: event.clientX, y: event.clientY, mode: drawing.mode });
    };

    const handlePointerUp = () => {
      interactionRef.current = null;
      drawingRef.current = null;
      setToolCursor(null);
    };

    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp);

    return () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
    };
  }, [appendHighlightPoint, clampItem, clampItemSize, eraseHighlightAtPoint]);

  function startDrag(event: React.PointerEvent, key: string): void {
    event.preventDefault();
    const current = placed[key];
    if (!current) {
      return;
    }
    bringToFront(key);
    interactionRef.current = {
      mode: "drag",
      key,
      startX: event.clientX,
      startY: event.clientY,
      originX: current.x,
      originY: current.y,
      originW: current.width,
      originH: current.height,
    };
  }

  function startResize(event: React.PointerEvent, key: string): void {
    event.preventDefault();
    event.stopPropagation();
    const current = placed[key];
    if (!current) {
      return;
    }
    bringToFront(key);
    interactionRef.current = {
      mode: "resize",
      key,
      startX: event.clientX,
      startY: event.clientY,
      originX: current.x,
      originY: current.y,
      originW: current.width,
      originH: current.height,
    };
  }

  function startMarkup(event: React.PointerEvent<HTMLDivElement>, key: string): void {
    if (markupMode === "none") {
      return;
    }
    if (key === "tool:highlighter" || key === "tool:eraser") {
      return;
    }
    if (topLayerKey !== key) {
      return;
    }

    const target = event.target as HTMLElement;
    if (target.closest("[data-no-markup='true']")) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();

    const host = event.currentTarget;
    const rect = host.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) {
      return;
    }
    const point = {
      x: normalizeMarkupValue((event.clientX - rect.left) / rect.width),
      y: normalizeMarkupValue((event.clientY - rect.top) / rect.height),
    };

    if (markupMode === "highlight") {
      setStrokesByItem((prev) => {
        const nextStroke: HighlightStroke = {
          id: `${key}-${Date.now()}`,
          color: activeHighlightStrokeColor,
          width: highlightWidth,
          points: [point],
        };
        return { ...prev, [key]: [...(prev[key] ?? []), nextStroke] };
      });
    } else {
      eraseHighlightAtPoint(key, point, rect);
    }
    setToolCursor({
      x: event.clientX,
      y: event.clientY,
      mode: markupMode === "highlight" ? "highlight" : "erase",
    });

    drawingRef.current = {
      key,
      mode: markupMode,
      rect,
    };
  }

  function setAnswer(questionId: string, value: AnswerValue): void {
    setAnswers((prev) => ({ ...prev, [questionId]: value }));
    setErrorMessage("");
  }

  function toggleMulti(questionId: string, option: string): void {
    const current = answers[questionId];
    const next = Array.isArray(current) ? [...current] : [];
    const index = next.indexOf(option);
    if (index >= 0) {
      next.splice(index, 1);
    } else {
      next.push(option);
    }
    setAnswer(questionId, next);
  }

  function setMatch(questionId: string, left: string, right: string): void {
    const current = answers[questionId];
    const mapping =
      current && typeof current === "object" && !Array.isArray(current)
        ? { ...(current as Record<string, string>) }
        : {};
    mapping[left] = right;
    setAnswer(questionId, mapping);
  }

  function getSequence(question: QuizQuestion): string[] {
    const current = answers[question.id];
    if (Array.isArray(current)) {
      return current.filter((item): item is string => typeof item === "string");
    }
    return [...(question.sequencePool ?? [])];
  }

  function moveSequenceItem(questionId: string, sourceIndex: number, targetIndex: number): void {
    const question = turn.questions.find((q) => q.id === questionId);
    if (!question) {
      return;
    }
    const sequence = getSequence(question);
    if (
      sourceIndex < 0 ||
      sourceIndex >= sequence.length ||
      targetIndex < 0 ||
      targetIndex >= sequence.length ||
      sourceIndex === targetIndex
    ) {
      return;
    }

    const next = [...sequence];
    const [moved] = next.splice(sourceIndex, 1);
    next.splice(targetIndex, 0, moved);
    setAnswer(questionId, next);
  }

  function parseDraggedDocId(dataTransfer: DataTransfer): string {
    const custom = dataTransfer.getData("application/x-quiz-doc-id").trim();
    if (custom) {
      return custom;
    }
    const plain = dataTransfer.getData("text/plain").trim();
    if (!plain) {
      return "";
    }
    return plain.startsWith("quiz-doc:") ? plain.slice("quiz-doc:".length) : plain;
  }

  async function composeDocumentWithHighlights(
    doc: QuizDocument,
    highlights: HighlightStroke[],
    containerWidth: number,
    containerHeight: number
  ): Promise<string | undefined> {
    const imageSrc = doc.imageSrc;
    if (!imageSrc) {
      return undefined;
    }

    return new Promise((resolve) => {
      const image = new Image();
      image.onload = () => {
        const width = image.naturalWidth || image.width;
        const height = image.naturalHeight || image.height;
        if (width <= 0 || height <= 0) {
          resolve(undefined);
          return;
        }

        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        const context = canvas.getContext("2d");
        if (!context) {
          resolve(undefined);
          return;
        }

        context.drawImage(image, 0, 0, width, height);
        const fitScale = Math.min(containerWidth / width, containerHeight / height);
        const renderedWidth = width * fitScale;
        const renderedHeight = height * fitScale;
        const offsetX = (containerWidth - renderedWidth) / 2;
        const offsetY = (containerHeight - renderedHeight) / 2;

        for (const stroke of highlights) {
          if (!stroke.points.length) {
            continue;
          }
          context.beginPath();
          context.lineCap = "round";
          context.lineJoin = "round";
          context.strokeStyle = stroke.color;
          context.lineWidth = Math.max(5, stroke.width / Math.max(fitScale, 0.0001));

          let moved = false;
          for (const point of stroke.points) {
            const xOnContainer = point.x * containerWidth;
            const yOnContainer = point.y * containerHeight;
            if (
              xOnContainer < offsetX ||
              xOnContainer > offsetX + renderedWidth ||
              yOnContainer < offsetY ||
              yOnContainer > offsetY + renderedHeight
            ) {
              continue;
            }

            const xOnImage = (xOnContainer - offsetX) / fitScale;
            const yOnImage = (yOnContainer - offsetY) / fitScale;
            if (!moved) {
              context.moveTo(xOnImage, yOnImage);
              moved = true;
            } else {
              context.lineTo(xOnImage, yOnImage);
            }
          }

          if (moved) {
            context.stroke();
          }
        }

        resolve(canvas.toDataURL("image/png"));
      };
      image.onerror = () => resolve(undefined);
      image.src = imageSrc;
    });
  }

  function startColorWheelDrag(event: React.PointerEvent<HTMLDivElement>): void {
    const updateHueFromPointer = (clientX: number, clientY: number) => {
      const wheel = colorWheelRef.current;
      if (!wheel) {
        return;
      }
      const rect = wheel.getBoundingClientRect();
      const centerX = rect.left + rect.width / 2;
      const centerY = rect.top + rect.height / 2;
      const angle = Math.atan2(clientY - centerY, clientX - centerX);
      const hue = ((angle * 180) / Math.PI + 360) % 360;
      setHighlighterHue(hue);
    };

    event.preventDefault();
    updateHueFromPointer(event.clientX, event.clientY);

    const handleMove = (moveEvent: PointerEvent) => {
      updateHueFromPointer(moveEvent.clientX, moveEvent.clientY);
    };
    const handleUp = () => {
      window.removeEventListener("pointermove", handleMove);
      window.removeEventListener("pointerup", handleUp);
    };

    window.addEventListener("pointermove", handleMove);
    window.addEventListener("pointerup", handleUp);
  }

  async function submitQuiz(): Promise<void> {
    setSubmitting(true);
    setErrorMessage("");
    try {
      const response = await fetch("/api/quiz/submissions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId, answers }),
      });

      const payload = (await response.json()) as {
        submissionId?: string;
        userId?: string;
        error?: string;
      };

      if (!response.ok || !payload.submissionId) {
        throw new Error(payload.error || "Failed to save submission");
      }

      setSubmissionId(payload.submissionId);
      if (payload.userId) {
        setUserId(payload.userId);
      }
      setFinished(true);
      setTurnModalOpen(false);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Submission failed";
      setErrorMessage(message);
    } finally {
      setSubmitting(false);
    }
  }

  async function endTurn(): Promise<void> {
    if (!userId.trim()) {
      setErrorMessage("Enter a user ID before ending the turn.");
      return;
    }

    const unanswered = turn.questions.filter(
      (question) => !isQuestionAnswered(question, answers[question.id])
    );

    if (unanswered.length > 0) {
      setErrorMessage("Answer every question in this turn before ending it.");
      return;
    }

    if (turnIndex >= totalTurns - 1) {
      await submitQuiz();
      return;
    }

    setTurnModalOpen(true);
  }

  function moveToNextTurn(): void {
    setTurnModalOpen(false);
    setErrorMessage("");
    setTurnIndex((prev) => Math.min(prev + 1, totalTurns - 1));
  }

  function pressCalc(key: string): void {
    setCalcError("");

    if (key === "C") {
      setCalcExpr("0");
      return;
    }

    if (key === "=") {
      try {
        if (!/^[0-9+\-*/().%\s]+$/.test(calcExpr)) {
          throw new Error("invalid");
        }
        const expression = calcExpr.replace(/%/g, "/100");
        const result = Function(`"use strict"; return (${expression});`)();
        if (typeof result !== "number" || !Number.isFinite(result)) {
          throw new Error("invalid");
        }
        setCalcExpr(String(Math.round((result + Number.EPSILON) * 1000000) / 1000000));
      } catch {
        setCalcError("Math error");
      }
      return;
    }

    if (calcExpr === "0" && /[0-9.]/.test(key)) {
      setCalcExpr(key);
      return;
    }

    setCalcExpr((prev) => prev + key);
  }

  function renderMemo(content: string | undefined): React.ReactNode {
    const lines = normalizeText(content ?? "").split("\n");
    return (
      <div className="space-y-1 text-xs leading-5 text-[#2f261d]">
        {lines.map((line, index) => {
          const trimmed = line.trim();
          if (!trimmed) {
            return <div key={`memo-gap-${index}`} className="h-2" />;
          }

          if (/^\d+\)/.test(trimmed)) {
            return (
              <div key={`memo-num-${index}`} className="pl-2">
                {trimmed}
              </div>
            );
          }

          if (/^-\s/.test(trimmed)) {
            return (
              <div key={`memo-bullet-${index}`} className="pl-2">
                {trimmed}
              </div>
            );
          }

          if (trimmed.endsWith(":")) {
            return (
              <p key={`memo-head-${index}`} className="pt-1 font-semibold uppercase tracking-[0.08em] text-[#4a3b2a]">
                {trimmed}
              </p>
            );
          }

          return <p key={`memo-text-${index}`}>{trimmed}</p>;
        })}
      </div>
    );
  }

  function renderDocument(doc: QuizDocument): React.ReactNode {
    if (doc.type === "memo") {
      return renderMemo(doc.content);
    }

    if (doc.type === "newspaper") {
      return (
        <article className="min-h-full rounded border border-[#9a8d71] bg-[#f7f1de] p-3 text-[#2f251b] shadow-inner">
          <div className="border-b-2 border-[#7f7158] pb-2 text-center">
            <p className="font-title text-[30px] uppercase tracking-[0.12em]">{doc.title}</p>
            <p className="text-[10px] uppercase tracking-[0.16em] text-[#5e503f]">{doc.publishDate}</p>
          </div>
          <h3 className="mt-2 border-b border-[#c2b495] pb-1 text-base font-extrabold leading-5">
            {doc.headline || doc.title}
          </h3>
          {doc.subhead ? <p className="mt-1 text-xs italic text-[#4c3d2a]">{doc.subhead}</p> : null}
          {doc.byline ? <p className="mt-1 text-[10px] uppercase tracking-[0.08em] text-[#6d5c44]">{doc.byline}</p> : null}
          <div className="mt-2 grid grid-cols-2 gap-3 border-t border-[#cec1a5] pt-2 text-[11px] leading-[1.35]">
            {(doc.columns && doc.columns.length > 0
              ? doc.columns
              : normalizeText(doc.content ?? "").split("\n\n")
            ).map((column, idx) => (
              <p key={`${doc.id}-column-${idx}`} className="break-words text-justify indent-3 first-letter:font-bold">
                {column}
              </p>
            ))}
          </div>
        </article>
      );
    }

    if (doc.type === "image") {
      return (
        <div className="h-full">
          <div
            draggable={Boolean(doc.imageSrc)}
            data-no-markup="true"
            onDragStart={(event) => {
              if (!doc.imageSrc) {
                return;
              }
              event.dataTransfer.setData("application/x-quiz-doc-id", doc.id);
              event.dataTransfer.setData("text/plain", `quiz-doc:${doc.id}`);
              event.dataTransfer.effectAllowed = "copyMove";
              setDraggingDocId(doc.id);
            }}
            onDragEnd={() => setDraggingDocId("")}
            className="h-full cursor-grab active:cursor-grabbing"
            title="Drag this image into a document question drop zone."
          >
            {doc.imageSrc ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={doc.imageSrc}
                alt={doc.title}
                className="h-full w-full rounded border border-[#7f6e56] object-contain"
              />
            ) : null}
          </div>
        </div>
      );
    }

    if (doc.type === "table" || doc.type === "spreadsheet") {
      return (
        <div className="space-y-2">
          {doc.filePath ? (
            <a
              href={doc.filePath}
              target="_blank"
              rel="noreferrer"
              className="text-xs font-bold text-[#654f31] underline"
            >
              Open file: {doc.filePath}
            </a>
          ) : null}
          {doc.table ? (
            <div className="quiz-scroll overflow-auto rounded border border-[#7f6e56]">
              <table className="min-w-full border-collapse text-xs">
                <thead className="bg-[#c8b893] text-[#31271d]">
                  <tr>
                    {doc.table.columns.map((col) => (
                      <th key={`${doc.id}-col-${col}`} className="border border-[#7f6e56] px-2 py-1 text-left">
                        {col}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {doc.table.rows.map((row, rowIndex) => (
                    <tr key={`${doc.id}-row-${rowIndex}`} className="bg-[#e2d6b7]">
                      {row.map((cell, cellIndex) => (
                        <td
                          key={`${doc.id}-cell-${rowIndex}-${cellIndex}`}
                          className="border border-[#8b7a61] px-2 py-1 text-[#2f261d]"
                        >
                          {cell}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}
        </div>
      );
    }

    if (doc.type === "transcript") {
      return (
        <div className="space-y-2 text-xs text-[#30271e]">
          {(doc.entries ?? []).map((entry, idx) => (
            <p key={`${doc.id}-entry-${idx}`} className="rounded border border-[#8b7a61] bg-[#e5d7b6] px-2 py-2">
              {entry}
            </p>
          ))}
        </div>
      );
    }

    if (doc.type === "checklist") {
      return (
        <ul className="space-y-2 text-xs text-[#2f261d]">
          {(doc.items ?? []).map((item) => (
            <li
              key={`${doc.id}-${item}`}
              className="flex items-center gap-2 rounded border border-[#86745b] bg-[#e6d8b8] px-2 py-2"
            >
              <span className="inline-flex h-4 w-4 items-center justify-center rounded-sm border border-[#6b5b45] bg-[#f6f0dc]" />
              <span>{item}</span>
            </li>
          ))}
        </ul>
      );
    }

    return null;
  }

  function renderTool(toolId: ToolSpec["id"]): React.ReactNode {
    if (toolId === "calculator") {
      const keys = ["7", "8", "9", "/", "4", "5", "6", "*", "1", "2", "3", "-", "0", ".", "%", "+", "C", "="];
      return (
        <div className="h-full space-y-2" data-no-markup="true">
          <div className="rounded border border-[#5d4d38] bg-[#e7dbc0] px-2 py-2 font-mono text-right text-lg text-[#1f1a13]">
            {calcExpr}
          </div>
          {calcError ? <div className="text-xs text-[#7e241e]">{calcError}</div> : null}
          <div className="grid grid-cols-4 gap-1">
            {keys.map((key) => (
              <button
                key={`calc-${key}`}
                type="button"
                onClick={() => pressCalc(key)}
                className="rounded border border-[#6d5b43] bg-[#d8c79f] px-2 py-2 text-sm font-bold text-[#2a2117] hover:bg-[#c9b68b]"
              >
                {key}
              </button>
            ))}
          </div>
        </div>
      );
    }

    if (toolId === "notepad") {
      return (
        <textarea
          data-no-markup="true"
          value={notepadText}
          onChange={(event) => setNotepadText(event.target.value)}
          placeholder="Write clues and calculations..."
          className="h-full w-full resize-none rounded border border-[#6f5f47] bg-[#f0e4c9] p-2 text-sm text-[#2a2117] outline-none"
        />
      );
    }

    if (toolId === "highlighter") {
      const knobAngle = `${highlighterHue}deg`;
      return (
        <div className="h-full space-y-3" data-no-markup="true">
          <div className="flex items-center gap-2 rounded border border-[#6d5a3f] bg-[#d4c298] px-2 py-2">
            <span className="inline-block h-3 w-14 rounded-full" style={{ backgroundColor: activeHighlightSolidColor }} />
            <span className="text-xs font-semibold uppercase tracking-[0.08em] text-[#3b2f1e]">Marker Tip</span>
          </div>
          <button
            type="button"
            onClick={() => setMarkupMode((current) => (current === "highlight" ? "none" : "highlight"))}
            className={`w-full rounded border px-2 py-2 text-xs font-bold uppercase tracking-[0.08em] ${
              markupMode === "highlight"
                ? "border-[#4e6b2f] bg-[#ddeb7e] text-[#1d2a10]"
                : "border-[#745f42] bg-[#ccb78e] text-[#2a2117]"
            }`}
          >
            {markupMode === "highlight" ? "Turn Off Highlighter" : "Activate Highlighter"}
          </button>
          <button
            type="button"
            onClick={() => setColorWheelOpen((current) => !current)}
            className="w-full rounded border border-[#745f42] bg-[#cbb58b] px-2 py-2 text-xs font-bold uppercase tracking-[0.08em] text-[#2a2117]"
          >
            {colorWheelOpen ? "Hide Color Wheel" : "Pick Marker Color"}
          </button>
          {colorWheelOpen ? (
            <div className="rounded border border-[#6f5f45] bg-[#e6d5b1] px-2 py-2">
              <div className="flex justify-center">
                <div
                  ref={colorWheelRef}
                  onPointerDown={startColorWheelDrag}
                  className="relative h-24 w-24 cursor-pointer rounded-full shadow-[inset_0_2px_4px_rgba(255,255,255,0.25),inset_0_-5px_8px_rgba(0,0,0,0.28)]"
                  style={{
                    background:
                      "conic-gradient(#ff4040, #ff8a00, #ffe100, #62e800, #00d6ff, #4f66ff, #b64cff, #ff40a6, #ff4040)",
                    transform: "perspective(420px) rotateX(54deg)",
                  }}
                  title="Rotate around the wheel to choose marker color."
                >
                  <div className="absolute inset-[21px] rounded-full border border-[#8f7a59] bg-[#d8c49a]" />
                  <div
                    className="absolute left-1/2 top-1/2 h-3.5 w-3.5 rounded-full border border-[#251a12] shadow"
                    style={{
                      backgroundColor: activeHighlightSolidColor,
                      transform: `translate(-50%, -50%) rotate(${knobAngle}) translateY(-40px) rotate(-${knobAngle})`,
                    }}
                  />
                </div>
              </div>
            </div>
          ) : null}
          <p className="text-[11px] text-[#3c3021]">Bring a sheet to top layer, then draw to highlight.</p>
        </div>
      );
    }

    if (toolId === "eraser") {
      return (
        <div className="h-full space-y-3" data-no-markup="true">
          <div className="rounded border border-[#6d5a3f] bg-[#e0d4be] px-2 py-2 text-center text-xs font-semibold uppercase tracking-[0.08em] text-[#3b2f1e]">
            Precision Eraser
          </div>
          <button
            type="button"
            onClick={() => setMarkupMode((current) => (current === "erase" ? "none" : "erase"))}
            className={`w-full rounded border px-2 py-2 text-xs font-bold uppercase tracking-[0.08em] ${
              markupMode === "erase"
                ? "border-[#8f2d2d] bg-[#e8adad] text-[#3f1010]"
                : "border-[#745f42] bg-[#ccb78e] text-[#2a2117]"
            }`}
          >
            {markupMode === "erase" ? "Turn Off Eraser" : "Activate Eraser"}
          </button>
          <button
            type="button"
            onClick={() => setMarkupMode("none")}
            className="w-full rounded border border-[#745f42] bg-[#b9a27a] px-2 py-2 text-xs font-bold uppercase tracking-[0.08em] text-[#2a2117]"
          >
            Pointer Mode
          </button>
          <p className="text-[11px] text-[#3c3021]">Erases highlights on the top document/tool only.</p>
        </div>
      );
    }

    return (
      <div className="space-y-3 text-xs text-[#2e2419]" data-no-markup="true">
        <label className="space-y-1">
          <span className="uppercase tracking-[0.1em]">Category</span>
          <select
            value={converterCategory}
            onChange={(event) => setConverterCategory(event.target.value as (typeof unitCategories)[number])}
            className="w-full rounded border border-[#6f5f47] bg-[#f0e4c9] px-2 py-1"
          >
            {unitCategories.map((category) => (
              <option key={`category-${category}`} value={category}>
                {category}
              </option>
            ))}
          </select>
        </label>

        <div className="grid grid-cols-2 gap-2">
          <label className="space-y-1">
            <span className="uppercase tracking-[0.1em]">From</span>
            <select
              value={fromUnit}
              onChange={(event) => setFromUnit(event.target.value)}
              className="w-full rounded border border-[#6f5f47] bg-[#f0e4c9] px-2 py-1"
            >
              {converterUnits.map((unit) => (
                <option key={`from-${unit.key}`} value={unit.key}>
                  {unit.label}
                </option>
              ))}
            </select>
          </label>
          <label className="space-y-1">
            <span className="uppercase tracking-[0.1em]">To</span>
            <select
              value={toUnit}
              onChange={(event) => setToUnit(event.target.value)}
              className="w-full rounded border border-[#6f5f47] bg-[#f0e4c9] px-2 py-1"
            >
              {converterUnits.map((unit) => (
                <option key={`to-${unit.key}`} value={unit.key}>
                  {unit.label}
                </option>
              ))}
            </select>
          </label>
        </div>

        <label className="space-y-1">
          <span className="uppercase tracking-[0.1em]">Value</span>
          <input
            type="number"
            value={converterInput}
            onChange={(event) => setConverterInput(event.target.value)}
            className="w-full rounded border border-[#6f5f47] bg-[#f0e4c9] px-2 py-2"
          />
        </label>

        <div className="rounded border border-[#6f5f47] bg-[#eaddbf] px-2 py-2 text-sm font-semibold">
          Result: {converterOutput}
        </div>
      </div>
    );
  }

  function renderQuestion(question: QuizQuestion): React.ReactNode {
    const value = answers[question.id];

    if (
      question.kind === "multiple-choice" ||
      question.kind === "multiple-choice-text" ||
      question.kind === "true-false"
    ) {
      const options = question.kind === "true-false" ? ["true", "false"] : question.options ?? [];
      return (
        <div className="space-y-2">
          {options.map((option) => (
            <label key={`${question.id}-${option}`} className="flex items-center gap-2 text-sm text-[#dbcfae]">
              <input
                type="radio"
                name={question.id}
                checked={value === option}
                onChange={() => setAnswer(question.id, option)}
              />
              {option}
            </label>
          ))}
        </div>
      );
    }

    if (question.kind === "multiple-response") {
      return (
        <div className="space-y-2">
          {(question.options ?? []).map((option) => {
            const selected = Array.isArray(value) && value.includes(option);
            return (
              <label key={`${question.id}-${option}`} className="flex items-center gap-2 text-sm text-[#dbcfae]">
                <input
                  type="checkbox"
                  checked={selected}
                  onChange={() => toggleMulti(question.id, option)}
                />
                {option}
              </label>
            );
          })}
        </div>
      );
    }

    if (question.kind === "match") {
      const current =
        value && typeof value === "object" && !Array.isArray(value)
          ? (value as Record<string, string>)
          : {};
      return (
        <div className="space-y-2">
          {(question.matchLeft ?? []).map((left) => (
            <div key={`${question.id}-${left}`} className="flex items-center gap-2">
              <span className="w-20 text-xs text-[#d1c39b]">{left}</span>
              <select
                value={current[left] ?? ""}
                onChange={(event) => setMatch(question.id, left, event.target.value)}
                className="w-full rounded border border-[#756244] bg-[#1d1812] px-2 py-1 text-sm text-[#f0e7cf]"
              >
                <option value="">Select</option>
                {(question.matchRight ?? []).map((right) => (
                  <option key={`${question.id}-${left}-${right}`} value={right}>
                    {right}
                  </option>
                ))}
              </select>
            </div>
          ))}
        </div>
      );
    }

    if (question.kind === "sequence") {
      const sequence = getSequence(question);
      return (
        <div className="rounded border border-[#62523c] bg-[#201812] p-2">
          {sequence.map((step, index) => (
            <div key={`${question.id}-sequence-row-${step}-${index}`} className="mb-1 flex items-center gap-2">
              <span className="w-5 text-right text-xs font-semibold text-[#bda67d]">{index + 1}</span>
              <div className="flex-1 rounded border border-[#6f5f45] bg-[#1a1510] px-2 py-2 text-xs text-[#dbcfae]">
                {step}
              </div>
              <button
                type="button"
                onClick={() => moveSequenceItem(question.id, index, index - 1)}
                disabled={index === 0}
                className="h-7 w-7 rounded border border-[#7a6748] bg-[#2a1e15] text-[11px] text-[#d7c8a7] disabled:opacity-35"
                aria-label={`Move item ${index + 1} up`}
              >
                ↑
              </button>
              <button
                type="button"
                onClick={() => moveSequenceItem(question.id, index, index + 1)}
                disabled={index === sequence.length - 1}
                className="h-7 w-7 rounded border border-[#7a6748] bg-[#2a1e15] text-[11px] text-[#d7c8a7] disabled:opacity-35"
                aria-label={`Move item ${index + 1} down`}
              >
                ↓
              </button>
            </div>
          ))}
        </div>
      );
    }

    if (question.kind === "document-upload") {
      const selected = isDocumentDropAnswer(value) ? value : null;
      return (
        <div className="space-y-2">
          <div
            data-no-markup="true"
            onDragOver={(event) => {
              event.preventDefault();
              event.dataTransfer.dropEffect = "copy";
            }}
            onDrop={(event) => {
              event.preventDefault();
              const docId = parseDraggedDocId(event.dataTransfer);
              if (!docId) {
                return;
              }
              const doc = visibleDocById[docId] ?? allDocById.get(docId);
              if (!doc || doc.type !== "image" || !doc.imageSrc) {
                return;
              }
              const highlightKey = `doc:${doc.id}`;
              const highlights = strokesByItem[highlightKey] ?? [];
              const item = placed[highlightKey];
              const containerWidth = Math.max(1, item?.width ?? doc.width ?? 340);
              const containerHeight = Math.max(1, (item?.height ?? doc.height ?? 260) - 38);
              setDocumentDropLoadingQuestionId(question.id);
              void (async () => {
                const compositedImageDataUrl = await composeDocumentWithHighlights(
                  doc,
                  highlights,
                  containerWidth,
                  containerHeight
                );
                const answer: DocumentDropAnswer = {
                  type: "document-drop",
                  docId: doc.id,
                  title: doc.title,
                  imageSrc: doc.imageSrc,
                  compositedImageDataUrl,
                  droppedAt: new Date().toISOString(),
                  highlights,
                };
                setAnswer(question.id, answer);
                setDraggingDocId("");
                setDocumentDropLoadingQuestionId((current) => (current === question.id ? "" : current));
              })();
            }}
            className={`rounded border border-dashed px-3 py-4 text-xs ${
              draggingDocId
                ? "border-[#d6b774] bg-[#3a2a1d] text-[#f2deae]"
                : "border-[#7a6748] bg-[#19120d] text-[#cfbc94]"
            }`}
          >
            {documentDropLoadingQuestionId === question.id
              ? "Applying highlights to image..."
              : "Drag a highlighted image document from the desk and drop it here."}
          </div>
          <div className="rounded border border-[#6d5b44] bg-[#1a140f] px-2 py-2 text-xs text-[#d5c59f]">
            {selected ? (
              <>
                <p>Selected image: {selected.title}</p>
                <p>Captured highlights: {selected.highlights.length}</p>
                {selected.compositedImageDataUrl || selected.imageSrc ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={selected.compositedImageDataUrl ?? selected.imageSrc}
                    alt={selected.title}
                    className="mt-2 max-h-28 w-full rounded border border-[#6d5b44] object-contain"
                  />
                ) : null}
              </>
            ) : (
              <p>No image selected yet.</p>
            )}
          </div>
        </div>
      );
    }

    if (
      question.kind === "essay" ||
      question.kind === "interview" ||
      question.kind === "assignment" ||
      question.kind === "flashcard"
    ) {
      return (
        <textarea
          value={typeof value === "string" ? value : ""}
          onChange={(event) => setAnswer(question.id, event.target.value)}
          className="h-24 w-full rounded border border-[#6f5f45] bg-[#1a1510] p-2 text-sm text-[#f0e7cf] outline-none"
        />
      );
    }

    return (
      <input
        type="text"
        value={typeof value === "string" ? value : ""}
        onChange={(event) => setAnswer(question.id, event.target.value)}
        className="w-full rounded border border-[#6f5f45] bg-[#1a1510] px-2 py-2 text-sm text-[#f0e7cf] outline-none"
      />
    );
  }

  return (
    <div className="font-body min-h-screen bg-[#271b16] text-[#efe3c4]">
      <header className="flex h-16 items-center justify-between border-b border-[#5e4d39] bg-[#1c1410] px-4">
        <div>
          <p className="text-[10px] uppercase tracking-[0.24em] text-[#c7b589]">Inspection Desk Simulator</p>
          <h1 className="font-title text-3xl uppercase tracking-[0.08em] text-[#f2e7c9]">{data.title}</h1>
        </div>
        <div className="flex items-end gap-4">
          <label className="flex flex-col text-[11px] uppercase tracking-[0.1em] text-[#c9b992]">
            User ID
            <input
              value={userId}
              onChange={(event) => setUserId(event.target.value)}
              placeholder="student_01"
              className="mt-1 w-44 rounded border border-[#68543c] bg-[#241912] px-2 py-1 text-sm text-[#f3e8ca] outline-none"
            />
          </label>
          <div className="text-xs text-[#decfa9]">
            <p>
              Turn: {Math.min(turnIndex + 1, totalTurns)}/{totalTurns}
            </p>
            <p>Status: {finished ? "Submitted" : "In Progress"}</p>
          </div>
        </div>
      </header>

      <main className="grid h-[calc(100vh-64px)] grid-rows-[58vh_1fr] lg:grid-cols-[minmax(0,1fr)_430px] lg:grid-rows-1">
        <section
          ref={boardRef}
          className="relative overflow-hidden border-r border-[#5e4d39] bg-[#6f5037]"
          style={{
            backgroundImage:
              "radial-gradient(circle at 20% 30%, rgba(255,255,255,0.08), transparent 40%), repeating-linear-gradient(45deg, rgba(0,0,0,0.09) 0px, rgba(0,0,0,0.09) 1px, transparent 1px, transparent 8px)",
          }}
        >
          <div className="pointer-events-none absolute left-0 top-0 bottom-0 w-8 border-r border-[#3a2c21] bg-[#32241b]" />
          <div className="pointer-events-none absolute left-0 right-0 bottom-0 h-7 border-t border-[#3a2c21] bg-[#32241b]" />
          <div className="pointer-events-none absolute right-2 top-2 rounded border border-[#5f4b34] bg-[#2a2017]/90 px-2 py-1 text-[10px] uppercase tracking-[0.08em] text-[#d9c69f]">
            Markup: {markupMode === "none" ? "Pointer" : markupMode}
          </div>
          {toolCursor ? (
            <div
              className="pointer-events-none fixed z-[2300]"
              style={{ left: toolCursor.x, top: toolCursor.y, transform: "translate(-50%, -50%)" }}
            >
              {toolCursor.mode === "highlight" ? (
                <div className="flex h-8 w-8 items-center justify-center rounded-full border border-[#5d2020] shadow-[0_0_0_2px_rgba(39,27,22,0.35)]" style={{ backgroundColor: activeHighlightSolidColor }}>
                  <svg viewBox="0 0 16 16" className="h-4 w-4 text-[#2d0f0f]" fill="currentColor" aria-hidden>
                    <path d="M3 12.5 2.5 14l1.5-.5L11.8 5.7 10.3 4.2 3 11.5zM11 3.5l1.5-1.5 1 1L12 4.5z" />
                  </svg>
                </div>
              ) : (
                <div className="flex h-8 w-8 items-center justify-center rounded-full border border-[#8e4d4d] bg-[#e6b0b0]/95 shadow-[0_0_0_2px_rgba(39,27,22,0.35)]">
                  <svg viewBox="0 0 16 16" className="h-4 w-4 text-[#4b2020]" fill="currentColor" aria-hidden>
                    <path d="M2 10.5 6.8 5.7 10.3 9.2 5.5 14H2v-3.5zm8.9-6.9 1.6-1.6 1.5 1.5-1.6 1.6-1.5-1.5zM7.9 11h5.6v1.5H6.4L7.9 11z" />
                  </svg>
                </div>
              )}
            </div>
          ) : null}

          {visibleDocs.map((doc) => {
            const key = `doc:${doc.id}`;
            const item = placed[key];
            if (!item) {
              return null;
            }

            return (
              <article
                key={key}
                className="absolute rounded-md border border-[#574733] bg-[#d9c69f] shadow-[0_8px_18px_rgba(0,0,0,0.35)]"
                style={{
                  left: item.x,
                  top: item.y,
                  width: item.width,
                  height: item.height,
                  zIndex: item.z,
                  animationName:
                    item.introFrom === "left"
                      ? "quizSlideInFromLeft"
                      : item.introFrom === "bottom"
                        ? "quizSlideInFromBottom"
                        : "none",
                  animationDuration: item.introFrom ? "420ms" : "0ms",
                  animationTimingFunction: "ease-out",
                  animationFillMode: "both",
                  animationDelay: item.introDelayMs ? `${item.introDelayMs}ms` : "0ms",
                }}
                onPointerDown={() => bringToFront(key)}
              >
                <div
                  className="flex h-[38px] cursor-grab items-center justify-between border-b border-[#8c7a5f] bg-[#bca880] px-2 active:cursor-grabbing"
                  onPointerDown={(event) => startDrag(event, key)}
                >
                  <span className="font-title truncate text-xl uppercase tracking-[0.06em] text-[#3a2f22]">
                    {doc.title}
                  </span>
                  <span className="text-[10px] font-bold uppercase text-[#5a4a36]">{doc.type}</span>
                </div>
                <div className="relative h-[calc(100%-38px)]">
                  <div
                    className={
                      doc.type === "image"
                        ? "h-full overflow-hidden"
                        : "quiz-scroll h-full overflow-auto p-2"
                    }
                  >
                    {renderDocument(doc)}
                  </div>
                  <div
                    className={`absolute inset-0 ${
                      markupMode !== "none" && topLayerKey === key ? "pointer-events-auto" : "pointer-events-none"
                    }`}
                    onPointerDown={(event) => startMarkup(event, key)}
                    style={{ touchAction: "none" }}
                  >
                    <svg className="h-full w-full" viewBox="0 0 1 1" preserveAspectRatio="none">
                      {(strokesByItem[key] ?? []).map((stroke) => (
                        <path
                          key={stroke.id}
                          d={buildStrokePath(stroke)}
                          fill="none"
                          stroke={stroke.color}
                          strokeWidth={stroke.width / Math.max(item.width, 1)}
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        />
                      ))}
                    </svg>
                  </div>
                </div>
                <button
                  type="button"
                  onPointerDown={(event) => startResize(event, key)}
                  className="absolute bottom-0 right-0 flex h-5 w-5 cursor-nwse-resize items-end justify-end rounded-tl border-l border-t border-[#73634b] bg-[#cbb88f]"
                  title="Resize"
                >
                  <span className="pointer-events-none h-0 w-0 border-b-[10px] border-l-[10px] border-b-[#604f37] border-l-transparent" />
                </button>
              </article>
            );
          })}

          {tools.map((tool) => {
            const key = `tool:${tool.id}`;
            const item = placed[key];
            if (!item) {
              return null;
            }
            const isMarkupDisabledTool = tool.id === "highlighter" || tool.id === "eraser";

            return (
              <article
                key={key}
                className="absolute rounded-md border border-[#403322] bg-[#ad936c] shadow-[0_8px_18px_rgba(0,0,0,0.35)]"
                style={{
                  left: item.x,
                  top: item.y,
                  width: item.width,
                  height: item.height,
                  zIndex: item.z,
                  animationName:
                    item.introFrom === "left"
                      ? "quizSlideInFromLeft"
                      : item.introFrom === "bottom"
                        ? "quizSlideInFromBottom"
                        : "none",
                  animationDuration: item.introFrom ? "420ms" : "0ms",
                  animationTimingFunction: "ease-out",
                  animationFillMode: "both",
                  animationDelay: item.introDelayMs ? `${item.introDelayMs}ms` : "0ms",
                }}
                onPointerDown={() => bringToFront(key)}
              >
                <div
                  className="flex h-[38px] cursor-grab items-center justify-between border-b border-[#6c5a43] bg-[#8e7858] px-2 active:cursor-grabbing"
                  onPointerDown={(event) => startDrag(event, key)}
                >
                  <span className="font-title truncate text-xl uppercase tracking-[0.06em] text-[#f2e6c7]">
                    {tool.title}
                  </span>
                  <span className="text-[10px] uppercase text-[#e4d8ba]">tool</span>
                </div>
                <div className="relative h-[calc(100%-38px)]">
                  <div className="quiz-scroll h-full overflow-auto p-2">{renderTool(tool.id)}</div>
                  <div
                    className={`absolute inset-0 ${
                      !isMarkupDisabledTool && markupMode !== "none" && topLayerKey === key
                        ? "pointer-events-auto"
                        : "pointer-events-none"
                    }`}
                    onPointerDown={(event) => startMarkup(event, key)}
                    style={{ touchAction: "none" }}
                  >
                    <svg className="h-full w-full" viewBox="0 0 1 1" preserveAspectRatio="none">
                      {(strokesByItem[key] ?? []).map((stroke) => (
                        <path
                          key={stroke.id}
                          d={buildStrokePath(stroke)}
                          fill="none"
                          stroke={stroke.color}
                          strokeWidth={stroke.width / Math.max(item.width, 1)}
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        />
                      ))}
                    </svg>
                  </div>
                </div>
                <button
                  type="button"
                  onPointerDown={(event) => startResize(event, key)}
                  className="absolute bottom-0 right-0 flex h-5 w-5 cursor-nwse-resize items-end justify-end rounded-tl border-l border-t border-[#5f4f3a] bg-[#9f8865]"
                  title="Resize"
                >
                  <span className="pointer-events-none h-0 w-0 border-b-[10px] border-l-[10px] border-b-[#e5d8b7] border-l-transparent" />
                </button>
              </article>
            );
          })}
        </section>

        <aside className="quiz-scroll overflow-y-auto bg-[#17110e] px-4 py-4">
          {!finished ? (
            <>
              <div className="mb-4 rounded border border-[#5d4e3b] bg-[#231915] p-3">
                <p className="text-[10px] uppercase tracking-[0.18em] text-[#b9a57f]">{turn.label}</p>
                <p className="mt-1 text-sm text-[#ebdfc1]">{turn.briefing}</p>
                <p className="mt-1 text-xs text-[#cdbd98]">Turn marks: {turnTotalMarks}</p>
              </div>

              <div className="space-y-3">
                {turn.questions.map((question) => (
                  <section key={question.id} className="rounded border border-[#5d4e3b] bg-[#221914] p-3">
                    <div className="mb-2 flex items-start justify-between gap-3">
                      <h2 className="text-sm text-[#f2e6c9]">{question.prompt}</h2>
                      <span className="shrink-0 text-xs text-[#bda97f]">{question.marks} pts</span>
                    </div>
                    {renderQuestion(question)}
                  </section>
                ))}
              </div>

              {errorMessage ? <p className="mt-3 text-sm text-[#d8796a]">{errorMessage}</p> : null}

              <button
                type="button"
                onClick={() => void endTurn()}
                disabled={submitting}
                className="mt-4 w-full rounded border border-[#7f6748] bg-[#8e734e] px-4 py-2 text-sm font-bold text-[#1e160f] disabled:opacity-40"
              >
                {submitting ? "Submitting..." : turnIndex >= totalTurns - 1 ? "Submit Quiz" : "End Turn"}
              </button>
            </>
          ) : (
            <div className="rounded border border-[#5f4f3a] bg-[#231915] p-4">
              <h2 className="font-title text-3xl uppercase tracking-[0.06em] text-[#f2e6c8]">Submission Complete</h2>
              <p className="mt-2 text-sm text-[#d6c8a4]">User: {userId}</p>
              <p className="text-sm text-[#d6c8a4]">Submission ID: {submissionId}</p>
              <p className="mt-2 text-sm text-[#d6c8a4]">Your answers are saved for manual teacher grading.</p>
              <div className="mt-3 flex gap-2">
                <Link
                  href="/quiz"
                  className="rounded border border-[#7f6748] bg-[#8e734e] px-3 py-2 text-xs font-semibold text-[#1e160f]"
                >
                  Start New Attempt
                </Link>
                <Link
                  href="/quiz/review"
                  className="rounded border border-[#7f6748] bg-[#d6c49b] px-3 py-2 text-xs font-semibold text-[#24170f]"
                >
                  Open Teacher Review
                </Link>
              </div>
            </div>
          )}

        </aside>
      </main>

      {turnModalOpen ? (
        <div className="fixed inset-0 z-[2200] flex items-center justify-center bg-black/60 p-4">
          <div className="w-full max-w-xl rounded border border-[#6d5c45] bg-[#1b1410] p-4">
            <h2 className="font-title text-3xl uppercase tracking-[0.08em] text-[#f0e3c3]">{turn.label} Complete</h2>
            <p className="mt-2 text-sm text-[#d0c09a]">All responses for this turn are saved in session.</p>
            <button
              type="button"
              onClick={moveToNextTurn}
              className="mt-4 w-full rounded border border-[#81674a] bg-[#95754f] px-4 py-2 text-sm font-bold text-[#1f160f]"
            >
              Start Next Turn
            </button>
          </div>
        </div>
      ) : null}

      <style jsx global>{`
        .quiz-scroll {
          scrollbar-width: thin;
          scrollbar-color: #8f7756 #2a2017;
        }

        .quiz-scroll::-webkit-scrollbar {
          width: 10px;
          height: 10px;
        }

        .quiz-scroll::-webkit-scrollbar-track {
          background: #2a2017;
        }

        .quiz-scroll::-webkit-scrollbar-thumb {
          background: #8f7756;
          border-radius: 999px;
          border: 2px solid #2a2017;
        }

        .quiz-scroll-light {
          scrollbar-width: thin;
          scrollbar-color: #9b8260 #ebddbf;
        }

        .quiz-scroll-light::-webkit-scrollbar {
          width: 10px;
          height: 10px;
        }

        .quiz-scroll-light::-webkit-scrollbar-track {
          background: #ebddbf;
        }

        .quiz-scroll-light::-webkit-scrollbar-thumb {
          background: #9b8260;
          border-radius: 999px;
          border: 2px solid #ebddbf;
        }

        @keyframes quizSlideInFromLeft {
          0% {
            opacity: 0;
            transform: translateX(-120px);
          }
          100% {
            opacity: 1;
            transform: translateX(0);
          }
        }

        @keyframes quizSlideInFromBottom {
          0% {
            opacity: 0;
            transform: translateY(120px);
          }
          100% {
            opacity: 1;
            transform: translateY(0);
          }
        }

      `}</style>
    </div>
  );
}
