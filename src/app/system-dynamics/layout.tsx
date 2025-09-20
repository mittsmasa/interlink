import type { ReactNode } from "react";
import { Toolbar } from "@/components/system-dynamics/toolbar";

export default function SystemDynamicsLayout({
  children,
}: {
  children: ReactNode;
}) {
  return (
    <div className="flex h-screen bg-gray-50">
      <aside className="w-64 bg-white shadow-sm border-r border-gray-200">
        <div className="p-4 border-b border-gray-200">
          <h2 className="text-lg font-semibold text-gray-900">
            システムダイナミクス
          </h2>
        </div>
        <nav className="flex-1 overflow-y-auto">
          <Toolbar />
        </nav>
      </aside>
      <main className="flex-1 flex flex-col">
        <header className="h-16 bg-white border-b border-gray-200 flex items-center justify-between px-6">
          <div className="flex items-center space-x-4">
            <h1 className="text-xl font-semibold text-gray-900">
              システムダイナミクスモデラー
            </h1>
          </div>
          <div className="flex items-center space-x-2">
            <button
              type="button"
              className="px-3 py-2 text-sm bg-blue-600 text-white rounded-md hover:bg-blue-700"
            >
              保存
            </button>
            <button
              type="button"
              className="px-3 py-2 text-sm border border-gray-300 rounded-md hover:bg-gray-50"
            >
              エクスポート
            </button>
          </div>
        </header>
        <div className="flex-1">{children}</div>
      </main>
    </div>
  );
}
