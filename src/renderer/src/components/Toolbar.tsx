import { setTool } from '../editor/actions';
import { useEditor } from '../editor/store';
import { toolsFor } from '../editor/tools';
import { ToolIcon } from './icons';

export function Toolbar() {
  const tool = useEditor((s) => s.tool);
  const mode = useEditor((s) => s.mode);
  return (
    <nav className="toolbar" aria-label="Tools">
      {toolsFor(mode).map((t) => (
        <button
          key={t.id}
          className={t.id === tool ? 'tool active' : 'tool'}
          title={`${t.label} (${t.key})`}
          aria-label={t.label}
          aria-pressed={t.id === tool}
          onClick={() => setTool(t.id)}
        >
          <ToolIcon tool={t.id} />
        </button>
      ))}
    </nav>
  );
}
