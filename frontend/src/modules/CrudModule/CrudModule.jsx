import { useLayoutEffect } from 'react';
import { Row, Col, Button } from 'antd';
import { PlusOutlined, EditOutlined, DeleteOutlined, CloseOutlined } from '@ant-design/icons';

import CreateForm from '@/components/CreateForm';
import UpdateForm from '@/components/UpdateForm';
import DeleteModal from '@/components/DeleteModal';
import ReadItem from '@/components/ReadItem';
import SearchItem from '@/components/SearchItem';
import DataTable from '@/components/DataTable/DataTable';

import { useDispatch, useSelector } from 'react-redux';

import { selectCurrentItem } from '@/redux/crud/selectors';
import useLanguage from '@/locale/useLanguage';
import { crud } from '@/redux/crud/actions';
import { useCrudContext } from '@/context/crud';

import { CrudLayout } from '@/layout';

function SidePanelTopContent({ config, formElements, withUpload, extraReadContent }) {
  const translate = useLanguage();
  const { crudContextAction, state } = useCrudContext();
  const { modal, editBox, collapsedBox, readBox } = crudContextAction;

  const { isReadBoxOpen, isEditBoxOpen } = state;
  const { result: currentItem } = useSelector(selectCurrentItem);
  const dispatch = useDispatch();

  const removeItem = () => {
    dispatch(crud.currentAction({ actionType: 'delete', data: currentItem }));
    modal.open();
  };
  const editItem = () => {
    dispatch(crud.currentAction({ actionType: 'update', data: currentItem }));
    editBox.open();
  };
  const addNewItem = () => {
    collapsedBox.close(); // Open Create form
  };

  const show = isReadBoxOpen || isEditBoxOpen ? { opacity: 1 } : { opacity: 0 };
  return (
    <>
      <div
        style={{
          ...show,
          display: 'flex',
          justifyContent: 'flex-start',
          alignItems: 'center',
          gap: '8px',
          marginBottom: '16px',
          borderBottom: '1px solid #f3f4f6',
          paddingBottom: '12px',
        }}
      >
        <Button
          onClick={addNewItem}
          disabled={isEditBoxOpen}
          type="dashed"
          icon={<PlusOutlined />}
          size="small"
          style={{ borderRadius: '6px', fontSize: '12px' }}
        >
          {translate('add_new')}
        </Button>
        <Button
          onClick={editItem}
          disabled={isEditBoxOpen}
          type="text"
          icon={<EditOutlined />}
          size="small"
          style={{ borderRadius: '6px', fontSize: '12px', background: '#f3f4f6' }}
        >
          {translate('edit')}
        </Button>
        <Button
          onClick={removeItem}
          disabled={isEditBoxOpen}
          type="text"
          danger
          icon={<DeleteOutlined />}
          size="small"
          style={{ borderRadius: '6px', fontSize: '12px', background: '#fef2f2' }}
        >
          {translate('remove')}
        </Button>

        {isEditBoxOpen && (
          <div style={{ marginLeft: 'auto', display: 'flex', gap: '8px' }}>
            <Button
              onClick={() => {
                document.getElementById('update-form-submit-btn')?.click();
              }}
              type="primary"
              size="small"
              style={{
                borderRadius: '6px',
                fontSize: '12px',
                background: '#10b981',
                borderColor: '#10b981',
              }}
            >
              {translate('Save')}
            </Button>
            <Button
              onClick={() => {
                dispatch(crud.resetAction({ actionType: 'update' }));
                readBox.open();
              }}
              size="small"
              style={{ borderRadius: '6px', fontSize: '12px' }}
            >
              {translate('Cancel')}
            </Button>
          </div>
        )}
      </div>
      <ReadItem config={config} />
      <UpdateForm config={config} formElements={formElements} withUpload={withUpload} />
      {(isReadBoxOpen || isEditBoxOpen) && extraReadContent}
    </>
  );
}

function FixHeaderPanel({ config }) {
  const { crudContextAction, state } = useCrudContext();
  const { isBoxCollapsed } = state;
  const { collapsedBox } = crudContextAction;

  const handleCancelCreate = () => {
    collapsedBox.open(); // Return to read mode
  };

  return (
    <Row gutter={8} style={{ marginBottom: '16px' }}>
      <Col className="gutter-row" span={24}>
        <SearchItem config={config} />
      </Col>
    </Row>
  );
}

function CrudModule({ config, createForm, updateForm, withUpload = false, extraReadContent }) {
  const dispatch = useDispatch();

  useLayoutEffect(() => {
    dispatch(crud.resetState());
  }, []);

  return (
    <CrudLayout
      config={config}
      fixHeaderPanel={<FixHeaderPanel config={config} />}
      sidePanelBottomContent={
        <CreateForm config={config} formElements={createForm} withUpload={withUpload} />
      }
      sidePanelTopContent={
        <SidePanelTopContent
          config={config}
          formElements={updateForm}
          withUpload={withUpload}
          extraReadContent={extraReadContent}
        />
      }
    >
      <DataTable config={config} />
      <DeleteModal config={config} />
    </CrudLayout>
  );
}

export default CrudModule;
