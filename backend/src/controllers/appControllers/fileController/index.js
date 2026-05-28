const createCRUDController = require('@/controllers/middlewaresControllers/createCRUDController');
const methods = createCRUDController('File');

const upload = require('./upload');
const getTranscript = require('./getTranscript');
const list = require('./list');

methods.create = upload;
methods.getTranscript = getTranscript;
methods.list = list;

module.exports = methods;
