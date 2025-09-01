"use client";

import { useEffect } from "react";
import { useDiagramStore } from "@/store/diagram";

export function useKeyboardShortcuts() {
  const {
    undo,
    redo,
    copy,
    paste,
    canUndo,
    canRedo,
    removeElement,
    clearSelection,
    getSelectedElements,
  } = useDiagramStore();

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // モディファイヤキーの組み合わせ
      const isCtrlOrCmd = e.ctrlKey || e.metaKey;
      const isShift = e.shiftKey;
      const _isAlt = e.altKey;

      // 入力フィールドにフォーカスがある場合はスキップ
      if (
        document.activeElement &&
        (document.activeElement.tagName === "INPUT" ||
          document.activeElement.tagName === "TEXTAREA" ||
          (document.activeElement as HTMLElement).contentEditable === "true")
      ) {
        return;
      }

      // Ctrl/Cmd + Z: Undo
      if (isCtrlOrCmd && !isShift && e.key === "z" && canUndo()) {
        e.preventDefault();
        undo();
        return;
      }

      // Ctrl/Cmd + Shift + Z or Ctrl/Cmd + Y: Redo
      if (
        ((isCtrlOrCmd && isShift && e.key === "z") ||
          (isCtrlOrCmd && e.key === "y")) &&
        canRedo()
      ) {
        e.preventDefault();
        redo();
        return;
      }

      // Ctrl/Cmd + C: Copy
      if (isCtrlOrCmd && e.key === "c") {
        const selectedElements = getSelectedElements();
        if (selectedElements.length > 0) {
          e.preventDefault();
          copy();
        }
        return;
      }

      // Ctrl/Cmd + V: Paste
      if (isCtrlOrCmd && e.key === "v") {
        e.preventDefault();
        paste();
        return;
      }

      // Delete or Backspace: Delete selected elements
      if ((e.key === "Delete" || e.key === "Backspace") && !isCtrlOrCmd) {
        const selectedElements = getSelectedElements();
        if (selectedElements.length > 0) {
          e.preventDefault();
          selectedElements.forEach((element) => {
            removeElement(element.id);
          });
        }
        return;
      }

      // Escape: Clear selection
      if (e.key === "Escape") {
        e.preventDefault();
        clearSelection();
        return;
      }

      // Ctrl/Cmd + A: Select all (将来の実装用)
      if (isCtrlOrCmd && e.key === "a") {
        e.preventDefault();
        // TODO: 全選択機能を実装
        console.log("Select all (not implemented yet)");
        return;
      }
    };

    const handleKeyUp = (_e: KeyboardEvent) => {
      // 必要に応じてキーアップイベントを処理
    };

    document.addEventListener("keydown", handleKeyDown);
    document.addEventListener("keyup", handleKeyUp);

    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      document.removeEventListener("keyup", handleKeyUp);
    };
  }, [
    undo,
    redo,
    copy,
    paste,
    canUndo,
    canRedo,
    removeElement,
    clearSelection,
    getSelectedElements,
  ]);
}
