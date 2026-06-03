export const fields = {
  name: {
    type: 'string',
    required: true,
    message: 'Please enter name',
  },
  country: {
    type: 'country',
    // color: 'red',
  },
  address: {
    type: 'string',
  },
  phone: {
    type: 'phone',
  },
  email: {
    type: 'email',
  },
};


