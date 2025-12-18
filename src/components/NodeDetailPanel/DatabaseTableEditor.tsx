import { memo, useState } from 'react';
import { DatabaseTable, DatabaseField } from '../../types/flow';
import { BufferedInput } from '../common/BufferedInput';

interface DatabaseTableEditorProps {
  tables: DatabaseTable[];
  onTablesChange: (tables: DatabaseTable[]) => void;
}

export const DatabaseTableEditor = memo(function DatabaseTableEditor({
  tables,
  onTablesChange,
}: DatabaseTableEditorProps) {
  const [expandedTableIndices, setExpandedTableIndices] = useState<Set<number>>(new Set());
  const [fieldSearchQuery, setFieldSearchQuery] = useState<Record<number, string>>({});

  // Reset internal state when tables array length changes significantly or is empty?
  // Actually, usually we want to reset if the *node* changes. 
  // The parent should probably pass a key={nodeId} to force re-mount if node changes.

  const handleAddTable = () => {
    const newTable: DatabaseTable = {
      tableName: '新数据表',
      description: '',
      sourceDatabase: '',
      sourceDatabaseUrl: '',
      fields: [],
    };
    const newTables = [...tables, newTable];
    onTablesChange(newTables);

    // Auto expand new table
    const newExpanded = new Set(expandedTableIndices);
    newExpanded.add(newTables.length - 1);
    setExpandedTableIndices(newExpanded);
  };

  const handleDeleteTable = (index: number, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!window.confirm('确认删除此关联表吗？')) return;
    const newTables = tables.filter((_, i) => i !== index);
    onTablesChange(newTables);

    // Update expanded indices
    const newExpanded = new Set<number>();
    Array.from(expandedTableIndices).forEach((i) => {
      if (i < index) newExpanded.add(i);
      else if (i > index) newExpanded.add(i - 1);
    });
    setExpandedTableIndices(newExpanded);

    // Clean up search queries
    const newSearchQuery = { ...fieldSearchQuery };
    delete newSearchQuery[index];
    // Shift queries... actually simpler to just reset queries for shifted indices or let them be.
    // Given the complexity of shifting map keys, clearing queries for affected might be safer/easier
    // or just leave as is, keys might be stale but harmless.
    setFieldSearchQuery({}); // Simplest approach: reset search on delete to avoid index mixup
  };

  const handleUpdateTable = (index: number, field: keyof DatabaseTable, value: string) => {
    const newTables = [...tables];
    newTables[index] = { ...newTables[index], [field]: value };
    onTablesChange(newTables);
  };

  const toggleTableExpanded = (index: number) => {
    const newExpanded = new Set(expandedTableIndices);
    if (newExpanded.has(index)) {
      newExpanded.delete(index);
    } else {
      newExpanded.add(index);
    }
    setExpandedTableIndices(newExpanded);
  };

  const handleAddField = (tableIndex: number) => {
    const newTables = [...tables];
    // Ensure fields array exists
    if (!newTables[tableIndex].fields) newTables[tableIndex].fields = [];

    newTables[tableIndex].fields.push({
      fieldName: '',
      fieldType: 'VARCHAR',
      comment: '',
      required: false,
    });
    onTablesChange(newTables);
  };

  const handleUpdateField = (
    tableIndex: number,
    fieldIndex: number,
    field: keyof DatabaseField,
    value: string | boolean,
  ) => {
    const newTables = [...tables];
    newTables[tableIndex].fields[fieldIndex] = {
      ...newTables[tableIndex].fields[fieldIndex],
      [field]: value,
    };
    onTablesChange(newTables);
  };

  const handleDeleteField = (tableIndex: number, fieldIndex: number) => {
    const newTables = [...tables];
    newTables[tableIndex].fields = newTables[tableIndex].fields.filter(
      (_, i) => i !== fieldIndex,
    );
    onTablesChange(newTables);
  };



  return (
    <div className="section">
      <div className="section-title" style={{ justifyContent: 'space-between' }}>
        <span style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <span className="icon">🗄️</span> 关联数据库表
        </span>
        <button
          onClick={handleAddTable}
          style={{
            background: '#eff6ff',
            color: '#3b82f6',
            border: 'none',
            padding: '9px 18px',
            borderRadius: '9px',
            fontSize: '18px',
            fontWeight: 600,
            cursor: 'pointer',
            transition: 'all 0.2s',
          }}
        >
          + 添加表
        </button>
      </div>

      {tables.length === 0 ? (
        <div className="empty-hint" style={{ padding: '24px', fontSize: '19.5px' }}>
          暂无关联数据表
        </div>
      ) : (
        <div className="table-list">
          {tables.map((table, index) => {
            const isExpanded = expandedTableIndices.has(index);
            return (
              <div
                key={index}
                className="table-card"
                style={{ position: 'relative', transition: 'all 0.3s ease' }}
              >
                {/* 表格头部 (折叠时显示) */}
                <div
                  className="table-header-row"
                  onClick={() => toggleTableExpanded(index)}
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    cursor: 'pointer',
                    marginBottom: isExpanded ? '24px' : '0',
                    padding: '12px 0',
                  }}
                >
                  <div
                    style={{ flex: 1, display: 'flex', alignItems: 'center', gap: '12px' }}
                  >
                    <span
                      style={{
                        transform: `rotate(${isExpanded ? 90 : 0}deg)`,
                        transition: 'transform 0.2s',
                        fontSize: '14px',
                        color: '#475569',
                      }}
                    >
                      ▶
                    </span>
                    <div style={{ flex: 1 }}>
                      <div
                        style={{
                          fontWeight: 600,
                          fontSize: '16px',
                          color: '#334155',
                          marginBottom: table.description ? '2px' : '0',
                        }}
                      >
                        {table.tableName || '未命名表'}
                      </div>
                      {table.description && (
                        <div
                          style={{
                            fontSize: '13px',
                            color: '#64748b',
                            marginTop: '2px',
                          }}
                        >
                          {table.description}
                        </div>
                      )}
                    </div>
                  </div>
                  <button
                    onClick={(e) => handleDeleteTable(index, e)}
                    className="delete-table-btn"
                    style={{
                      background: 'transparent',
                      border: 'none',
                      color: '#94a3b8',
                      cursor: 'pointer',
                      fontSize: '20px',
                      padding: '0 8px',
                      transition: 'color 0.2s',
                    }}
                    onMouseEnter={(e) => (e.currentTarget.style.color = '#ef4444')}
                    onMouseLeave={(e) => (e.currentTarget.style.color = '#94a3b8')}
                    title="删除表"
                  >
                    ×
                  </button>
                </div>

                {/* 展开内容 */}
                {isExpanded && (
                  <div
                    className="table-details"
                    style={{ paddingLeft: '12px', borderLeft: '3px solid #f1f5f9' }}
                  >
                    {/* 表信息编辑区域 - 简洁样式 */}
                    <div
                      style={{
                        marginBottom: '18px',
                        display: 'flex',
                        flexDirection: 'column',
                        gap: '8px',
                      }}
                    >
                      <BufferedInput
                        type="text"
                        className="info-input"
                        style={{ fontSize: '14px', padding: '6px 10px' }}
                        value={table.tableName || ''}
                        onCommit={(value) =>
                          handleUpdateTable(index, 'tableName', value)
                        }
                        placeholder="表名"
                      />
                      <BufferedInput
                        type="text"
                        className="info-input"
                        style={{ fontSize: '13px', padding: '6px 10px', color: '#64748b' }}
                        value={table.description || ''}
                        onCommit={(value) =>
                          handleUpdateTable(index, 'description', value)
                        }
                        placeholder="描述"
                      />
                      <BufferedInput
                        type="text"
                        className="info-input"
                        style={{ fontSize: '13px', padding: '6px 10px', color: '#94a3b8' }}
                        value={table.sourceDatabase || ''}
                        onCommit={(value) =>
                          handleUpdateTable(index, 'sourceDatabase', value)
                        }
                        placeholder="来源数据库"
                      />
                      <BufferedInput
                        type="text"
                        className="info-input"
                        style={{ fontSize: '13px', padding: '6px 10px', color: '#94a3b8' }}
                        value={table.sourceDatabaseUrl || ''}
                        onCommit={(value) =>
                          handleUpdateTable(index, 'sourceDatabaseUrl', value)
                        }
                        placeholder="来源数据库地址"
                      />
                    </div>

                    {/* 主键和外键编辑区域 - 简洁样式 */}
                    <div
                      style={{
                        marginBottom: '18px',
                        display: 'flex',
                        flexDirection: 'column',
                        gap: '12px',
                      }}
                    >
                      {/* 主键编辑 */}
                      <div>
                        <label
                          style={{
                            fontSize: '14px',
                            fontWeight: 600,
                            color: '#475569',
                            marginBottom: '4px',
                            display: 'flex',
                            alignItems: 'center',
                            gap: '6px',
                          }}
                        >
                          <span>🔑</span>
                          主键
                        </label>
                        <BufferedInput
                          type="text"
                          className="info-input"
                          style={{
                            fontSize: '14px',
                            fontFamily: 'monospace',
                            padding: '8px 12px',
                          }}
                          value={table.primaryKey || ''}
                          onCommit={(value) =>
                            handleUpdateTable(index, 'primaryKey', value)
                          }
                          placeholder="如: id 或 user_id, order_id (联合主键)"
                        />
                      </div>

                      {/* 外键关系编辑 */}
                      <div>
                        <label
                          style={{
                            fontSize: '14px',
                            fontWeight: 600,
                            color: '#475569',
                            marginBottom: '4px',
                            display: 'flex',
                            alignItems: 'center',
                            gap: '6px',
                          }}
                        >
                          <span>🔗</span>
                          外键关系
                        </label>
                        <textarea
                          className="info-textarea"
                          style={{
                            fontSize: '13px',
                            fontFamily: 'monospace',
                            minHeight: '60px',
                            padding: '8px 12px',
                          }}
                          value={table.foreignKeys || ''}
                          onChange={(e) =>
                            handleUpdateTable(index, 'foreignKeys', e.target.value)
                          }
                          placeholder="每行一个外键，格式：&#10;user_id -> users.id&#10;order_id -> orders.id"
                          rows={3}
                        />
                      </div>
                    </div>

                    {/* 字段列表区域 - 参考图片样式 */}
                    <div
                      className="fields-section"
                      style={{
                        marginTop: '24px',
                        borderTop: '1px dashed #e2e8f0',
                        paddingTop: '18px',
                      }}
                    >
                      {/* 标题和统计 */}
                      <div
                        style={{
                          display: 'flex',
                          justifyContent: 'space-between',
                          alignItems: 'center',
                          marginBottom: '16px',
                        }}
                      >
                        <div
                          style={{ fontSize: '15px', fontWeight: 600, color: '#0f172a' }}
                        >
                          字段列表
                        </div>
                        {table.fields && table.fields.length > 0 && (
                          <div style={{ fontSize: '13px', color: '#64748b' }}>
                            共
                            {
                              table.fields.filter((field: DatabaseField) => {
                                const query = (fieldSearchQuery[index] || '').toLowerCase();
                                if (!query) return true;
                                return (
                                  (field.fieldName || '').toLowerCase().includes(query) ||
                                  (field.comment || '').toLowerCase().includes(query)
                                );
                              }).length
                            }
                            个字段
                          </div>
                        )}
                      </div>

                      {/* 搜索框和添加按钮 */}
                      <div
                        style={{
                          marginBottom: '16px',
                          display: 'flex',
                          gap: '10px',
                          alignItems: 'center',
                        }}
                      >
                        <div style={{ flex: 1, position: 'relative' }}>
                          <span
                            style={{
                              position: 'absolute',
                              left: '10px',
                              top: '50%',
                              transform: 'translateY(-50%)',
                              fontSize: '14px',
                              color: '#94a3b8',
                            }}
                          >
                            🔍
                          </span>
                          <input
                            type="text"
                            className="info-input"
                            style={{
                              paddingLeft: '36px',
                              fontSize: '13px',
                              height: '32px',
                            }}
                            value={fieldSearchQuery[index] || ''}
                            onChange={(e) =>
                              setFieldSearchQuery({
                                ...fieldSearchQuery,
                                [index]: e.target.value,
                              })
                            }
                            placeholder="搜索字段名或说明..."
                          />
                        </div>
                        <button
                          onClick={() => handleAddField(index)}
                          style={{
                            fontSize: '13px',
                            color: '#3b82f6',
                            background: '#eff6ff',
                            border: '1px solid #dbeafe',
                            borderRadius: '6px',
                            padding: '6px 14px',
                            cursor: 'pointer',
                            fontWeight: 600,
                            whiteSpace: 'nowrap',
                            height: '32px',
                          }}
                        >
                          + 添加字段
                        </button>
                      </div>

                      {/* 字段表格 */}
                      {table.fields && table.fields.length > 0 ? (
                        <>
                          <div
                            style={{
                              border: '1px solid #e2e8f0',
                              borderRadius: '8px',
                              overflow: 'hidden',
                              background: '#fff',
                            }}
                          >
                            {/* 表头 */}
                            <div
                              style={{
                                display: 'grid',
                                gridTemplateColumns: '2fr 1.5fr 0.8fr 2fr 0.5fr',
                                background: '#f8fafc',
                                borderBottom: '1px solid #e2e8f0',
                                padding: '10px 16px',
                                fontSize: '13px',
                                fontWeight: 600,
                                color: '#475569',
                              }}
                            >
                              <div>字段名</div>
                              <div>类型</div>
                              <div>必填</div>
                              <div>说明</div>
                              <div></div>
                            </div>

                            {/* 表体 */}
                            <div>
                              {table.fields
                                .filter((field: DatabaseField) => {
                                  const query = (
                                    fieldSearchQuery[index] || ''
                                  ).toLowerCase();
                                  if (!query) return true;
                                  return (
                                    (field.fieldName || '').toLowerCase().includes(query) ||
                                    (field.comment || '').toLowerCase().includes(query)
                                  );
                                })
                                .map((field: DatabaseField) => {
                                  // Find original index in valid manner when filtering
                                  const originalIndex = table.fields.indexOf(field);

                                  const isPrimaryKey =
                                    table.primaryKey &&
                                    table.primaryKey
                                      .split(',')
                                      .map((pk: string) => pk.trim())
                                      .includes(field.fieldName);
                                  // 检查是否为外键：外键关系格式可能是 "field_name -> table_name(id)" 或 "field_name"
                                  const isForeignKey =
                                    table.foreignKeys &&
                                    (table.foreignKeys.includes(field.fieldName) ||
                                      table.foreignKeys.split('\n').some((line: string) => {
                                        const trimmed = line.trim();
                                        return (
                                          trimmed.startsWith(field.fieldName + ' ->') ||
                                          trimmed.startsWith(field.fieldName + '->') ||
                                          trimmed === field.fieldName
                                        );
                                      }));

                                  return (
                                    <div
                                      key={originalIndex}
                                      style={{
                                        display: 'grid',
                                        gridTemplateColumns: '2fr 1.5fr 0.8fr 2fr 0.5fr',
                                        borderBottom: '1px solid #f1f5f9',
                                        padding: '10px 16px',
                                        transition: 'background 0.2s',
                                      }}
                                      onMouseEnter={(e) =>
                                        (e.currentTarget.style.background = '#f8fafc')
                                      }
                                      onMouseLeave={(e) =>
                                        (e.currentTarget.style.background = '#fff')
                                      }
                                    >
                                      {/* 字段名 */}
                                      <div
                                        style={{
                                          display: 'flex',
                                          alignItems: 'center',
                                          gap: '6px',
                                        }}
                                      >
                                        {isPrimaryKey && (
                                          <span
                                            style={{ fontSize: '12px', color: '#3b82f6' }}
                                          >
                                            ♂
                                          </span>
                                        )}
                                        {isForeignKey && (
                                          <span
                                            style={{ fontSize: '12px', color: '#a855f7' }}
                                          >
                                            ↔
                                          </span>
                                        )}
                                        <BufferedInput
                                          type="text"
                                          value={field.fieldName || ''}
                                          onCommit={(value) =>
                                            handleUpdateField(
                                              index,
                                              originalIndex,
                                              'fieldName',
                                              value,
                                            )
                                          }
                                          style={{
                                            border: 'none',
                                            background: 'transparent',
                                            fontSize: '13px',
                                            fontWeight: 600,
                                            color: '#0f172a',
                                            width: '100%',
                                            padding: '2px 0',
                                          }}
                                          placeholder="字段名"
                                        />
                                      </div>

                                      {/* 类型 */}
                                      <div>
                                        <BufferedInput
                                          type="text"
                                          value={field.fieldType || ''}
                                          onCommit={(value) =>
                                            handleUpdateField(
                                              index,
                                              originalIndex,
                                              'fieldType',
                                              value,
                                            )
                                          }
                                          style={{
                                            border: 'none',
                                            background: 'transparent',
                                            fontSize: '13px',
                                            fontFamily: 'monospace',
                                            color: '#64748b',
                                            width: '100%',
                                            padding: '2px 0',
                                          }}
                                          placeholder="类型"
                                        />
                                      </div>

                                      {/* 必填 - 按钮样式 */}
                                      <div
                                        style={{ display: 'flex', alignItems: 'center' }}
                                      >
                                        <button
                                          type="button"
                                          onClick={() => {
                                            handleUpdateField(
                                              index,
                                              originalIndex,
                                              'required',
                                              !field.required,
                                            );
                                          }}
                                          style={{
                                            fontSize: '12px',
                                            fontWeight: 500,
                                            padding: '4px 10px',
                                            borderRadius: '4px',
                                            border: 'none',
                                            cursor: 'pointer',
                                            background: field.required
                                              ? '#fee2e2'
                                              : '#f1f5f9',
                                            color: field.required ? '#dc2626' : '#64748b',
                                            transition: 'all 0.2s',
                                          }}
                                          onMouseEnter={(e) => {
                                            if (field.required) {
                                              e.currentTarget.style.background = '#fecaca';
                                            } else {
                                              e.currentTarget.style.background = '#e2e8f0';
                                            }
                                          }}
                                          onMouseLeave={(e) => {
                                            e.currentTarget.style.background =
                                              field.required ? '#fee2e2' : '#f1f5f9';
                                          }}
                                        >
                                          {field.required ? '是' : '否'}
                                        </button>
                                      </div>

                                      {/* 说明 */}
                                      <div
                                        style={{
                                          display: 'flex',
                                          flexDirection: 'column',
                                          gap: '4px',
                                        }}
                                      >
                                        <BufferedInput
                                          type="text"
                                          value={field.comment || ''}
                                          onCommit={(value) =>
                                            handleUpdateField(
                                              index,
                                              originalIndex,
                                              'comment',
                                              value,
                                            )
                                          }
                                          style={{
                                            border: 'none',
                                            background: 'transparent',
                                            fontSize: '13px',
                                            color: '#64748b',
                                            width: '100%',
                                            padding: '2px 0',
                                          }}
                                          placeholder="说明"
                                        />
                                        {/* 外键关系显示 */}
                                        {isForeignKey &&
                                          table.foreignKeys &&
                                          (() => {
                                            const fkLines = table.foreignKeys
                                              .split('\n')
                                              .filter((line: string) => line.trim());
                                            // 查找包含当前字段名的外键关系行
                                            const relatedFk = fkLines.find(
                                              (line: string) => {
                                                const trimmed = line.trim();
                                                return (
                                                  trimmed.startsWith(
                                                    field.fieldName + ' ->',
                                                  ) ||
                                                  trimmed.startsWith(
                                                    field.fieldName + '->',
                                                  ) ||
                                                  trimmed === field.fieldName
                                                );
                                              },
                                            );
                                            if (relatedFk) {
                                              // 提取外键关系部分（-> 后面的内容）
                                              const fkMatch = relatedFk.match(/->\s*(.+)/);
                                              const fkRelation = fkMatch
                                                ? fkMatch[1].trim()
                                                : relatedFk.trim();
                                              return (
                                                <div
                                                  style={{
                                                    fontSize: '11px',
                                                    color: '#a855f7',
                                                    marginLeft: '12px',
                                                    display: 'flex',
                                                    alignItems: 'center',
                                                    gap: '4px',
                                                  }}
                                                >
                                                  <span>↪</span>
                                                  <span style={{ fontFamily: 'monospace' }}>
                                                    {fkRelation}
                                                  </span>
                                                </div>
                                              );
                                            }
                                            return null;
                                          })()}
                                      </div>

                                      {/* 删除按钮 */}
                                      <div
                                        style={{
                                          display: 'flex',
                                          justifyContent: 'flex-end',
                                          alignItems: 'center',
                                        }}
                                      >
                                        <button
                                          onClick={() =>
                                            handleDeleteField(index, originalIndex)
                                          }
                                          style={{
                                            color: '#cbd5e1',
                                            background: 'none',
                                            border: 'none',
                                            cursor: 'pointer',
                                            fontSize: '20px',
                                            padding: '0 4px',
                                            transition: 'color 0.2s',
                                            lineHeight: '1',
                                          }}
                                          onMouseEnter={(e) =>
                                            (e.currentTarget.style.color = '#ef4444')
                                          }
                                          onMouseLeave={(e) =>
                                            (e.currentTarget.style.color = '#cbd5e1')
                                          }
                                          title="删除字段"
                                        >
                                          ×
                                        </button>
                                      </div>
                                    </div>
                                  );
                                })}
                            </div>
                          </div>
                        </>
                      ) : (
                        <div
                          style={{
                            fontSize: '13px',
                            color: '#cbd5e1',
                            fontStyle: 'italic',
                            textAlign: 'center',
                            padding: '20px',
                          }}
                        >
                          暂无字段
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
});
