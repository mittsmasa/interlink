"use client";

import { createContext, useContext } from "react";

/**
 * 検証パネルやループバッジの hover 中に強調するノード/エッジの集合。
 * null は「強調なし（全要素を通常表示）」。
 */
export type Highlight = {
  nodeIds: ReadonlySet<string>;
  edgeIds: ReadonlySet<string>;
} | null;

export const HighlightContext = createContext<Highlight>(null);

export function useHighlight(): Highlight {
  return useContext(HighlightContext);
}
