const mongoose = require('mongoose');

const schema = new mongoose.Schema({
  removed: {
    type: Boolean,
    default: false
  },
  createdBy: { type: mongoose.Schema.ObjectId, ref: 'Admin' },

  factory_code: {
    type: String,
    required: true,
    key: true
  },
  factory_name: {
    type: String
  },
  location: {
    type: String
  },
  contact: {
    type: String
  },
  tel1: {
    type: String
  },
  tel2: {
    type: String
  }
});

schema.plugin(require('mongoose-autopopulate'));

module.exports = mongoose.model('Factory', schema);



