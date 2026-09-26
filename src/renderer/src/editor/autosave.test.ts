import { describe, expect, it } from 'vitest';
import { createProject } from '../../../engine/project';
import { Autosaver } from './autosave';

function setup() {
  let now = 0;
  const calls: string[] = [];
  const saver = new Autosaver({
    recovery: {
      write: async (_bytes, meta) => {
        calls.push(`write ${meta.name}`);
      },
      clear: async () => {
        calls.push('clear');
      },
    },
    pack: () => new Uint8Array([1]),
    now: () => now,
    intervalMs: 60_000,
  });
  return { saver, calls, advance: (ms: number) => (now += ms) };
}

const assets = new Map<string, Uint8Array>();

describe('Autosaver', () => {
  it('does nothing while there are no unsaved changes', async () => {
    const { saver, calls } = setup();
    expect(await saver.tick({ project: createProject(), assets, dirty: false, file: null })).toBe('idle');
    expect(calls).toEqual([]);
  });

  it('writes soon after the first change, then at most once a minute', async () => {
    const { saver, calls, advance } = setup();
    const file = { path: '/p/Walk.nyah', name: 'Walk.nyah' };
    expect(await saver.tick({ project: createProject(), assets, dirty: true, file })).toBe('wrote');
    advance(5_000);
    expect(await saver.tick({ project: createProject(), assets, dirty: true, file })).toBe('idle');
    advance(55_000);
    expect(await saver.tick({ project: createProject(), assets, dirty: true, file })).toBe('wrote');
    expect(calls).toEqual(['write Walk.nyah', 'write Walk.nyah']);
  });

  it("doesn't rewrite a project that hasn't changed since the last autosave", async () => {
    const { saver, calls, advance } = setup();
    const project = createProject();
    await saver.tick({ project, assets, dirty: true, file: null });
    advance(120_000);
    expect(await saver.tick({ project, assets, dirty: true, file: null })).toBe('idle');
    expect(calls).toEqual(['write Untitled']);
  });

  it('waits for a drag to finish', async () => {
    const { saver } = setup();
    expect(await saver.tick({ project: createProject(), assets, dirty: true, file: null }, { inGesture: true })).toBe('idle');
    expect(await saver.tick({ project: createProject(), assets, dirty: true, file: null })).toBe('wrote');
  });

  it('deletes the recovery file once the work is saved', async () => {
    const { saver, calls } = setup();
    const project = createProject();
    await saver.tick({ project, assets, dirty: true, file: null });
    expect(await saver.tick({ project, assets, dirty: false, file: null })).toBe('cleared');
    expect(await saver.tick({ project, assets, dirty: false, file: null })).toBe('idle');
    expect(calls).toEqual(['write Untitled', 'clear']);
  });

  it('force writes straight away (after restoring recovered work)', async () => {
    const { saver, advance } = setup();
    await saver.tick({ project: createProject(), assets, dirty: true, file: null });
    advance(1_000);
    expect(await saver.tick({ project: createProject(), assets, dirty: true, file: null }, { force: true })).toBe('wrote');
  });

  it("after a failed write, waits a minute before trying again", async () => {
    let now = 0;
    let fail = true;
    const saver = new Autosaver({
      recovery: {
        write: async () => {
          if (fail) throw new Error('disk full');
        },
        clear: async () => {},
      },
      pack: () => new Uint8Array(),
      now: () => now,
    });
    await expect(saver.tick({ project: createProject(), assets, dirty: true, file: null })).rejects.toThrow('disk full');
    fail = false;
    now = 5_000;
    expect(await saver.tick({ project: createProject(), assets, dirty: true, file: null })).toBe('idle');
    now = 61_000;
    expect(await saver.tick({ project: createProject(), assets, dirty: true, file: null })).toBe('wrote');
  });
});
