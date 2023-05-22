"use strict";

const {pluginConfigSchema} = require("./schema");

module.exports = {
  default: () => ({
    hashidsSalt: undefined,
    hashidsPad: undefined,
    hashidsAlphabet: undefined,
  }),
  validator: async (config) => {
    await pluginConfigSchema.validate(config);
  },
};
