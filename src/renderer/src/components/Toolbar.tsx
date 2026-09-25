import { setTool } from '../editor/actions';
import { useEditor } from '../editor/store';
import { TOOL_INFO } from '../editor/tools';
import { ToolIcon } from './icons';

export function Toolbar() {
  const tool = useEditor((s) => s.tool);
  return (
    <nav className="toolbar" aria-label="Tools">
      {TOOL_INFO.map((t) => (
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
