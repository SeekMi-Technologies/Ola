import { useMemo, useCallback } from 'react';
import { Table, Tag, Dropdown, Button, Modal, message, Tooltip } from 'antd';
import {
  CustomerServiceOutlined,
  FilePdfOutlined,
  FileImageOutlined,
  FileExcelOutlined,
  FileOutlined,
  CheckCircleFilled,
  ExclamationCircleFilled,
  LoadingOutlined,
  MoreOutlined,
} from '@ant-design/icons';
import dayjs from 'dayjs';

import { request } from '@/request';
import useLanguage from '@/locale/useLanguage';

function formatBytes(n) {
  if (!Number.isFinite(n) || n <= 0) return '-';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

function fileKind(mimeType) {
  if (!mimeType) return 'other';
  if (mimeType.startsWith('audio/')) return 'audio';
  if (mimeType.startsWith('image/')) return 'image';
  if (mimeType === 'application/pdf') return 'pdf';
  if (
    mimeType === 'application/vnd.ms-excel' ||
    mimeType ===
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  )
    return 'excel';
  return 'other';
}

function KindIcon({ kind }) {
  switch (kind) {
    case 'audio':
      return <CustomerServiceOutlined style={{ color: '#722ed1' }} />;
    case 'pdf':
      return <FilePdfOutlined style={{ color: '#cf1322' }} />;
    case 'image':
      return <FileImageOutlined style={{ color: '#13c2c2' }} />;
    case 'excel':
      return <FileExcelOutlined style={{ color: '#52c41a' }} />;
    default:
      return <FileOutlined />;
  }
}

function StatusTag({ transcriptionStatus, kind, translate }) {
  if (kind !== 'audio') {
    return (
      <Tag icon={<CheckCircleFilled />} color="default">
        {translate('file_status_ready')}
      </Tag>
    );
  }
  switch (transcriptionStatus) {
    case 'done':
      return (
        <Tag icon={<CheckCircleFilled />} color="success">
          {translate('file_status_ready')}
        </Tag>
      );
    case 'running':
    case 'pending':
      return (
        <Tag icon={<LoadingOutlined spin />} color="processing">
          {translate('file_status_processing')}
        </Tag>
      );
    case 'failed':
      return (
        <Tag icon={<ExclamationCircleFilled />} color="error">
          {translate('file_status_failed')}
        </Tag>
      );
    default:
      return (
        <Tag color="default">
          {translate('file_status_unknown')}
        </Tag>
      );
  }
}

export default function FileDataTable({
  items,
  loading,
  onViewTranscript,
  onDeleted,
}) {
  const translate = useLanguage();

  const handleDelete = useCallback(
    (record) => {
      Modal.confirm({
        title: translate('confirm_delete_file'),
        content: record.originalName,
        okType: 'danger',
        okText: translate('delete'),
        cancelText: translate('cancel'),
        onOk: async () => {
          const resp = await request.delete({ entity: 'file', id: record._id });
          if (resp.success) {
            message.success(translate('file_delete_success'));
            if (onDeleted) onDeleted();
          }
        },
      });
    },
    [translate, onDeleted]
  );

  const columns = useMemo(
    () => [
      {
        title: translate('file_name'),
        dataIndex: 'originalName',
        key: 'originalName',
        render: (name, record) => {
          const kind = fileKind(record.mimeType);
          return (
            <span>
              <KindIcon kind={kind} />
              <span style={{ marginLeft: 8 }}>{name}</span>
            </span>
          );
        },
      },
      {
        title: translate('file_kind'),
        key: 'kind',
        width: 100,
        render: (_, record) => {
          const kind = fileKind(record.mimeType);
          return translate(`file_kind_${kind}`);
        },
      },
      {
        title: translate('file_size'),
        dataIndex: 'sizeBytes',
        key: 'sizeBytes',
        width: 100,
        render: formatBytes,
      },
      {
        title: translate('file_status'),
        key: 'status',
        width: 140,
        render: (_, record) => (
          <StatusTag
            transcriptionStatus={record.transcriptionStatus}
            kind={fileKind(record.mimeType)}
            translate={translate}
          />
        ),
      },
      {
        title: translate('uploaded_at'),
        dataIndex: 'created',
        key: 'created',
        width: 160,
        render: (v) => (v ? dayjs(v).format('YYYY-MM-DD HH:mm') : '-'),
      },
      {
        title: translate('actions'),
        key: 'actions',
        width: 80,
        render: (_, record) => {
          const kind = fileKind(record.mimeType);
          const canViewTranscript =
            kind === 'audio' && record.transcriptionStatus === 'done';
          const menuItems = [];
          if (canViewTranscript) {
            menuItems.push({
              key: 'view',
              label: translate('view_transcript'),
              onClick: () => onViewTranscript(record._id),
            });
          }
          menuItems.push({
            key: 'delete',
            label: translate('delete'),
            danger: true,
            onClick: () => handleDelete(record),
          });
          return (
            <Dropdown menu={{ items: menuItems }} trigger={['click']}>
              <Tooltip title={translate('actions')}>
                <Button type="text" icon={<MoreOutlined />} />
              </Tooltip>
            </Dropdown>
          );
        },
      },
    ],
    [translate, onViewTranscript, handleDelete]
  );

  return (
    <Table
      rowKey="_id"
      columns={columns}
      dataSource={items}
      loading={loading}
      pagination={{ pageSize: 20, showSizeChanger: false }}
    />
  );
}
