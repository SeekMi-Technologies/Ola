import { useState } from 'react';
import { DatePicker, Input, Form, Select, InputNumber, Switch, Tag } from 'antd';

import { CloseOutlined, CheckOutlined } from '@ant-design/icons';
import useLanguage from '@/locale/useLanguage';
import { useMoney, useDate } from '@/settings';
import AutoCompleteAsync from '@/components/AutoCompleteAsync';
import SelectAsync from '@/components/SelectAsync';
import { generate as uniqueId } from 'shortid';

import { countryList } from '@/utils/countryList';

const AutoWidthInput = ({ value, onChange, placeholder, isUpdateForm = false, ...props }) => {
  const getVisualLength = (str) => {
    if (!str) return 0;
    let len = 0;
    for (let i = 0; i < str.length; i++) {
      if (str.charCodeAt(i) > 127) {
        len += 1.8;
      } else {
        len += 1;
      }
    }
    return len;
  };

  if (isUpdateForm) {
    return (
      <Input.TextArea
        value={value}
        placeholder={placeholder}
        onChange={onChange}
        autoSize={{ minRows: 1 }}
        style={{
          width: '100%',
          color: '#1f2937',
          fontWeight: 500,
          fontSize: '13.5px',
          lineHeight: '1.5',
          padding: '0 0',
          margin: '0',
          resize: 'none',
          borderRadius: '4px',
          border: '1px solid transparent',
          background: 'transparent',
          transition: 'border-color 0.2s, background 0.2s',
          wordBreak: 'break-word',
        }}
        onFocus={(e) => {
          e.target.style.borderColor = '#d1d5db';
          e.target.style.background = '#ffffff';
        }}
        onBlur={(e) => {
          e.target.style.borderColor = 'transparent';
          e.target.style.background = 'transparent';
        }}
        {...props}
      />
    );
  }

  const charCount = value ? getVisualLength(value.toString()) : 0;
  const placeholderCount = placeholder ? getVisualLength(placeholder.toString()) : 0;
  const displayLength = Math.max(charCount, placeholderCount);
  const calculatedWidth = Math.max(140, Math.min(300, displayLength * 8.5 + 24));

  return (
    <Input
      value={value}
      placeholder={placeholder}
      onChange={onChange}
      style={{
        width: `${calculatedWidth}px`,
        maxWidth: '100%',
        transition: 'width 0.15s',
        color: '#1f2937',
        fontWeight: 500,
        fontSize: '13.5px',
      }}
      {...props}
    />
  );
};

const AutoWidthCountrySelect = ({ value, onChange, translate, isUpdateForm = false }) => {
  const getVisualLength = (str) => {
    if (!str) return 0;
    let len = 0;
    for (let i = 0; i < str.length; i++) {
      if (str.charCodeAt(i) > 127) {
        len += 1.8;
      } else {
        len += 1;
      }
    }
    return len;
  };

  const selectedCountry = countryList.find(
    (obj) => obj.value === value || obj.label === value
  );
  const resolvedValue = selectedCountry ? selectedCountry.value : value;
  const labelText = selectedCountry ? translate(selectedCountry.label) : '';
  const length = getVisualLength(labelText.toString());

  const style = isUpdateForm
    ? {
        width: 'calc(100% + 11px)',
        marginLeft: '-11px',
        color: '#1f2937',
        fontWeight: 500,
        fontSize: '13.5px',
      }
    : {
        width: `${Math.max(140, Math.min(300, length * 8.5 + 45))}px`,
        maxWidth: '100%',
        transition: 'width 0.15s',
        color: '#1f2937',
        fontWeight: 500,
        fontSize: '13.5px',
      };

  return (
    <Select
      showSearch
      value={resolvedValue}
      onChange={onChange}
      optionFilterProp="children"
      variant={isUpdateForm ? 'borderless' : undefined}
      filterOption={(input, option) =>
        (option?.label ?? '').toLowerCase().includes(input.toLowerCase())
      }
      filterSort={(optionA, optionB) =>
        (optionA?.label ?? '').toLowerCase().startsWith((optionB?.label ?? '').toLowerCase())
      }
      style={style}
    >
      {countryList.map((language) => (
        <Select.Option
          key={language.value}
          value={language.value}
          label={translate(language.label)}
        >
          {language?.icon && language?.icon + ' '}
          {translate(language.label)}
        </Select.Option>
      ))}
    </Select>
  );
};

export default function DynamicForm({ fields, isUpdateForm = false }) {
  const [feedback, setFeedback] = useState();
  const total = Object.keys(fields).length;

  return (
    <div>
      {Object.keys(fields).map((key, idx) => {
        let field = fields[key];

        if ((isUpdateForm && !field.disableForUpdate) || !field.disableForForm) {
          field.name = key;
          if (!field.label) field.label = key;
          if (field.hasFeedback)
            return (
              <FormElement
                feedback={feedback}
                setFeedback={setFeedback}
                key={key}
                field={field}
                isUpdateForm={isUpdateForm}
                idx={idx}
                total={total}
              />
            );
          else if (feedback && field.feedback) {
            if (feedback == field.feedback)
              return (
                <FormElement
                  key={key}
                  field={field}
                  isUpdateForm={isUpdateForm}
                  idx={idx}
                  total={total}
                />
              );
          } else {
            return (
              <FormElement
                key={key}
                field={field}
                isUpdateForm={isUpdateForm}
                idx={idx}
                total={total}
              />
            );
          }
        }
      })}
    </div>
  );
}

function FormElement({ field, feedback, setFeedback, isUpdateForm = false, idx = 0, total = 0 }) {
  const translate = useLanguage();
  const money = useMoney();
  const { dateFormat } = useDate();

  const { TextArea } = Input;

  const SelectComponent = () => (
    <Form.Item
      label={translate(field.label)}
      name={field.name}
      rules={[
        {
          required: field.required || false,
          type: filedType[field.type] ?? 'any',
        },
      ]}
    >
      <Select
        showSearch={field.showSearch}
        defaultValue={field.defaultValue}
        style={{
          width: '100%',
        }}
      >
        {field.options?.map((option) => {
          return (
            <Select.Option key={`${uniqueId()}`} value={option.value}>
              {option.label}
            </Select.Option>
          );
        })}
      </Select>
    </Form.Item>
  );

  const SelectWithTranslationComponent = () => (
    <Form.Item
      label={translate(field.label)}
      name={field.name}
      rules={[
        {
          required: field.required || false,
          type: filedType[field.type] ?? 'any',
        },
      ]}
    >
      <Select
        defaultValue={field.defaultValue}
        style={{
          width: '100%',
        }}
      >
        {field.options?.map((option) => {
          return (
            <Select.Option key={`${uniqueId()}`} value={option.value}>
              <Tag bordered={false} color={option.color}>
                {translate(option.label)}
              </Tag>
            </Select.Option>
          );
        })}
      </Select>
    </Form.Item>
  );
  const SelectWithFeedbackComponent = ({ feedbackValue, lanchFeedback }) => (
    <Form.Item
      label={translate(field.label)}
      name={field.name}
      rules={[
        {
          required: field.required || false,
          type: filedType[field.type] ?? 'any',
        },
      ]}
    >
      <Select
        onSelect={(value) => lanchFeedback(value)}
        value={feedbackValue}
        style={{
          width: '100%',
        }}
      >
        {field.options?.map((option) => (
          <Select.Option key={`${uniqueId()}`} value={option.value}>
            {translate(option.label)}
          </Select.Option>
        ))}
      </Select>
    </Form.Item>
  );
  const ColorComponent = () => (
    <Form.Item
      label={translate(field.label)}
      name={field.name}
      rules={[
        {
          required: field.required || false,
          type: filedType[field.type] ?? 'any',
        },
      ]}
    >
      <Select
        showSearch
        defaultValue={field.defaultValue}
        filterOption={(input, option) =>
          (option?.label ?? '').toLowerCase().includes(input.toLowerCase())
        }
        filterSort={(optionA, optionB) =>
          (optionA?.label ?? '').toLowerCase().startsWith((optionB?.label ?? '').toLowerCase())
        }
        style={{
          width: '100%',
        }}
      >
        {field.options?.map((option) => {
          return (
            <Select.Option key={`${uniqueId()}`} value={option.value} label={option.label}>
              <Tag bordered={false} color={option.color}>
                {option.label}
              </Tag>
            </Select.Option>
          );
        })}
      </Select>
    </Form.Item>
  );
  const TagComponent = () => (
    <Form.Item
      label={translate(field.label)}
      name={field.name}
      rules={[
        {
          required: field.required || false,
          type: filedType[field.type] ?? 'any',
        },
      ]}
    >
      <Select
        defaultValue={field.defaultValue}
        style={{
          width: '100%',
        }}
      >
        {field.options?.map((option) => (
          <Select.Option key={`${uniqueId()}`} value={option.value}>
            <Tag bordered={false} color={option.color}>
              {translate(option.label)}
            </Tag>
          </Select.Option>
        ))}
      </Select>
    </Form.Item>
  );
  const ArrayComponent = () => (
    <Form.Item
      label={translate(field.label)}
      name={field.name}
      rules={[
        {
          required: field.required || false,
          type: filedType[field.type] ?? 'any',
        },
      ]}
    >
      <Select
        mode={'multiple'}
        defaultValue={field.defaultValue}
        style={{
          width: '100%',
        }}
      >
        {field.options?.map((option) => (
          <Select.Option key={`${uniqueId()}`} value={option.value}>
            {option.label}
          </Select.Option>
        ))}
      </Select>
    </Form.Item>
  );
  const CountryComponent = () => (
    <Form.Item
      label={translate(field.label)}
      name={field.name}
      rules={[
        {
          required: field.required || false,
          type: filedType[field.type] ?? 'any',
        },
      ]}
    >
      <AutoWidthCountrySelect translate={translate} />
    </Form.Item>
  );

  const SearchComponent = () => {
    return (
      <Form.Item
        label={translate(field.label)}
        name={field.name}
        rules={[
          {
            required: field.required || false,
            type: filedType[field.type] ?? 'any',
          },
        ]}
      >
        <AutoCompleteAsync
          entity={field.entity}
          displayLabels={field.displayLabels}
          searchFields={field.searchFields}
          outputValue={field.outputValue}
          withRedirect={field.withRedirect}
          urlToRedirect={field.urlToRedirect}
          redirectLabel={field.redirectLabel}
        ></AutoCompleteAsync>
      </Form.Item>
    );
  };

  const formItemComponent = {
    select: <SelectComponent />,
    selectWithTranslation: <SelectWithTranslationComponent />,
    selectWithFeedback: (
      <SelectWithFeedbackComponent lanchFeedback={setFeedback} feedbackValue={feedback} />
    ),
    color: <ColorComponent />,

    tag: <TagComponent />,
    array: <ArrayComponent />,
    country: <CountryComponent />,
    search: <SearchComponent />,
  };

  const compunedComponent = {
    string: (
      <AutoWidthInput autoComplete="off" maxLength={field.maxLength} defaultValue={field.defaultValue} />
    ),
    url: <Input addonBefore="http://" autoComplete="off" placeholder="www.example.com" />,
    textarea: <TextArea rows={4} />,
    email: <AutoWidthInput autoComplete="off" placeholder="email@example.com" />,
    number: <InputNumber style={{ width: '100%' }} />,
    phone: <AutoWidthInput autoComplete="off" placeholder="+1 123 456 789" />,
    boolean: (
      <Switch
        checkedChildren={<CheckOutlined />}
        unCheckedChildren={<CloseOutlined />}
        defaultValue={true}
      />
    ),
    date: (
      <DatePicker
        placeholder={translate('select_date')}
        style={{ width: '100%' }}
        format={dateFormat}
      />
    ),
    async: (
      <SelectAsync
        entity={field.entity}
        displayLabels={field.displayLabels}
        outputValue={field.outputValue}
        loadDefault={field.loadDefault}
        withRedirect={field.withRedirect}
        urlToRedirect={field.urlToRedirect}
        redirectLabel={field.redirectLabel}
      ></SelectAsync>
    ),

    currency: (
      <InputNumber
        className="moneyInput"
        min={0}
        controls={false}
        addonAfter={money.currency_position === 'after' ? money.currency_symbol : undefined}
        addonBefore={money.currency_position === 'before' ? money.currency_symbol : undefined}
      />
    ),
  };

  const filedType = {
    string: 'string',
    textarea: 'string',
    number: 'number',
    phone: 'string',
    //boolean: 'boolean',
    // method: 'method',
    // regexp: 'regexp',
    // integer: 'integer',
    // float: 'float',
    // array: 'array',
    // object: 'object',
    // enum: 'enum',
    // date: 'date',
    url: 'url',
    website: 'url',
    email: 'email',
  };

  const customFormItem = formItemComponent[field.type];
  let renderComponent = compunedComponent[field.type];

  if (!renderComponent) {
    renderComponent = compunedComponent['string'];
  }

  if (isUpdateForm) {
    const isLast = idx === total - 1;
    let inputNode;

    if (field.type === 'country') {
      inputNode = <AutoWidthCountrySelect translate={translate} isUpdateForm={true} />;
    } else if (field.type === 'string' || field.type === 'email' || field.type === 'phone') {
      inputNode = (
        <AutoWidthInput
          autoComplete="off"
          maxLength={field.maxLength}
          placeholder={translate(field.label)}
          defaultValue={field.defaultValue}
          isUpdateForm={true}
        />
      );
    } else if (field.type === 'number') {
      inputNode = (
        <InputNumber
          variant="borderless"
          placeholder={translate(field.label)}
          style={{
            width: 'calc(100% + 11px)',
            marginLeft: '-11px',
            color: '#1f2937',
            fontWeight: 500,
            fontSize: '13.5px',
            background: 'transparent',
          }}
        />
      );
    } else {
      inputNode = customFormItem || renderComponent;
    }

    const capitalizeFirstLetter = (str) => {
      if (!str) return '';
      return str.charAt(0).toUpperCase() + str.slice(1);
    };

    return (
      <div
        key={field.name}
        style={{
          display: 'flex',
          padding: '10px 0',
          fontSize: '13.5px',
          alignItems: 'flex-start',
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
            paddingTop: '1px',
          }}
        >
          {capitalizeFirstLetter(translate(field.label))}
          {field.required && (
            <span style={{ color: '#ff4d4f', marginLeft: '4px' }}>*</span>
          )}
        </div>
        <div style={{ flexGrow: 1, minWidth: 0, overflow: 'hidden' }}>
          <Form.Item
            name={field.name}
            style={{ marginBottom: 0 }}
            rules={[
              {
                required: field.required || false,
                type: filedType[field.type] ?? 'any',
                message: field.message ? translate(field.message) : undefined,
              },
            ]}
            valuePropName={field.type === 'boolean' ? 'checked' : 'value'}
          >
            {inputNode}
          </Form.Item>
        </div>
      </div>
    );
  }

  if (customFormItem) return <>{customFormItem}</>;
  else {
    return (
      <Form.Item
        label={translate(field.label)}
        name={field.name}
        rules={[
          {
            required: field.required || false,
            type: filedType[field.type] ?? 'any',
          },
        ]}
        valuePropName={field.type === 'boolean' ? 'checked' : 'value'}
      >
        {renderComponent}
      </Form.Item>
    );
  }
}
