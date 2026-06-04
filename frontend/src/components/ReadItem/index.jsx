import { useEffect, useState } from 'react';
import { useSelector } from 'react-redux';

import dayjs from 'dayjs';
import { dataForRead } from '@/utils/dataStructure';
import { countryList } from '@/utils/countryList';

import { useCrudContext } from '@/context/crud';
import { selectCurrentItem } from '@/redux/crud/selectors';
import { valueByString } from '@/utils/helpers';

import useLanguage from '@/locale/useLanguage';
import { useDate } from '@/settings';
import { Descriptions } from 'antd';

export default function ReadItem({ config }) {
  const { dateFormat } = useDate();
  let { readColumns, fields } = config;
  const translate = useLanguage();
  const { result: currentResult } = useSelector(selectCurrentItem);
  const { state } = useCrudContext();
  const { isReadBoxOpen } = state;
  const [listState, setListState] = useState([]);

  if (fields) readColumns = [...dataForRead({ fields: fields, translate: translate })];

  useEffect(() => {
    const list = [];
    if (readColumns && currentResult) {
      readColumns.forEach((props) => {
        const propsKey = props.dataIndex;
        const propsTitle = props.title;
        const isDate = props.isDate || false;
        let value = valueByString(currentResult, propsKey);
        value = isDate ? dayjs(value).format(dateFormat) : value;

        if (props.type === 'country' && value) {
          const selectedCountry = countryList.find(
            (obj) => obj.value === value || obj.label === value
          );
          if (selectedCountry) {
            value = (
              <span style={{ fontSize: '13px', fontWeight: 500 }}>
                {selectedCountry.icon && selectedCountry.icon + ' '}
                {translate(selectedCountry.label)}
              </span>
            );
          }
        }

        list.push({ propsKey, label: propsTitle, value: value });
      });
    }
    setListState(list);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentResult]);

  const show = isReadBoxOpen ? { display: 'block', opacity: 1 } : { display: 'none', opacity: 0 };

  const capitalizeFirstLetter = (str) => {
    if (!str) return '';
    return str.charAt(0).toUpperCase() + str.slice(1);
  };

  return (
    <div style={show}>
      <Descriptions
        bordered
        column={1}
        size="small"
        labelStyle={{
          width: '160px',
          color: '#4b5563',
          fontWeight: 500,
          backgroundColor: '#fafafa',
          padding: '8px 12px',
        }}
        contentStyle={{
          color: '#1f2937',
          fontWeight: 500,
          backgroundColor: '#ffffff',
          padding: '8px 12px',
          wordBreak: 'break-word',
        }}
        style={{
          border: '1px solid #f0f0f0',
          borderRadius: '8px',
          overflow: 'hidden',
          marginBottom: '24px',
          boxShadow: '0 1px 2px rgba(0, 0, 0, 0.02)',
        }}
      >
        {listState.map((item) => (
          <Descriptions.Item key={item.propsKey} label={capitalizeFirstLetter(item.label)}>
            {item.value || '-'}
          </Descriptions.Item>
        ))}
      </Descriptions>
    </div>
  );
}
