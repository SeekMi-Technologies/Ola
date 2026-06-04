import { Drawer, Steps, Tag, Divider } from 'antd';
import {
  WhatsAppOutlined, MailOutlined, WechatOutlined,
  AimOutlined, LinkOutlined, ToolOutlined,
} from '@ant-design/icons';
import { STAGES, AGENT_STATES, stageIndex } from './constants';
import ReportFeed from './ReportFeed';
import MissionComposer from './MissionComposer';

const CHANNEL_ICON = { whatsapp: WhatsAppOutlined, email: MailOutlined, wechat: WechatOutlined };

const STATE_DOT = {
  processing: '#1677ff',
  awaiting_approval: '#faad14',
  idle: '#d9d9d9',
  done: '#52c41a',
};

export default function MissionDrawer({ mission, open, onClose }) {
  if (!mission) return <Drawer open={false} onClose={onClose} />;

  const agent = AGENT_STATES[mission.agentState];
  const ChannelIcon = CHANNEL_ICON[mission.channel] || MailOutlined;

  const title = (
    <div className="mc-drawer-title">
      <span className="mc-drawer-channel"><ChannelIcon /></span>
      <span className="mc-drawer-client">{mission.client.name}</span>
      <span className="mc-card-state-dot" style={{ background: STATE_DOT[mission.agentState] }} />
      <span style={{ fontSize: 12, color: '#aaa' }}>{agent?.label}</span>
    </div>
  );

  return (
    <Drawer
      title={title}
      open={open}
      onClose={onClose}
      placement="right"
      width={680}
      footer={<MissionComposer defaultChannel={mission.channel} />}
      styles={{
        footer: { padding: '12px 16px', borderTop: '1px solid #f0f0f0' },
        header: { borderBottom: '1px solid #f0f0f0' },
      }}
    >
      <Steps
        size="small"
        current={stageIndex(mission.stage)}
        status={mission.stage === 'won' ? 'finish' : 'process'}
        items={STAGES.map((s) => ({ title: s.short }))}
        style={{ marginBottom: 20 }}
      />

      <div className="mc-context">
        <div className="mc-context-row">
          <AimOutlined className="mc-context-icon" />
          <span className="mc-context-label">Goal</span>
          <span className="mc-context-val">{mission.goal}</span>
        </div>
        <div className="mc-context-row">
          <LinkOutlined className="mc-context-icon" />
          <span className="mc-context-label">Linked</span>
          <span className="mc-context-val">
            {mission.linkedEntities.map((e) => (
              <Tag key={`${e.type}-${e.label}`} style={{ marginBottom: 2 }}>
                {e.type}: {e.label}
              </Tag>
            ))}
          </span>
        </div>
        {mission.tools?.length > 0 && (
          <div className="mc-context-row">
            <ToolOutlined className="mc-context-icon" />
            <span className="mc-context-label">Tools</span>
            <span className="mc-context-val">
              {mission.tools.map((t) => (
                <Tag key={t} style={{ fontFamily: 'monospace', marginBottom: 2 }}>
                  {t}
                </Tag>
              ))}
            </span>
          </div>
        )}
      </div>

      <Divider style={{ margin: '16px 0 12px' }}>
        <span style={{ fontSize: 11, color: '#bbb', fontWeight: 600, letterSpacing: '0.5px', textTransform: 'uppercase' }}>
          Agent Report
        </span>
      </Divider>

      <ReportFeed blocks={mission.report} />
    </Drawer>
  );
}
