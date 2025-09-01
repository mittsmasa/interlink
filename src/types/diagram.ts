export interface Position {
  x: number;
  y: number;
}

export interface Size {
  width: number;
  height: number;
}

export type ElementType = "stock" | "flow" | "connector" | "cloud";

export interface DiagramElement {
  id: string;
  type: ElementType;
  position: Position;
  size: Size;
  label: string;
  value: number;
  color?: string;
  selected?: boolean;
}

export interface DiagramConnection {
  id: string;
  sourceId: string;
  targetId: string;
  type: "flow" | "connector";
  points?: Position[];
  label?: string;
}

export interface DiagramState {
  elements: DiagramElement[];
  connections: DiagramConnection[];
  selectedElementIds: string[];
  history: DiagramSnapshot[];
  historyIndex: number;
  clipboard: {
    elements: DiagramElement[];
    connections: DiagramConnection[];
  } | null;
}

export interface DiagramSnapshot {
  elements: DiagramElement[];
  connections: DiagramConnection[];
  timestamp: number;
}
