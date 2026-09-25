import type { ToolId } from '../store';
import { handTool } from './hand';
import { jointTool } from './joint';
import { poseTool } from './pose';
import { penTool } from './pen';
import { pointsTool } from './points';
import { selectTool } from './select';
import { createShapeTool } from './shapes';
import type { Tool } from './types';

export const TOOLS: Record<ToolId, Tool> = {
  select: selectTool,
  points: pointsTool,
  joint: jointTool,
  pose: poseTool,
  pen: penTool,
  rect: createShapeTool('rect'),
  ellipse: createShapeTool('ellipse'),
  polygon: createShapeTool('polygon'),
  star: createShapeTool('star'),
  line: createShapeTool('line'),
  hand: handTool,
};

export const TOOL_INFO: { id: ToolId; label: string; key: string }[] = [
  { id: 'select', label: 'Select', key: 'V' },
  { id: 'points', label: 'Points', key: 'A' },
  { id: 'joint', label: 'Joints', key: 'J' },
  { id: 'pose', label: 'Pose', key: 'K' },
  { id: 'pen', label: 'Pen', key: 'P' },
  { id: 'rect', label: 'Rectangle', key: 'M' },
  { id: 'ellipse', label: 'Ellipse', key: 'L' },
  { id: 'polygon', label: 'Polygon', key: 'Y' },
  { id: 'star', label: 'Star', key: 'S' },
  { id: 'line', label: 'Line', key: '\\' },
  { id: 'hand', label: 'Hand', key: 'H' },
];
