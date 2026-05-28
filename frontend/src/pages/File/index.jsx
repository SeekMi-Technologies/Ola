import { useState, useEffect, useCallback, useMemo } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { Button, Input, Space, Typography, message } from 'antd';
import { PlusOutlined, ReloadOutlined } from '@ant-design/icons';

import { crud } from '@/redux/crud/actions';
import { selectListItems } from '@/redux/crud/selectors';
import useLanguage from '@/locale/useLanguage';

import FileDataTable from './FileDataTable';
import FileUploadModal from './FileUploadModal';
import TranscriptDrawer from './TranscriptDrawer';

const ENTITY = 'file';

export default function FilePage() {
  const translate = useLanguage();
  const dispatch = useDispatch();
  const listState = useSelector(selectListItems);
  const items = useMemo(() => listState?.result?.items || [], [listState]);
  const isLoading = !!listState?.isLoading;

  const [searchQuery, setSearchQuery] = useState('');
  const [uploadOpen, setUploadOpen] = useState(false);
  const [drawerFileId, setDrawerFileId] = useState(null);

  const refresh = useCallback(() => {
    dispatch(
      crud.list({ entity: ENTITY, options: { page: 1, items: 100 } })
    );
  }, [dispatch]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const filtered = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return items;
    return items.filter((it) =>
      (it.originalName || '').toLowerCase().includes(q)
    );
  }, [items, searchQuery]);

  const handleUploadSuccess = () => {
    setUploadOpen(false);
    refresh();
    message.success(translate('file_upload_success'));
  };

  return (
    <div style={{ padding: '24px' }}>
      <Typography.Title level={3} style={{ marginBottom: 16 }}>
        {translate('file')}
      </Typography.Title>

      <Space style={{ marginBottom: 16 }} wrap>
        <Button
          type="primary"
          icon={<PlusOutlined />}
          onClick={() => setUploadOpen(true)}
        >
          {translate('upload_file')}
        </Button>
        <Button
          icon={<ReloadOutlined />}
          onClick={refresh}
          loading={isLoading}
        >
          {translate('refresh')}
        </Button>
        <Input.Search
          placeholder={translate('search_by_filename')}
          allowClear
          style={{ width: 300 }}
          onChange={(e) => setSearchQuery(e.target.value)}
        />
      </Space>

      <FileDataTable
        items={filtered}
        loading={isLoading}
        onViewTranscript={(fileId) => setDrawerFileId(fileId)}
        onDeleted={refresh}
      />

      <FileUploadModal
        open={uploadOpen}
        onCancel={() => setUploadOpen(false)}
        onSuccess={handleUploadSuccess}
      />

      <TranscriptDrawer
        fileId={drawerFileId}
        open={!!drawerFileId}
        onClose={() => setDrawerFileId(null)}
      />
    </div>
  );
}
