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

describe('EditorStore unsaved changes', () => {
  it('undoing back to the opened project leaves nothing unsaved; redo makes it unsaved again', () => {
    const store = new EditorStore();
    store.load(p(5), new Map(), null);
    store.commit(p(6));
    store.commit(p(7));
    expect(store.getState().dirty).toBe(true);
    store.undo();
    store.undo();
    expect(store.getState().dirty).toBe(false);
    store.redo();
    expect(store.getState().dirty).toBe(true);
  });

  it('after saving, the saved state is the clean one', () => {
    const store = new EditorStore();
    store.commit(p(1));
    store.markSaved(store.getState().project);
    expect(store.getState().dirty).toBe(false);
    store.beginGesture();
    store.preview(p(2));
    store.endGesture();
    expect(store.getState().dirty).toBe(true);
    store.undo();
    expect(store.getState().dirty).toBe(false);
    store.undo();
    expect(store.getState().dirty).toBe(true);
  });

  it('a save that finishes after more changes leaves them unsaved', () => {
    const store = new EditorStore();
    const written = p(1);
    store.commit(written);
    store.commit(p(2));
    store.markSaved(written);
    expect(store.getState().dirty).toBe(true);
    store.undo();
    expect(store.getState().dirty).toBe(false);
  });

  it('restored work stays unsaved even when every change is undone', () => {
    const store = new EditorStore();
    store.load(p(5), new Map(), null);
    store.markUnsaved();
    store.commit(p(6));
    store.undo();
    expect(store.getState().dirty).toBe(true);
  });
});

describe('EditorStore loading', () => {
  it('forgets the old project’s loop range and selected marks', () => {
    const store = new EditorStore();
    store.set({ loop: { in: 3, out: 9 }, timeline: { zoom: 14, marks: [{ row: 'scene', id: '', frame: 3 }] } });
    store.load(createProject(), new Map(), null);
    expect(store.getState().loop).toBeNull();
    expect(store.getState().timeline.marks).toEqual([]);
  });
});
