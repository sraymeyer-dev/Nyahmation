import { useState, type DragEvent, type ReactElement } from 'react';
import { locatePart, moveLayer, reparentPart, restackPart, updateLayer, updatePart } from '../../../engine/edit';
import type { Layer, Part, Project } from '../../../engine/types';
import { newLayer, select } from '../editor/actions';
import { store, useEditor } from '../editor/store';
import { EyeIcon, LockIcon } from './icons';

// The Layers panel. Layers are listed front to back; inside each, parts show
// their parent/child tree, with siblings listed front to back by stacking
// order (docs/DESIGN.md R10). Drag a row onto another to make it a child;
// drag onto the top or bottom edge to place it above or below.

type DropAt = 'above' | 'inside' | 'below';
let dragged: { kind: 'part' | 'layer'; id: string } | null = null;

function dropPosition(e: DragEvent, allowInside: boolean): DropAt {
  const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
  const y = (e.clientY - rect.top) / rect.height;
  if (!allowInside) return y < 0.5 ? 'above' : 'below';
  return y < 0.25 ? 'above' : y > 0.75 ? 'below' : 'inside';
}

function dropPart(project: Project, id: string, target: Part, at: DropAt): Project {
  const targetLoc = locatePart(project, target.id);
  if (!targetLoc) return project;
  if (at === 'inside' || !targetLoc.parent) return reparentPart(project, id, target.id);
  let next = project;
  if (locatePart(next, id)?.parent?.id !== targetLoc.parent.id) next = reparentPart(next, id, targetLoc.parent.id);
  // Rows are listed front first, so "above" in the list means in front.
  return restackPart(next, id, target.id, at === 'above' ? 'above' : 'below');
}

export function Outliner() {
  const project = useEditor((s) => s.project);
  const selection = useEditor((s) => s.selection);
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set());
  const [renaming, setRenaming] = useState<string | null>(null);
  const [dropHint, setDropHint] = useState<{ id: string; at: DropAt } | null>(null);
  const selected = new Set(selection);

  const toggle = (id: string) =>
    setCollapsed((c) => {
      const next = new Set(c);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const rename = (part: Part, name: string, layer?: Layer) => {
    setRenaming(null);
    const trimmed = name.trim();
    if (!trimmed || trimmed === part.name) return;
    let next = updatePart(store.getState().project, part.id, (p) => ({ ...p, name: trimmed }));
    if (layer) next = updateLayer(next, layer.id, (l) => ({ ...l, name: trimmed }));
    store.commit(next);
  };

  const flag = (part: Part, key: 'visible' | 'locked') => {
    const value = key === 'visible' ? !part.visible : !part.locked;
    store.commit(updatePart(store.getState().project, part.id, (p) => ({ ...p, [key]: value })));
  };

  const onDrop = (e: DragEvent, target: Part, layer: Layer, isLayerRow: boolean) => {
    e.preventDefault();
    setDropHint(null);
    const d = dragged;
    dragged = null;
    if (!d) return;
    const project = store.getState().project;
    if (d.kind === 'layer') {
      if (!isLayerRow || d.id === layer.id) return;
      const layers = project.scene.layers;
      const targetIndex = layers.indexOf(layer);
      const at = dropPosition(e, false);
      const fromIndex = layers.findIndex((l) => l.id === d.id);
      // The list shows the front layer first, so "above" means a higher index.
      let to = at === 'above' ? targetIndex + 1 : targetIndex;
      if (fromIndex < to) to -= 1;
      store.commit(moveLayer(project, d.id, to));
      return;
    }
    const ids = selected.has(d.id) ? selection : [d.id];
    const at = isLayerRow ? 'inside' : dropPosition(e, true);
    let next = project;
    for (const id of ids) if (id !== target.id) next = dropPart(next, id, target, at);
    store.commit(next);
  };

  const renderName = (part: Part, layer?: Layer) =>
    renaming === part.id ? (
      <input
        className="rename"
        autoFocus
        defaultValue={layer?.name ?? part.name}
        onClick={(e) => e.stopPropagation()}
        onBlur={(e) => rename(part, e.target.value, layer)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') rename(part, (e.target as HTMLInputElement).value, layer);
          if (e.key === 'Escape') setRenaming(null);
        }}
      />
    ) : (
      <span className="name" onDoubleClick={() => setRenaming(part.id)}>
        {layer?.name ?? part.name}
      </span>
    );

  const renderRow = (part: Part, layer: Layer, depth: number, isLayerRow: boolean) => {
    const hasChildren = part.children.length > 0;
    const open = !collapsed.has(part.id);
    const hint = dropHint?.id === part.id ? `drop-${dropHint.at}` : '';
    const kind = isLayerRow ? (layer.kind === 'character' ? 'C' : 'B') : part.kind === 'group' ? 'G' : part.kind === 'image' ? 'I' : part.kind === 'switch' ? 'S' : '';
    return (
      <div
        key={part.id}
        className={`outline-row ${isLayerRow ? 'layer-row' : ''} ${selected.has(part.id) ? 'selected' : ''} ${hint}`}
        style={{ paddingLeft: 6 + depth * 14 }}
        draggable={renaming !== part.id}
        onDragStart={(e) => {
          dragged = { kind: isLayerRow ? 'layer' : 'part', id: isLayerRow ? layer.id : part.id };
          e.dataTransfer.effectAllowed = 'move';
        }}
        onDragOver={(e) => {
          if (!dragged) return;
          e.preventDefault();
          setDropHint({ id: part.id, at: isLayerRow ? (dragged.kind === 'layer' ? dropPosition(e, false) : 'inside') : dropPosition(e, true) });
        }}
        onDragLeave={() => setDropHint(null)}
        onDrop={(e) => onDrop(e, part, layer, isLayerRow)}
        onClick={(e) => select([part.id], e.shiftKey || e.metaKey || e.ctrlKey)}
        data-testid={isLayerRow ? 'layer-row' : 'part-row'}
      >
        <button
          className="twisty"
          aria-label={open ? 'Collapse' : 'Expand'}
          style={{ visibility: hasChildren ? 'visible' : 'hidden' }}
          onClick={(e) => {
            e.stopPropagation();
            toggle(part.id);
          }}
        >
          {open ? '▾' : '▸'}
        </button>
        {kind && <span className={`badge badge-${kind}`}>{kind}</span>}
        {renderName(part, isLayerRow ? layer : undefined)}
        <button className={`flag ${part.visible ? '' : 'off'}`} aria-label={part.visible ? 'Hide' : 'Show'} onClick={(e) => { e.stopPropagation(); flag(part, 'visible'); }}>
          <EyeIcon open={part.visible} />
        </button>
        <button className={`flag ${part.locked ? 'on' : ''}`} aria-label={part.locked ? 'Unlock' : 'Lock'} onClick={(e) => { e.stopPropagation(); flag(part, 'locked'); }}>
          <LockIcon locked={part.locked === true} />
        </button>
      </div>
    );
  };

  const renderTree = (part: Part, layer: Layer, depth: number): ReactElement[] => {
    if (collapsed.has(part.id)) return [];
    const children = part.children.slice().sort((a, b) => b.drawOrder - a.drawOrder);
    return children.flatMap((c) => [renderRow(c, layer, depth, false), ...renderTree(c, layer, depth + 1)]);
  };

  const layers = project.scene.layers.slice().reverse();
  return (
    <div className="outliner">
      <div className="panel-header">
        <span className="spacer" />
        <button onClick={() => newLayer('character')} title="New character layer">+ Character</button>
        <button onClick={() => newLayer('background')} title="New background layer">+ Background</button>
      </div>
      <div className="outline-list" role="tree">
        {layers.length === 0 && <p className="empty">No layers yet. Draw something, or add a layer.</p>}
        {layers.map((layer) => [renderRow(layer.root, layer, 0, true), ...renderTree(layer.root, layer, 1)])}
      </div>
    </div>
  );
}
