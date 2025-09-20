"use client";

import {
  ArrowRight,
  Circle,
  Cloud,
  Info,
  Link,
  MousePointer2,
  Square,
  TestTube,
  Trash2,
} from "lucide-react";
import { type ToolMode, useUIStore } from "@/store/ui";

export function Toolbar() {
  const {
    currentTool,
    setCurrentTool,
    isDebugInfoVisible,
    toggleDebugInfo,
    togglePerformanceTest,
  } = useUIStore();

  const tools: Array<{
    id: ToolMode;
    icon: typeof MousePointer2;
    label: string;
  }> = [
    { id: "select", icon: MousePointer2, label: "選択" },
    { id: "add-stock", icon: Square, label: "ストック追加" },
    { id: "add-flow", icon: ArrowRight, label: "フロー追加" },
    { id: "add-connector", icon: Circle, label: "補助変数追加" },
    { id: "add-cloud", icon: Cloud, label: "雲追加" },
    { id: "connect", icon: Link, label: "接続線" },
    { id: "delete", icon: Trash2, label: "削除" },
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
            onClick={() => setCurrentTool(tool.id)}
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

      {/* デバッグ・パフォーマンス機能 */}
      <div className="mt-4 pt-4 border-t border-gray-200">
        <div className="text-sm font-medium text-gray-700 mb-2">デバッグ</div>

        <button
          type="button"
          onClick={toggleDebugInfo}
          className={`flex items-center space-x-2 px-3 py-2 text-sm rounded-md transition-colors w-full ${
            isDebugInfoVisible
              ? "bg-green-100 text-green-700 border border-green-300"
              : "text-gray-600 hover:bg-gray-100 border border-transparent"
          }`}
        >
          <Info size={16} />
          <span>デバッグ情報</span>
        </button>

        <button
          type="button"
          onClick={togglePerformanceTest}
          className="flex items-center space-x-2 px-3 py-2 text-sm rounded-md transition-colors w-full text-gray-600 hover:bg-gray-100 border border-transparent mt-1"
        >
          <TestTube size={16} />
          <span>パフォーマンス</span>
        </button>
      </div>

      <div className="mt-4 text-xs text-gray-500">
        <div className="mb-1">キーボード:</div>
        <div>Ctrl+Z: アンドゥ</div>
        <div>Ctrl+Y: リドゥ</div>
        <div>Ctrl+C: コピー</div>
        <div>Ctrl+V: ペースト</div>
        <div>Delete: 削除</div>
        <div>Escape: 選択解除</div>
      </div>
    </div>
  );
}
