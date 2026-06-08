import dayjs from 'dayjs';
import { Tag } from 'antd';
import { tagColor } from '@/utils/statusTagColor';
import PODataTableModule from '@/modules/POModule/PODataTableModule';
import { useMoney, useDate } from '@/settings';
import useLanguage from '@/locale/useLanguage';

export default function PurchaseOrder() {
  const translate = useLanguage();
  const { dateFormat } = useDate();
  const entity = 'purchaseorder';
  const { moneyFormatter } = useMoney();

  const searchConfig = {
    entity: 'factory',
    displayLabels: ['factory_code', 'factory_name'],
    searchFields: 'factory_code,factory_name',
  };
  const deleteModalLabels = ['number', 'factory.factory_name'];
  const dataTableColumns = [
    {
      title: translate('Number'),
      dataIndex: 'number',
      sorter: true,
    },
    {
      title: translate('Factory'),
      dataIndex: ['factory', 'factory_name'],
      render: (_, record) => `${record.factory?.factory_code} - ${record.factory?.factory_name}`,
    },
    {
      title: translate('Date'),
      dataIndex: 'date',
      sorter: true,
      defaultSortOrder: 'descend',
      render: (date) => {
        return dayjs(date).format(dateFormat);
      },
    },
    {
      title: translate('expired Date'),
      dataIndex: 'expiredDate',
      sorter: true,
      render: (date) => {
        return dayjs(date).format(dateFormat);
      },
    },
    {
      title: translate('Sub Total'),
      dataIndex: 'subTotal',
      onCell: () => {
        return {
          style: {
            textAlign: 'right',
            whiteSpace: 'nowrap',
            direction: 'ltr',
          },
        };
      },
      render: (total, record) => moneyFormatter({ amount: total, currency_code: record.currency }),
    },
    {
      title: translate('Total'),
      dataIndex: 'total',
      sorter: true,
      onCell: () => {
        return {
          style: {
            textAlign: 'right',
            whiteSpace: 'nowrap',
            direction: 'ltr',
          },
        };
      },
      render: (total, record) => moneyFormatter({ amount: total, currency_code: record.currency }),
    },
    {
      title: translate('Status'),
      dataIndex: 'status',
      sorter: true,
      render: (status) => {
        let tagStatus = tagColor(status);
        return (
          <Tag color={tagStatus.color}>
            {status && translate(tagStatus.label)}
          </Tag>
        );
      },
    },
  ];

  const Labels = {
    PANEL_TITLE: translate('purchase_order'),
    DATATABLE_TITLE: translate('purchase_order_list'),
    ADD_NEW_ENTITY: translate('add_new_purchase_order'),
    ENTITY_NAME: translate('purchase_order'),
  };

  const configPage = {
    entity,
    ...Labels,
  };
  const config = {
    ...configPage,
    dataTableColumns,
    searchConfig,
    deleteModalLabels,
  };
  return <PODataTableModule config={config} />;
}
