import type { Mode, ToolId } from '../store';
import { cameraTool } from './camera';
import { handTool } from './hand';
import { jointTool } from './joint';
import { poseTool } from './pose';
import { penTool } from './pen';
import { pinTool } from './pin';
import { pointsTool } from './points';
import { selectTool } from './select';
import { createShapeTool } from './shapes';
import type { Tool } from './types';

export const TOOLS: Record<ToolId, Tool> = {
  select: selectTool,
  points: pointsTool,
  joint: jointTool,
  pose: poseTool,
  pin: pinTool,
  camera: cameraTool,
  pen: penTool,
  rect: createShapeTool('rect'),
  ellipse: createShapeTool('ellipse'),
  polygon: createShapeTool('polygon'),
  star: createShapeTool('star'),
  line: createShapeTool('line'),
  hand: handTool,
};

/** Tools in toolbar order, with their key and the modes they work in. */
export const TOOL_INFO: { id: ToolId; label: string; key: string; modes: readonly Mode[] }[] = [
  { id: 'select', label: 'Select', key: 'V', modes: ['build', 'animate'] },
  { id: 'points', label: 'Points', key: 'A', modes: ['build'] },
  { id: 'joint', label: 'Joints', key: 'J', modes: ['build'] },
  { id: 'pose', label: 'Pose', key: 'K', modes: ['build', 'animate'] },
  { id: 'pin', label: 'Pin', key: 'P', modes: ['animate'] },
  { id: 'camera', label: 'Camera', key: 'C', modes: ['animate'] },
  { id: 'pen', label: 'Pen', key: 'P', modes: ['build'] },
  { id: 'rect', label: 'Rectangle', key: 'M', modes: ['build'] },
  { id: 'ellipse', label: 'Ellipse', key: 'L', modes: ['build'] },
  { id: 'polygon', label: 'Polygon', key: 'Y', modes: ['build'] },
  { id: 'star', label: 'Star', key: 'S', modes: ['build'] },
  { id: 'line', label: 'Line', key: '\\', modes: ['build'] },
  { id: 'hand', label: 'Hand', key: 'H', modes: ['build', 'animate'] },
];

export function toolsFor(mode: Mode) {
  return TOOL_INFO.filter((t) => t.modes.includes(mode));
}
