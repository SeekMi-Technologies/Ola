import { useState, useMemo } from 'react';
import { Input, Segmented, Typography, Space } from 'antd';
import { AppstoreOutlined, TableOutlined, SearchOutlined } from '@ant-design/icons';
import MOCK_MISSIONS from '@/mock/missionMockData';
import MissionBoard from './MissionBoard';
import MissionDrawer from './MissionDrawer';

const { Title, Text } = Typography;

export default function MissionControlModule() {
  const [layout, setLayout] = useState('pipeline');
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(null);

  const missions = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return MOCK_MISSIONS;
    return MOCK_MISSIONS.filter(
      (m) =>
        m.client.name.toLowerCase().includes(q) ||
        m.summary.toLowerCase().includes(q),
    );
  }, [query]);

  return (
    <div className="mc-root">
      <div className="mc-header">
        <div>
          <Title level={4} style={{ margin: 0 }}>Mission Control</Title>
          <Text type="secondary" style={{ fontSize: 13 }}>
            Lead-to-Quote tracker · {missions.length} active
          </Text>
        </div>
        <Space size={12}>
          <Input
            allowClear
            prefix={<SearchOutlined style={{ color: '#bbb' }} />}
            placeholder="Search by client or summary"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            style={{ width: 240 }}
          />
          <Segmented
            value={layout}
            onChange={setLayout}
            options={[
              { value: 'pipeline', icon: <AppstoreOutlined />, label: 'Pipeline' },
              { value: 'matrix',   icon: <TableOutlined />,    label: 'Matrix' },
            ]}
          />
        </Space>
      </div>

      <MissionBoard missions={missions} layout={layout} onSelect={setActive} />
      <MissionDrawer mission={active} open={!!active} onClose={() => setActive(null)} />
    </div>
  );
}
