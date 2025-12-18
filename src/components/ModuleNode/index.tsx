import { memo } from 'react';
import { Handle, Position, NodeProps } from '@xyflow/react';
import './styles.css';

interface ModuleNodeData {
  moduleName: string;
  moduleId: string;
  color?: string;
  nodeCount: number;
  expanded: boolean;
}

export const ModuleNode = memo(({ data, selected }: NodeProps) => {
  const moduleData = data as unknown as ModuleNodeData;

  return (
    <div
      className={`module-node ${selected ? 'selected' : ''} ${moduleData.expanded ? 'expanded' : ''}`}
      style={{
        borderColor: moduleData.color || '#3b82f6',
        backgroundColor: moduleData.color ? `${moduleData.color}20` : 'rgba(59, 130, 246, 0.2)',
      }}
    >
      <Handle type="target" position={Position.Top} />
      <div className="module-content">
        <div className="module-header">
          <span className="module-icon">📦</span>
          <span className="module-name">{moduleData.moduleName}</span>
          <span className="module-count">{moduleData.nodeCount} 个节点</span>
        </div>
        {moduleData.expanded && <div className="module-status">已展开</div>}
      </div>
      <Handle type="source" position={Position.Bottom} />
    </div>
  );
});

ModuleNode.displayName = 'ModuleNode';
