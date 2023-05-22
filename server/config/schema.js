'use strict';

const yup = require('yup');

const pluginConfigSchema = yup.object().shape({
  hashidsSalt: yup.string(),
  hashidsPad: yup.number(),
  hashidsAlphabet: yup.string(),
});

module.exports = {
	pluginConfigSchema,
};
