"use client";

import type { KonvaEventObject } from "konva/lib/Node";
import { useRef } from "react";
import { Circle, Group, Rect, Text } from "react-konva";
import { useDiagramStore } from "@/store/diagram";
import type { DiagramElement as DiagramElementType } from "@/types/diagram";

interface DiagramElementProps {
  element: DiagramElementType;
}

export function DiagramElement({ element }: DiagramElementProps) {
  const groupRef = useRef<import("konva/lib/Group").Group>(null);
  const { moveElement, selectElement, toggleElementSelection } =
    useDiagramStore();

  const handleDragStart = () => {
    if (!element.selected) {
      selectElement(element.id);
    }
  };

  const handleDragMove = (e: KonvaEventObject<DragEvent>) => {
    const pos = e.target.position();
    moveElement(element.id, pos);
  };

  const handleClick = (e: KonvaEventObject<MouseEvent>) => {
    e.cancelBubble = true;

    if (e.evt.ctrlKey || e.evt.metaKey) {
      toggleElementSelection(element.id);
    } else {
      selectElement(element.id);
    }
  };

  const getElementColor = () => {
    if (element.color) return element.color;

    switch (element.type) {
      case "stock":
        return "#3B82F6"; // blue-500
      case "flow":
        return "#10B981"; // emerald-500
      case "connector":
        return "#8B5CF6"; // violet-500
      case "cloud":
        return "#6B7280"; // gray-500
      default:
        return "#6B7280";
    }
  };

  const getStrokeColor = () => {
    return element.selected ? "#EF4444" : "#374151"; // red-500 : gray-700
  };

  const getStrokeWidth = () => {
    return element.selected ? 3 : 1;
  };

  const renderStockElement = () => (
    <Group>
      <Rect
        x={0}
        y={0}
        width={element.size.width}
        height={element.size.height}
        fill={getElementColor()}
        fillOpacity={0.1}
        stroke={getStrokeColor()}
        strokeWidth={getStrokeWidth()}
        cornerRadius={4}
      />
      <Text
        x={8}
        y={8}
        width={element.size.width - 16}
        height={element.size.height - 16}
        text={element.label}
        fontSize={12}
        fontFamily="system-ui, sans-serif"
        fill="#1F2937"
        align="center"
        verticalAlign="middle"
        wrap="word"
      />
      <Text
        x={8}
        y={element.size.height - 24}
        width={element.size.width - 16}
        height={16}
        text={element.value.toString()}
        fontSize={10}
        fontFamily="system-ui, sans-serif"
        fill="#6B7280"
        align="center"
        verticalAlign="middle"
      />
    </Group>
  );

  const renderFlowElement = () => (
    <Group>
      <Rect
        x={0}
        y={0}
        width={element.size.width}
        height={element.size.height}
        fill={getElementColor()}
        fillOpacity={0.1}
        stroke={getStrokeColor()}
        strokeWidth={getStrokeWidth()}
        cornerRadius={element.size.height / 2}
      />
      <Text
        x={8}
        y={8}
        width={element.size.width - 16}
        height={element.size.height - 16}
        text={element.label}
        fontSize={12}
        fontFamily="system-ui, sans-serif"
        fill="#1F2937"
        align="center"
        verticalAlign="middle"
        wrap="word"
      />
    </Group>
  );

  const renderConnectorElement = () => (
    <Group>
      <Circle
        x={element.size.width / 2}
        y={element.size.height / 2}
        radius={Math.min(element.size.width, element.size.height) / 2}
        fill={getElementColor()}
        fillOpacity={0.1}
        stroke={getStrokeColor()}
        strokeWidth={getStrokeWidth()}
      />
      <Text
        x={8}
        y={8}
        width={element.size.width - 16}
        height={element.size.height - 16}
        text={element.label}
        fontSize={10}
        fontFamily="system-ui, sans-serif"
        fill="#1F2937"
        align="center"
        verticalAlign="middle"
        wrap="word"
      />
    </Group>
  );

  const renderCloudElement = () => (
    <Group>
      <Circle
        x={element.size.width * 0.3}
        y={element.size.height * 0.4}
        radius={element.size.width * 0.2}
        fill={getElementColor()}
        fillOpacity={0.1}
        stroke={getStrokeColor()}
        strokeWidth={getStrokeWidth()}
      />
      <Circle
        x={element.size.width * 0.7}
        y={element.size.height * 0.4}
        radius={element.size.width * 0.25}
        fill={getElementColor()}
        fillOpacity={0.1}
        stroke={getStrokeColor()}
        strokeWidth={getStrokeWidth()}
      />
      <Circle
        x={element.size.width * 0.5}
        y={element.size.height * 0.6}
        radius={element.size.width * 0.3}
        fill={getElementColor()}
        fillOpacity={0.1}
        stroke={getStrokeColor()}
        strokeWidth={getStrokeWidth()}
      />
      <Text
        x={8}
        y={element.size.height - 20}
        width={element.size.width - 16}
        height={12}
        text={element.label}
        fontSize={10}
        fontFamily="system-ui, sans-serif"
        fill="#1F2937"
        align="center"
        verticalAlign="middle"
        wrap="word"
      />
    </Group>
  );

  const renderElement = () => {
    switch (element.type) {
      case "stock":
        return renderStockElement();
      case "flow":
        return renderFlowElement();
      case "connector":
        return renderConnectorElement();
      case "cloud":
        return renderCloudElement();
      default:
        return renderStockElement();
    }
  };

  return (
    <Group
      ref={groupRef}
      x={element.position.x}
      y={element.position.y}
      draggable
      onDragStart={handleDragStart}
      onDragMove={handleDragMove}
      onClick={handleClick}
      onTap={handleClick}
    >
      {renderElement()}
    </Group>
  );
}
