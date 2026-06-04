import { useState } from 'react';
import { Segmented, Mentions, Button, Space, message } from 'antd';
import { WhatsAppOutlined, MailOutlined, WechatOutlined, SendOutlined, RobotOutlined } from '@ant-design/icons';
import { CHANNELS } from './constants';

const MENTION_OPTIONS = [
  { value: 'Client:current', label: '@Client (current customer)' },
  { value: 'Merch:WR-6001', label: '@Merch:WR-6001' },
  { value: 'Factory:Jiangsu-WR', label: '@Factory:Jiangsu Wire Rope' },
  { value: 'Quote:current', label: '@Quote (linked)' },
  { value: 'agent:merch-matcher', label: '@merch-matcher (agent)' },
  { value: 'agent:quote-drafter', label: '@quote-drafter (agent)' },
  { value: 'agent:price-researcher', label: '@price-researcher (agent)' },
];

const CHANNEL_OPTS = [
  { value: 'whatsapp', label: <><WhatsAppOutlined /> WhatsApp</> },
  { value: 'email',    label: <><MailOutlined /> Email</> },
  { value: 'wechat',  label: <><WechatOutlined /> WeChat</> },
];

export default function MissionComposer({ defaultChannel = 'whatsapp' }) {
  const [channel, setChannel] = useState(defaultChannel);
  const [value, setValue] = useState('');

  const send = () => {
    if (!value.trim()) { message.warning('Message is empty'); return; }
    message.success(`(Demo) Sent via ${CHANNELS[channel]?.label}`);
    setValue('');
  };

  return (
    <div className="mc-composer">
      <div className="mc-composer-top">
        <Segmented size="small" value={channel} onChange={setChannel} options={CHANNEL_OPTS} />
      </div>
      <Mentions
        className="mc-composer-input"
        autoSize={{ minRows: 2, maxRows: 4 }}
        value={value}
        onChange={setValue}
        options={MENTION_OPTIONS}
        prefix="@"
        placeholder={`Reply via ${CHANNELS[channel]?.label} — type @ to reference an entity or agent`}
      />
      <div className="mc-composer-actions">
        <Space>
          <Button size="small" icon={<RobotOutlined />} onClick={() => message.info('(Demo) Ola is drafting a reply…')}>
            Draft with Ola
          </Button>
          <Button size="small" type="primary" icon={<SendOutlined />} onClick={send}>
            Send via {CHANNELS[channel]?.label}
          </Button>
        </Space>
      </div>
    </div>
  );
}
