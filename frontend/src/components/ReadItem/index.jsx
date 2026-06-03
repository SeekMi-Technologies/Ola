import { useEffect, useState } from 'react';
import { useSelector } from 'react-redux';

import dayjs from 'dayjs';
import { dataForRead } from '@/utils/dataStructure';

import { useCrudContext } from '@/context/crud';
import { selectCurrentItem } from '@/redux/crud/selectors';
import { valueByString } from '@/utils/helpers';

import useLanguage from '@/locale/useLanguage';
import { useDate } from '@/settings';

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

  const itemsList = listState.map((item, idx) => {
    const isLast = idx === listState.length - 1;
    return (
      <div
        key={item.propsKey}
        style={{
          display: 'flex',
          padding: '10px 0',
          fontSize: '13.5px',
          alignItems: 'baseline',
          lineHeight: '1.5',
          borderBottom: isLast ? 'none' : '1px solid #f3f4f6',
        }}
      >
        <div
          style={{
            width: '100px',
            color: '#6b7280',
            flexShrink: 0,
            fontWeight: 400,
          }}
        >
          {capitalizeFirstLetter(item.label)}
        </div>
        <div
          style={{
            color: '#1f2937',
            fontWeight: 500,
            wordBreak: 'break-word',
          }}
        >
          {item.value || '-'}
        </div>
      </div>
    );
  });

  return (
    <div
      style={{
        ...show,
        background: '#f9fafb',
        border: '1px solid #f3f4f6',
        borderRadius: '12px',
        padding: '4px 16px',
        boxShadow: '0 1px 2px rgba(0, 0, 0, 0.02)',
        marginBottom: '24px',
      }}
    >
      {itemsList}
    </div>
  );
}
