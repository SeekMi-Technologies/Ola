import { useState, useEffect, useCallback, useMemo } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { Button, Input, message } from 'antd';
import { PlusOutlined, ReloadOutlined } from '@ant-design/icons';
import { PageHeader } from '@ant-design/pro-layout';

import { crud } from '@/redux/crud/actions';
import { selectListItems } from '@/redux/crud/selectors';
import useLanguage from '@/locale/useLanguage';
import { ErpLayout } from '@/layout';

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
    <ErpLayout>
      <PageHeader
        title={translate('file')}
        ghost={true}
        extra={[
          <Input.Search
            key="search"
            placeholder={translate('search_by_filename')}
            allowClear
            style={{ width: 250 }}
            onChange={(e) => setSearchQuery(e.target.value)}
          />,
          <Button
            key="refresh"
            icon={<ReloadOutlined />}
            onClick={refresh}
            loading={isLoading}
          >
            {translate('refresh')}
          </Button>,
          <Button
            key="upload"
            type="primary"
            icon={<PlusOutlined />}
            onClick={() => setUploadOpen(true)}
          >
            {translate('upload_file')}
          </Button>,
        ]}
        style={{
          padding: '20px 0px',
        }}
      />

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
    </ErpLayout>
  );
}
