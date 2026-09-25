import { describe, expect, it } from 'vitest';
import { createProject } from '../../../engine/project';
import { EditorStore } from './store';

const p = (w: number) => createProject({ width: w });

describe('EditorStore history', () => {
  it('undoes and redoes commits', () => {
    const store = new EditorStore();
    store.commit(p(100));
    store.commit(p(200));
    expect(store.getState().project.scene.width).toBe(200);
    store.undo();
    expect(store.getState().project.scene.width).toBe(100);
    store.redo();
    expect(store.getState().project.scene.width).toBe(200);
    expect(store.getState().dirty).toBe(true);
  });

  it('turns a whole drag into one undo step', () => {
    const store = new EditorStore();
    const before = store.getState().project;
    store.beginGesture();
    store.preview(p(1));
    store.preview(p(2));
    store.preview(p(3));
    store.endGesture();
    store.undo();
    expect(store.getState().project).toBe(before);
    expect(store.canUndo()).toBe(false);
  });

  it('merges quick repeated edits of the same field', () => {
    const store = new EditorStore();
    const before = store.getState().project;
    store.commit(p(1), {}, 'fill');
    store.commit(p(2), {}, 'fill');
    store.commit(p(3), {}, 'stroke');
    store.undo();
    expect(store.getState().project.scene.width).toBe(2);
    store.undo();
    expect(store.getState().project).toBe(before);
  });

  it('a new edit clears redo', () => {
    const store = new EditorStore();
    store.commit(p(1));
    store.undo();
    store.commit(p(2));
    expect(store.canRedo()).toBe(false);
  });

  it('loading a document clears history and the dirty flag', () => {
    const store = new EditorStore();
    store.commit(p(1));
    store.load(p(5), new Map(), null);
    expect(store.canUndo()).toBe(false);
    expect(store.getState().dirty).toBe(false);
  });
});
