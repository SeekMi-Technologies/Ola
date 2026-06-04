export const fields = {
  name: {
    type: 'string',
    required: true,
    message: 'Please enter Name',
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


