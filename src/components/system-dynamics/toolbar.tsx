"use client";

import { Minus, MousePointer2, Move, Plus } from "lucide-react";

export type ToolMode =
  | "select"
  | "add-stock"
  | "add-flow"
  | "add-connector"
  | "connect"
  | "delete";

interface ToolbarProps {
  currentTool: ToolMode;
  onToolChange: (tool: ToolMode) => void;
}

export function Toolbar({ currentTool, onToolChange }: ToolbarProps) {
  const tools = [
    { id: "select" as ToolMode, icon: MousePointer2, label: "選択" },
    { id: "add-stock" as ToolMode, icon: Plus, label: "ストック追加" },
    { id: "add-flow" as ToolMode, icon: Move, label: "フロー追加" },
    { id: "add-connector" as ToolMode, icon: Plus, label: "コネクタ追加" },
    { id: "connect" as ToolMode, icon: Minus, label: "接続線" },
    { id: "delete" as ToolMode, icon: Minus, label: "削除" },
  ];

  return (
    <div className="flex flex-col space-y-2 p-4">
      <div className="text-sm font-medium text-gray-700 mb-2">ツール</div>
      {tools.map((tool) => {
        const Icon = tool.icon;
        return (
          <button
            key={tool.id}
            type="button"
            onClick={() => onToolChange(tool.id)}
            className={`flex items-center space-x-2 px-3 py-2 text-sm rounded-md transition-colors ${
              currentTool === tool.id
                ? "bg-blue-100 text-blue-700 border border-blue-300"
                : "text-gray-600 hover:bg-gray-100 border border-transparent"
            }`}
          >
            <Icon size={16} />
            <span>{tool.label}</span>
          </button>
        );
      })}

      <div className="mt-4 text-xs text-gray-500">
        <div className="mb-1">キーボード:</div>
        <div>Ctrl+Z: アンドゥ</div>
        <div>Ctrl+Y: リドゥ</div>
        <div>Ctrl+C: コピー</div>
        <div>Ctrl+V: ペースト</div>
        <div>Delete: 削除</div>
      </div>
    </div>
  );
}
