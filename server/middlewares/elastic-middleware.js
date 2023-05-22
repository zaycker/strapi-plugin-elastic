const { elasticsearchManager } = require('../services');

module.exports = () => {
  return async (ctx, next) => {
    await next();

    await elasticsearchManager(ctx);
  };
};
