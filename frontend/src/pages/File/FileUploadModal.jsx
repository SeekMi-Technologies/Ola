import { useState } from 'react';
import { Modal, Upload, Button, Alert, message } from 'antd';
import { InboxOutlined } from '@ant-design/icons';

import { request } from '@/request';
import useLanguage from '@/locale/useLanguage';

const MAX_BYTES = 50 * 1024 * 1024;

export default function FileUploadModal({ open, onCancel, onSuccess }) {
  const translate = useLanguage();
  const [fileList, setFileList] = useState([]);
  const [uploading, setUploading] = useState(false);

  const reset = () => {
    setFileList([]);
    setUploading(false);
  };

  const handleCancel = () => {
    if (uploading) return;
    reset();
    if (onCancel) onCancel();
  };

  const handleUpload = async () => {
    const file = fileList[0];
    if (!file) {
      message.warning(translate('please_select_a_file'));
      return;
    }
    setUploading(true);
    const formData = new FormData();
    formData.append('file', file.originFileObj || file);
    const resp = await request.createAndUpload({
      entity: 'file',
      jsonData: formData,
    });
    setUploading(false);
    if (resp.success) {
      reset();
      if (onSuccess) onSuccess(resp.result);
    }
  };

  return (
    <Modal
      title={translate('upload_file')}
      open={open}
      onCancel={handleCancel}
      maskClosable={!uploading}
      keyboard={!uploading}
      footer={[
        <Button key="cancel" onClick={handleCancel} disabled={uploading}>
          {translate('cancel')}
        </Button>,
        <Button
          key="upload"
          type="primary"
          loading={uploading}
          onClick={handleUpload}
          disabled={fileList.length === 0}
        >
          {translate('upload')}
        </Button>,
      ]}
    >
      <Upload.Dragger
        name="file"
        accept="audio/*"
        maxCount={1}
        multiple={false}
        fileList={fileList}
        beforeUpload={(file) => {
          if (file.size > MAX_BYTES) {
            message.error(translate('file_too_large_50mb'));
            return Upload.LIST_IGNORE;
          }
          if (!file.type || !file.type.startsWith('audio/')) {
            message.error(translate('audio_files_only'));
            return Upload.LIST_IGNORE;
          }
          setFileList([file]);
          return false;
        }}
        onRemove={() => {
          setFileList([]);
          return true;
        }}
        disabled={uploading}
      >
        <p className="ant-upload-drag-icon">
          <InboxOutlined />
        </p>
        <p className="ant-upload-text">{translate('click_or_drag_to_upload')}</p>
        <p className="ant-upload-hint">{translate('audio_only_50mb')}</p>
      </Upload.Dragger>

      <Alert
        style={{ marginTop: 16 }}
        message={translate('audio_upload_note')}
        type="info"
        showIcon
      />
    </Modal>
  );
}
