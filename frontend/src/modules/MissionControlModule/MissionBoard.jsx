import { Empty, Badge } from 'antd';
import MissionCard from './MissionCard';
import { STAGES, MATRIX_COLUMNS } from './constants';

const COL_STATUS = { processing: 'processing', awaiting_approval: 'warning', done: 'success' };

function PipelineView({ missions, onSelect }) {
  return (
    <div className="mc-board mc-board--pipeline">
      {STAGES.map((stage) => {
        const items = missions.filter((m) => m.stage === stage.key);
        return (
          <div className="mc-col" key={stage.key} style={{ '--stage-color': stage.color }}>
            <div className="mc-col-head">
              <Badge
                color={stage.color}
                text={
                  <span className="mc-col-title" style={{ color: '#262626', fontWeight: 600 }}>
                    {stage.label}
                  </span>
                }
              />
              <Badge
                count={items.length}
                showZero
                style={{
                  backgroundColor: '#f0f2f5',
                  color: '#8c8c8c',
                  boxShadow: 'none',
                  fontWeight: 600,
                }}
              />
            </div>
            <div className="mc-col-body">
              {items.length === 0
                ? <div className="mc-col-empty">No active items</div>
                : items.map((m) => <MissionCard key={m.id} mission={m} onClick={onSelect} />)
              }
            </div>
          </div>
        );
      })}
    </div>
  );
}

function MatrixView({ missions, onSelect }) {
  return (
    <div
      className="mc-board mc-board--matrix"
      style={{ gridTemplateColumns: `160px repeat(${MATRIX_COLUMNS.length}, 1fr)` }}
    >
      {/* Corner */}
      <div className="mc-matrix-corner" />

      {/* Column headers — one outer table, no Card wrappers */}
      {MATRIX_COLUMNS.map((col) => (
        <div className="mc-matrix-colhead" key={col.key}>
          <Badge status={COL_STATUS[col.key] || 'default'} />
          <div className="mc-matrix-colhead-text">
            <span className="mc-matrix-colhead-label">{col.label}</span>
            <span className="mc-matrix-colhead-desc">{col.desc}</span>
          </div>
        </div>
      ))}

      {/* Stage rows */}
      {STAGES.map((stage) => (
        <div className="mc-matrix-row" key={stage.key} style={{ display: 'contents' }}>
          <div className="mc-matrix-rowhead" style={{ '--stage-color': stage.color }}>
            <span className="mc-col-dot" style={{ background: stage.color }} />
            {stage.label}
          </div>
          {MATRIX_COLUMNS.map((col) => {
            const items = missions.filter(
              (m) => m.stage === stage.key && col.states.includes(m.agentState),
            );
            return (
              <div className="mc-matrix-cell" key={col.key}>
                {items.map((m) => <MissionCard key={m.id} mission={m} onClick={onSelect} />)}
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
}

export default function MissionBoard({ missions, layout, onSelect }) {
  if (!missions?.length) {
    return <div style={{ padding: '60px 0', textAlign: 'center' }}><Empty description="No active tasks" /></div>;
  }
  return layout === 'matrix'
    ? <MatrixView missions={missions} onSelect={onSelect} />
    : <PipelineView missions={missions} onSelect={onSelect} />;
}
