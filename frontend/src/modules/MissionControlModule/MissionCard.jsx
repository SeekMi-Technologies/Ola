import { Avatar, Tooltip } from 'antd';
import {
  WhatsAppOutlined, MailOutlined, WechatOutlined,
  ClockCircleOutlined, ThunderboltOutlined,
} from '@ant-design/icons';
import { STAGE_MAP, AGENT_STATES, CHANNELS, timeAgo } from './constants';

const CHANNEL_ICON = {
  whatsapp: WhatsAppOutlined,
  email: MailOutlined,
  wechat: WechatOutlined,
};

// Agent state → a single dot color; no text label on the card (keep cards minimal)
const STATE_DOT = {
  processing: '#1677ff',
  awaiting_approval: '#faad14',
  idle: '#d9d9d9',
  done: '#52c41a',
};

export default function MissionCard({ mission, onClick }) {
  const stage = STAGE_MAP[mission.stage];
  const agent = AGENT_STATES[mission.agentState];
  const channel = CHANNELS[mission.channel];
  const ChannelIcon = CHANNEL_ICON[mission.channel] || MailOutlined;
  const needsAction = mission.pendingActionCount > 0;

  return (
    <div
      className={`mc-card${needsAction ? ' mc-card--urgent' : ''}`}
      style={{ '--stage-color': stage?.color }}
      onClick={() => onClick?.(mission)}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && onClick?.(mission)}
    >
      {/* Urgent banner — the only non-neutral color element on a card */}
      {needsAction && (
        <div className="mc-card-banner">
          <ThunderboltOutlined />
          <span>Action Required · {mission.pendingActionCount}</span>
        </div>
      )}

      {/* Row 1: channel + client + state dot */}
      <div className="mc-card-head">
        {/* Channel icon — neutral gray, tooltip shows the channel name */}
        <Tooltip title={channel?.label} placement="top">
          <span className="mc-card-channel">
            <ChannelIcon />
          </span>
        </Tooltip>
        <span className="mc-card-client">{mission.client.name}</span>
        {/* State dot only — label visible on hover / in drawer */}
        <Tooltip title={agent?.label} placement="top">
          <span className="mc-card-state-dot" style={{ background: STATE_DOT[mission.agentState] }} />
        </Tooltip>
      </div>

      {/* Row 2: condensed summary */}
      <p className="mc-card-summary">{mission.summary}</p>

      {/* Row 3: amount · time · assignee — right-aligned, all muted */}
      <div className="mc-card-foot">
        {mission.linkedQuote
          ? <span className="mc-card-amount">
              {mission.linkedQuote.currency}&nbsp;{mission.linkedQuote.total.toLocaleString()}
            </span>
          : <span />
        }
        <div className="mc-card-foot-right">
          <span className="mc-card-time">
            <ClockCircleOutlined />&nbsp;{timeAgo(mission.lastActivityAt)}
          </span>
          <Avatar size={20} style={{ background: '#f0f0f0', color: '#888', fontSize: 11, fontWeight: 600 }}>
            {mission.assignedTo?.initial}
          </Avatar>
        </div>
      </div>
    </div>
  );
}
