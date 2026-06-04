export const fields = {
  serialNumber: {
    type: 'string',
    required: true,
    label: 'Serial Number',
    message: 'Please enter Serial Number',
  },
  serialNumberLong: {
    type: 'string',
    label: 'Serial Number (Long)',
  },
  description_en: {
    type: 'string',
    required: true,
    label: 'Description (EN)',
    message: 'Please enter Description (En)',
  },
  description_cn: {
    type: 'string',
    label: 'Description (CN)',
  },
  weight: {
    type: 'number',
    label: 'Weight (kg)',
  },
  VAT: {
    type: 'number',
    label: 'VAT (%)',
  },
  ETR: {
    type: 'number',
    label: 'ETR (%)',
  },
  unit_en: {
    type: 'string',
    required: true,
    label: 'Unit (EN)',
    message: 'Please enter Unit (En)',
  },
  unit_cn: {
    type: 'string',
    label: 'Unit (CN)',
  },
};
