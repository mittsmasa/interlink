"use client";

import dynamic from "next/dynamic";

const DiagramCanvas = dynamic(
  () =>
    import("@/components/system-dynamics/diagram-canvas").then((mod) => ({
      default: mod.DiagramCanvas,
    })),
  { ssr: false },
);

export default function SystemDynamicsPage() {
  return (
    <div className="h-full bg-white">
      <DiagramCanvas />
    </div>
  );
}
