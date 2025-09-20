"use client";

import { AlertCircle, BarChart3, Play, Square } from "lucide-react";
import { useState } from "react";
import {
  formatPerformanceResult,
  generateTestConnections,
  generateTestElements,
  type PerformanceMetrics,
  PerformanceMonitor,
  type PerformanceTestResult,
  runPerformanceTest,
} from "@/lib/utils/performance";
import { useDiagramStore } from "@/store/diagram";

interface PerformanceTestPanelProps {
  isVisible: boolean;
  onClose: () => void;
}

export function PerformanceTestPanel({
  isVisible,
  onClose,
}: PerformanceTestPanelProps) {
  const [isRunning, setIsRunning] = useState(false);
  const [currentMetrics, setCurrentMetrics] =
    useState<PerformanceMetrics | null>(null);
  const [testResults, setTestResults] = useState<PerformanceTestResult[]>([]);
  const [elementCount, setElementCount] = useState(1000);
  const [testDuration, setTestDuration] = useState(10000);

  const { addElement, addConnection, clear } = useDiagramStore();

  const handleQuickTest = async () => {
    if (isRunning) return;

    setIsRunning(true);
    setCurrentMetrics(null);

    try {
      // テスト要素を生成してストアに追加
      const elements = generateTestElements(elementCount);
      const connections = generateTestConnections(elements);

      // 既存の要素をクリア
      clear();

      // 要素を追加
      for (const element of elements) {
        addElement(element);
      }
      for (const connection of connections) {
        addConnection(connection);
      }

      // パフォーマンステストを実行
      const result = await runPerformanceTest(
        `${elementCount}要素パフォーマンステスト`,
        elementCount,
        testDuration,
      );

      setTestResults((prev) => [result, ...prev.slice(0, 4)]); // 最新5件まで保持

      console.log(formatPerformanceResult(result));
    } catch (error) {
      console.error("パフォーマンステストエラー:", error);
    } finally {
      setIsRunning(false);
    }
  };

  const handleRealTimeMonitoring = () => {
    if (isRunning) return;

    setIsRunning(true);
    const monitor = new PerformanceMonitor();

    monitor.start();

    const updateInterval = setInterval(() => {
      const metrics = monitor.getCurrentMetrics();
      if (metrics) {
        setCurrentMetrics(metrics);
      }

      if (!monitor.isPerformanceAcceptable()) {
        console.warn("パフォーマンスが低下しています");
      }
    }, 100);

    // 30秒後に停止
    setTimeout(() => {
      monitor.stop();
      clearInterval(updateInterval);
      setIsRunning(false);
    }, 30000);
  };

  const handleStopTest = () => {
    setIsRunning(false);
    setCurrentMetrics(null);
  };

  const handleClearResults = () => {
    setTestResults([]);
    clear();
  };

  if (!isVisible) return null;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg p-6 w-full max-w-4xl max-h-[90vh] overflow-y-auto">
        <div className="flex justify-between items-center mb-6">
          <h2 className="text-xl font-semibold text-gray-900">
            パフォーマンステスト
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600"
          >
            ✕
          </button>
        </div>

        {/* テスト設定 */}
        <div className="mb-6 p-4 bg-gray-50 rounded-lg">
          <h3 className="text-lg font-medium mb-4">テスト設定</h3>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label
                htmlFor="element-count"
                className="block text-sm font-medium text-gray-700 mb-2"
              >
                要素数
              </label>
              <input
                id="element-count"
                type="number"
                value={elementCount}
                onChange={(e) => setElementCount(Number(e.target.value))}
                min={100}
                max={5000}
                step={100}
                className="w-full px-3 py-2 border border-gray-300 rounded-md"
                disabled={isRunning}
              />
            </div>
            <div>
              <label
                htmlFor="test-duration"
                className="block text-sm font-medium text-gray-700 mb-2"
              >
                テスト時間（秒）
              </label>
              <input
                id="test-duration"
                type="number"
                value={testDuration / 1000}
                onChange={(e) => setTestDuration(Number(e.target.value) * 1000)}
                min={5}
                max={60}
                className="w-full px-3 py-2 border border-gray-300 rounded-md"
                disabled={isRunning}
              />
            </div>
          </div>
        </div>

        {/* テスト実行ボタン */}
        <div className="mb-6">
          <div className="flex space-x-4">
            <button
              type="button"
              onClick={handleQuickTest}
              disabled={isRunning}
              className="flex items-center space-x-2 px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:bg-gray-400"
            >
              <Play size={16} />
              <span>パフォーマンステスト実行</span>
            </button>

            <button
              type="button"
              onClick={handleRealTimeMonitoring}
              disabled={isRunning}
              className="flex items-center space-x-2 px-4 py-2 bg-green-600 text-white rounded-md hover:bg-green-700 disabled:bg-gray-400"
            >
              <BarChart3 size={16} />
              <span>リアルタイム監視</span>
            </button>

            {isRunning && (
              <button
                type="button"
                onClick={handleStopTest}
                className="flex items-center space-x-2 px-4 py-2 bg-red-600 text-white rounded-md hover:bg-red-700"
              >
                <Square size={16} />
                <span>停止</span>
              </button>
            )}

            <button
              type="button"
              onClick={handleClearResults}
              disabled={isRunning}
              className="px-4 py-2 border border-gray-300 rounded-md hover:bg-gray-50 disabled:bg-gray-100"
            >
              結果クリア
            </button>
          </div>
        </div>

        {/* 現在のメトリクス */}
        {currentMetrics && (
          <div className="mb-6 p-4 bg-blue-50 rounded-lg">
            <h3 className="text-lg font-medium mb-2 flex items-center">
              <BarChart3 size={20} className="mr-2" />
              リアルタイムメトリクス
            </h3>
            <div className="grid grid-cols-3 gap-4 text-sm">
              <div>
                <div className="font-medium">FPS</div>
                <div className="text-2xl font-bold">
                  {currentMetrics.fps.toFixed(1)}
                </div>
              </div>
              <div>
                <div className="font-medium">平均FPS</div>
                <div className="text-2xl font-bold">
                  {currentMetrics.averageFps.toFixed(1)}
                </div>
              </div>
              <div>
                <div className="font-medium">メモリ使用量</div>
                <div className="text-lg font-bold">
                  {(currentMetrics.memoryUsage / 1024 / 1024).toFixed(1)} MB
                </div>
              </div>
            </div>
          </div>
        )}

        {/* テスト結果 */}
        {testResults.length > 0 && (
          <div>
            <h3 className="text-lg font-medium mb-4">テスト結果</h3>
            <div className="space-y-4">
              {testResults.map((result) => (
                <div
                  key={`${result.testName}-${result.duration}`}
                  className={`p-4 rounded-lg border ${
                    result.summary.passed
                      ? "bg-green-50 border-green-200"
                      : "bg-red-50 border-red-200"
                  }`}
                >
                  <div className="flex items-center mb-2">
                    {result.summary.passed ? (
                      <div className="flex items-center text-green-700">
                        <div className="w-2 h-2 bg-green-500 rounded-full mr-2" />
                        PASS
                      </div>
                    ) : (
                      <div className="flex items-center text-red-700">
                        <AlertCircle size={16} className="mr-2" />
                        FAIL
                      </div>
                    )}
                    <span className="ml-4 font-medium">{result.testName}</span>
                  </div>

                  <div className="grid grid-cols-4 gap-4 text-sm">
                    <div>
                      <div className="text-gray-600">平均FPS</div>
                      <div className="font-medium">
                        {result.summary.averageFps.toFixed(1)}
                      </div>
                    </div>
                    <div>
                      <div className="text-gray-600">最小FPS</div>
                      <div className="font-medium">
                        {result.summary.minFps.toFixed(1)}
                      </div>
                    </div>
                    <div>
                      <div className="text-gray-600">最大メモリ</div>
                      <div className="font-medium">
                        {(result.summary.maxMemory / 1024 / 1024).toFixed(1)} MB
                      </div>
                    </div>
                    <div>
                      <div className="text-gray-600">データ点数</div>
                      <div className="font-medium">{result.metrics.length}</div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* パフォーマンス指標の説明 */}
        <div className="mt-6 p-4 bg-gray-50 rounded-lg">
          <h4 className="font-medium mb-2">評価基準</h4>
          <ul className="text-sm text-gray-600 space-y-1">
            <li>• 目標FPS: 60fps（実際は54fps以上で合格）</li>
            <li>• 1000要素での安定動作が基準</li>
            <li>• メモリ使用量は参考値</li>
            <li>• ドラッグ操作時のパフォーマンスが重要</li>
          </ul>
        </div>
      </div>
    </div>
  );
}
