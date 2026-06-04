import { useState, useMemo } from 'react';
import { Input, Segmented } from 'antd';
import { AppstoreOutlined, TableOutlined, SearchOutlined } from '@ant-design/icons';
import { PageHeader } from '@ant-design/pro-layout';
import MOCK_MISSIONS from '@/mock/missionMockData';
import MissionBoard from './MissionBoard';
import MissionDrawer from './MissionDrawer';

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
      <PageHeader
        title="Tasks"
        subTitle={`Lead-to-Quote tracker · ${missions.length} active`}
        ghost={false}
        style={{
          padding: '0 0 20px 0',
          background: 'transparent',
        }}
        extra={[
          <Input
            key="search"
            allowClear
            prefix={<SearchOutlined style={{ color: '#bbb' }} />}
            placeholder="Search by client or summary"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            style={{ width: 240, borderRadius: '6px' }}
          />,
          <Segmented
            key="layout"
            value={layout}
            onChange={setLayout}
            options={[
              { value: 'pipeline', icon: <AppstoreOutlined />, label: 'Pipeline' },
              { value: 'matrix',   icon: <TableOutlined />,    label: 'Matrix' },
            ]}
          />
        ]}
      />

      <MissionBoard missions={missions} layout={layout} onSelect={setActive} />
      <MissionDrawer mission={active} open={!!active} onClose={() => setActive(null)} />
    </div>
  );
}
