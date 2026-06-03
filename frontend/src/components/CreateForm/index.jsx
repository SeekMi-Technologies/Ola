import { useEffect } from 'react';

import { useDispatch, useSelector } from 'react-redux';
import { crud } from '@/redux/crud/actions';
import { useCrudContext } from '@/context/crud';
import { selectCreatedItem } from '@/redux/crud/selectors';

import useLanguage from '@/locale/useLanguage';

import { Button, Form } from 'antd';
import { PlusOutlined, EditOutlined, DeleteOutlined } from '@ant-design/icons';
import Loading from '@/components/Loading';

export default function CreateForm({ config, formElements, withUpload = false }) {
  let { entity } = config;
  const dispatch = useDispatch();
  const { isLoading, isSuccess } = useSelector(selectCreatedItem);
  const { crudContextAction } = useCrudContext();
  const { panel, collapsedBox, readBox } = crudContextAction;
  const [form] = Form.useForm();
  const translate = useLanguage();
  const onSubmit = (fieldsValue) => {
    // Manually trim values before submission

    if (fieldsValue.file && withUpload) {
      fieldsValue.file = fieldsValue.file[0].originFileObj;
    }

    // const trimmedValues = Object.keys(fieldsValue).reduce((acc, key) => {
    //   acc[key] = typeof fieldsValue[key] === 'string' ? fieldsValue[key].trim() : fieldsValue[key];
    //   return acc;
    // }, {});

    dispatch(crud.create({ entity, jsonData: fieldsValue, withUpload }));
  };

  useEffect(() => {
    if (isSuccess) {
      readBox.open();
      collapsedBox.open();
      panel.open();
      form.resetFields();
      dispatch(crud.resetAction({ actionType: 'create' }));
      dispatch(crud.list({ entity }));
    }
  }, [isSuccess]);

  return (
    <Loading isLoading={isLoading}>
      <Form form={form} layout="vertical" onFinish={onSubmit}>
        <div style={{
          display: 'flex', gap: '8px', marginBottom: '16px',
          borderBottom: '1px solid #f3f4f6', paddingBottom: '12px', alignItems: 'center',
        }}>
          <Button disabled type="dashed" icon={<PlusOutlined />} size="small"
            style={{ borderRadius: '6px', fontSize: '12px' }}>{translate('add_new')}</Button>
          <Button disabled type="text" icon={<EditOutlined />} size="small"
            style={{ borderRadius: '6px', fontSize: '12px', background: '#f3f4f6' }}>{translate('edit')}</Button>
          <Button disabled type="text" danger icon={<DeleteOutlined />} size="small"
            style={{ borderRadius: '6px', fontSize: '12px', background: '#fef2f2' }}>{translate('remove')}</Button>
          <div style={{ marginLeft: 'auto', display: 'flex', gap: '8px' }}>
            <Button type="primary" htmlType="submit" size="small"
              style={{ borderRadius: '6px', fontSize: '12px', background: '#10b981', borderColor: '#10b981' }}>
              {translate('Submit')}
            </Button>
            <Button size="small" style={{ borderRadius: '6px', fontSize: '12px' }}
              onClick={() => collapsedBox.open()}>
              {translate('Cancel')}
            </Button>
          </div>
        </div>
        <div style={{
          background: '#ffffff',
          border: '1px solid #f3f4f6',
          borderRadius: '12px',
          padding: '4px 16px',
          boxShadow: '0 1px 2px rgba(0, 0, 0, 0.02)',
          marginBottom: '24px',
        }}>
          {formElements}
        </div>
      </Form>
    </Loading>
  );
}
