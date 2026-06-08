import { useEffect, useState } from 'react';
import {
  EyeOutlined,
  EditOutlined,
  DeleteOutlined,
  FilePdfOutlined,
  RedoOutlined,
  PlusOutlined,
  EllipsisOutlined,
} from '@ant-design/icons';
import { Dropdown, Table, Button } from 'antd';
import { PageHeader } from '@ant-design/pro-layout';

import AutoCompleteAsync from '@/components/AutoCompleteAsync';
import { useSelector, useDispatch } from 'react-redux';
import useLanguage from '@/locale/useLanguage';
import { erp } from '@/redux/erp/actions';
import { selectListItems } from '@/redux/erp/selectors';
import { useErpContext } from '@/context/erp';
import { generate as uniqueId } from 'shortid';
import { useNavigate } from 'react-router-dom';

import { DOWNLOAD_BASE_URL } from '@/config/serverApiConfig';

// Normalize an AntD dataIndex / sorter.field (string or array) to a dot-path ('client.name').
const toFieldPath = (field) => (Array.isArray(field) ? field.join('.') : field);

// Build backend sort query params from a { field, order } descriptor.
// No order → empty, so the backend falls back to its default `created` desc.
const buildSortOptions = (sort) =>
  sort?.order ? { sortBy: sort.field, sortValue: sort.order === 'ascend' ? 1 : -1 } : {};

function AddNewItem({ config }) {
  const navigate = useNavigate();
  const { ADD_NEW_ENTITY, entity } = config;

  const handleClick = () => {
    navigate(`/${entity.toLowerCase()}/create`);
  };

  return (
    <Button onClick={handleClick} type="primary" icon={<PlusOutlined />}>
      {ADD_NEW_ENTITY}
    </Button>
  );
}

export default function DataTable({ config, extra = [] }) {
  const translate = useLanguage();
  let { entity, dataTableColumns, disableAdd = false, searchConfig } = config;

  const { DATATABLE_TITLE } = config;

  const { result: listResult, isLoading: listIsLoading } = useSelector(selectListItems);

  const { pagination, items: dataSource } = listResult;

  const { erpContextAction } = useErpContext();
  const { modal } = erpContextAction;

  const items = [
    {
      label: translate('Show'),
      key: 'read',
      icon: <EyeOutlined />,
    },
    {
      label: translate('Edit'),
      key: 'edit',
      icon: <EditOutlined />,
    },
    {
      label: translate('Download'),
      key: 'download',
      icon: <FilePdfOutlined />,
    },
    ...extra,
    {
      type: 'divider',
    },

    {
      label: translate('Delete'),
      key: 'delete',
      icon: <DeleteOutlined />,
    },
  ];

  const dispatch = useDispatch();
  const navigate = useNavigate();

  const handleRead = (record) => {
    dispatch(erp.currentItem({ data: record }));
    navigate(`/${entity}/read/${record._id}`);
  };
  const handleEdit = (record) => {
    const data = { ...record };
    dispatch(erp.currentAction({ actionType: 'update', data }));
    navigate(`/${entity}/update/${record._id}`);
  };
  const handleDownload = (record) => {
    window.open(`${DOWNLOAD_BASE_URL}${entity}/${entity}-${record._id}.pdf?v=${Date.now()}`, '_blank');
  };

  const handleDelete = (record) => {
    dispatch(erp.currentAction({ actionType: 'delete', data: record }));
    modal.open();
  };

  const handleRecordPayment = (record) => {
    dispatch(erp.currentItem({ data: record }));
    navigate(`/invoice/pay/${record._id}`);
  };

  dataTableColumns = [
    ...dataTableColumns,
    {
      title: '',
      key: 'action',
      fixed: 'right',
      render: (_, record) => (
        <Dropdown
          menu={{
            items,
            onClick: ({ key }) => {
              switch (key) {
                case 'read':
                  handleRead(record);
                  break;
                case 'edit':
                  handleEdit(record);
                  break;
                case 'download':
                  handleDownload(record);
                  break;
                case 'delete':
                  handleDelete(record);
                  break;
                case 'recordPayment':
                  handleRecordPayment(record);
                  break;
                default:
                  break;
              }
              // else if (key === '2')handleCloseTask
            },
          }}
          trigger={['click']}
        >
          <EllipsisOutlined
            style={{ cursor: 'pointer', fontSize: '24px' }}
            onClick={(e) => {
              e.stopPropagation();
            }}
          />
        </Dropdown>
      ),
    },
  ];

  // Sort is React-controlled so the header arrow and the data order can never diverge.
  // Seed from the column flagged with defaultSortOrder (e.g. date desc).
  const defaultSortCol = dataTableColumns.find((c) => c.defaultSortOrder);
  const [sortState, setSortState] = useState(
    defaultSortCol
      ? { field: toFieldPath(defaultSortCol.dataIndex), order: defaultSortCol.defaultSortOrder }
      : null
  );

  // Single load path: every fetch carries the current sort, so Refresh / filter / paging stay consistent.
  const fetchList = (sort, extra = {}) => {
    dispatch(erp.list({ entity, options: { ...buildSortOptions(sort), ...extra } }));
  };

  const handelDataTableLoad = (pagination, _filters, sorter = {}) => {
    const next = sorter?.order ? { field: toFieldPath(sorter.field), order: sorter.order } : null;
    setSortState(next);
    fetchList(next, { page: pagination?.current || 1, items: pagination?.pageSize || 10 });
  };

  useEffect(() => {
    fetchList(sortState);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const filterTable = (value) => {
    fetchList(sortState, { equal: value, filter: searchConfig?.entity });
  };

  // Drive each sortable column's arrow from sortState (controlled).
  const columnsWithSort = dataTableColumns.map((c) =>
    c.sorter
      ? { ...c, sortOrder: sortState?.field === toFieldPath(c.dataIndex) ? sortState.order : null }
      : c
  );

  return (
    <>
      <PageHeader
        title={DATATABLE_TITLE}
        ghost={true}
        extra={[
          <AutoCompleteAsync
            key={`${uniqueId()}`}
            entity={searchConfig?.entity}
            displayLabels={['name']}
            searchFields={'name'}
            onChange={filterTable}
            // redirectLabel={'Add New Client'}
            // withRedirect
            // urlToRedirect={'/customer'}
          />,
          <Button onClick={() => fetchList(sortState)} key={`${uniqueId()}`} icon={<RedoOutlined />}>
            {translate('Refresh')}
          </Button>,

          !disableAdd && <AddNewItem config={config} key={`${uniqueId()}`} />,
        ]}
        style={{
          padding: '20px 0px',
        }}
      ></PageHeader>

      <Table
        columns={columnsWithSort}
        rowKey={(item) => item._id}
        dataSource={dataSource}
        pagination={pagination}
        loading={listIsLoading}
        onChange={handelDataTableLoad}
        scroll={{ x: true }}
        onRow={(record) => ({
          onClick: () => handleRead(record),
          style: { cursor: 'pointer' },
        })}
      />
    </>
  );
}
