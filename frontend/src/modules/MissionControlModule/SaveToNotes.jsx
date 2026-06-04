import { useState } from 'react';
import { Popover, Radio, Button, Space, Typography, message } from 'antd';
import { PushpinOutlined } from '@ant-design/icons';

const TARGET_LABELS = {
  client: 'This client',
  merch: 'Merchandise',
  factory: 'Factory',
};

export default function SaveToNotes({ payload, targetTypes = ['client', 'merch', 'factory'] }) {
  const [open, setOpen] = useState(false);
  const [target, setTarget] = useState(targetTypes[0]);

  const content = (
    <div style={{ width: 200 }} onClick={(e) => e.stopPropagation()}>
      <Typography.Text type="secondary" style={{ fontSize: 12 }}>Save to</Typography.Text>
      <div style={{ margin: '8px 0' }}>
        <Radio.Group value={target} onChange={(e) => setTarget(e.target.value)}>
          <Space direction="vertical" size={4}>
            {targetTypes.map((t) => (
              <Radio key={t} value={t}>{TARGET_LABELS[t]}</Radio>
            ))}
          </Space>
        </Radio.Group>
      </div>
      {payload && (
        <Typography.Paragraph
          ellipsis={{ rows: 2 }}
          style={{ fontSize: 11, color: '#aaa', background: '#fafafa', padding: '4px 8px', borderRadius: 4, marginBottom: 8 }}
        >
          {payload}
        </Typography.Paragraph>
      )}
      <Button
        type="primary" size="small" block
        onClick={() => { setOpen(false); message.success(`Saved to ${TARGET_LABELS[target]} notes (demo)`); }}
      >
        Save note
      </Button>
    </div>
  );

  return (
    <Popover content={content} title={null} trigger="click" open={open} onOpenChange={setOpen} placement="leftTop">
      <button className="mc-pin-btn" title="Save to notes" onClick={(e) => e.stopPropagation()}>
        <PushpinOutlined />
      </button>
    </Popover>
  );
}
