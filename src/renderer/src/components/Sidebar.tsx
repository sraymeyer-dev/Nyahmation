import { store, useEditor } from '../editor/store';
import { Library } from './Library';
import { Outliner } from './Outliner';
import { Properties } from './Properties';

export function Sidebar() {
  const tab = useEditor((s) => s.sidebarTab);
  return (
    <aside className="sidebar">
      <div className="sidebar-top">
        <div className="tabs" role="tablist" aria-label="Panels">
          <button role="tab" aria-selected={tab === 'layers'} className={tab === 'layers' ? 'active' : ''} onClick={() => store.set({ sidebarTab: 'layers' })}>
            Layers
          </button>
          <button role="tab" aria-selected={tab === 'library'} className={tab === 'library' ? 'active' : ''} onClick={() => store.set({ sidebarTab: 'library' })}>
            Library
          </button>
        </div>
        {tab === 'layers' ? <Outliner /> : <Library />}
      </div>
      <Properties />
    </aside>
  );
}
