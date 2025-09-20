export interface PerformanceMetrics {
  fps: number;
  averageFps: number;
  memoryUsage: number;
  renderTime: number;
  elementCount: number;
  timestamp: number;
}

export interface PerformanceTestResult {
  testName: string;
  duration: number;
  metrics: PerformanceMetrics[];
  summary: {
    averageFps: number;
    minFps: number;
    maxFps: number;
    averageMemory: number;
    maxMemory: number;
    passed: boolean;
    threshold: number;
  };
}

export class PerformanceMonitor {
  private metrics: PerformanceMetrics[] = [];
  private lastTime = 0;
  private fpsBuffer: number[] = [];
  private isRunning = false;
  private animationId: number | null = null;
  private startTime = 0;

  constructor(
    private targetFps = 60,
    private bufferSize = 30,
  ) {}

  start(): void {
    if (this.isRunning) return;

    this.isRunning = true;
    this.startTime = performance.now();
    this.lastTime = this.startTime;
    this.metrics = [];
    this.fpsBuffer = [];

    this.measure();
  }

  stop(): PerformanceMetrics[] {
    this.isRunning = false;
    if (this.animationId) {
      cancelAnimationFrame(this.animationId);
      this.animationId = null;
    }
    return [...this.metrics];
  }

  private measure = (): void => {
    if (!this.isRunning) return;

    const currentTime = performance.now();
    const deltaTime = currentTime - this.lastTime;

    if (deltaTime > 0) {
      const fps = 1000 / deltaTime;
      this.fpsBuffer.push(fps);

      if (this.fpsBuffer.length > this.bufferSize) {
        this.fpsBuffer.shift();
      }

      const averageFps =
        this.fpsBuffer.reduce((sum, f) => sum + f, 0) / this.fpsBuffer.length;

      // メモリ使用量を取得（利用可能な場合）
      const memoryInfo = (
        performance as unknown as { memory?: { usedJSHeapSize: number } }
      ).memory;
      const memoryUsage = memoryInfo ? memoryInfo.usedJSHeapSize : 0;

      const metric: PerformanceMetrics = {
        fps,
        averageFps,
        memoryUsage,
        renderTime: deltaTime,
        elementCount: 0, // 呼び出し元で設定
        timestamp: currentTime,
      };

      this.metrics.push(metric);
    }

    this.lastTime = currentTime;
    this.animationId = requestAnimationFrame(this.measure);
  };

  getCurrentMetrics(): PerformanceMetrics | null {
    return this.metrics.length > 0
      ? this.metrics[this.metrics.length - 1]
      : null;
  }

  isPerformanceAcceptable(): boolean {
    if (this.fpsBuffer.length === 0) return true;
    const averageFps =
      this.fpsBuffer.reduce((sum, f) => sum + f, 0) / this.fpsBuffer.length;
    return averageFps >= this.targetFps * 0.9; // 90%のしきい値
  }
}

export function generateTestElements(count: number): Array<{
  id: string;
  type: "stock" | "flow" | "connector" | "cloud";
  position: { x: number; y: number };
  size: { width: number; height: number };
  label: string;
  value: number;
}> {
  const elements = [];
  const centerX = 400;
  const centerY = 300;
  const radius = 200;

  for (let i = 0; i < count; i++) {
    const angle = (i / count) * 2 * Math.PI;
    const x = centerX + Math.cos(angle) * radius + (Math.random() - 0.5) * 100;
    const y = centerY + Math.sin(angle) * radius + (Math.random() - 0.5) * 100;

    const types = ["stock", "flow", "connector", "cloud"] as const;
    const type = types[i % types.length];

    elements.push({
      id: `perf-test-element-${i}`,
      type,
      position: { x, y },
      size: { width: 80, height: 50 },
      label: `要素${i + 1}`,
      value: Math.floor(Math.random() * 1000),
    });
  }

  return elements;
}

export function generateTestConnections(
  elements: Array<{ id: string }>,
  connectionRatio = 0.3,
): Array<{
  id: string;
  sourceId: string;
  targetId: string;
  type: "flow" | "connector";
}> {
  const connections = [];
  const connectionCount = Math.floor(elements.length * connectionRatio);

  for (let i = 0; i < connectionCount; i++) {
    const sourceIndex = i % elements.length;
    const targetIndex = (i + 1) % elements.length;

    connections.push({
      id: `perf-test-connection-${i}`,
      sourceId: elements[sourceIndex].id,
      targetId: elements[targetIndex].id,
      type: i % 2 === 0 ? ("flow" as const) : ("connector" as const),
    });
  }

  return connections;
}

export async function runPerformanceTest(
  testName: string,
  elementCount: number,
  durationMs: number,
  targetFps = 60,
): Promise<PerformanceTestResult> {
  return new Promise((resolve) => {
    const monitor = new PerformanceMonitor(targetFps);
    const elements = generateTestElements(elementCount);
    const _connections = generateTestConnections(elements);

    // テスト開始
    monitor.start();

    setTimeout(() => {
      const metrics = monitor.stop();

      // 結果の分析
      const fpsList = metrics.map((m) => m.fps);
      const memoryList = metrics.map((m) => m.memoryUsage);

      const averageFps =
        fpsList.reduce((sum, fps) => sum + fps, 0) / fpsList.length;
      const minFps = Math.min(...fpsList);
      const maxFps = Math.max(...fpsList);
      const averageMemory =
        memoryList.reduce((sum, mem) => sum + mem, 0) / memoryList.length;
      const maxMemory = Math.max(...memoryList);

      const passed = averageFps >= targetFps * 0.9; // 90%のしきい値

      // メトリクスに要素数を設定
      metrics.forEach((metric) => {
        metric.elementCount = elementCount;
      });

      const result: PerformanceTestResult = {
        testName,
        duration: durationMs,
        metrics,
        summary: {
          averageFps,
          minFps,
          maxFps,
          averageMemory,
          maxMemory,
          passed,
          threshold: targetFps * 0.9,
        },
      };

      resolve(result);
    }, durationMs);
  });
}

export function formatPerformanceResult(result: PerformanceTestResult): string {
  const { testName, summary } = result;
  const status = summary.passed ? "✅ PASS" : "❌ FAIL";

  return `
Performance Test: ${testName} ${status}

📊 FPS Metrics:
  Average: ${summary.averageFps.toFixed(1)} fps
  Minimum: ${summary.minFps.toFixed(1)} fps
  Maximum: ${summary.maxFps.toFixed(1)} fps
  Threshold: ${summary.threshold.toFixed(1)} fps

💾 Memory Usage:
  Average: ${(summary.averageMemory / 1024 / 1024).toFixed(1)} MB
  Maximum: ${(summary.maxMemory / 1024 / 1024).toFixed(1)} MB

⏱️ Test Duration: ${result.duration}ms
📈 Data Points: ${result.metrics.length}
  `.trim();
}
