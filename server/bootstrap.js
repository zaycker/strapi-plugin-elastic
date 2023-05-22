const { Client } = require('@elastic/elasticsearch');

const {
  helper: { generateMainConfig, initialStrapi },
} = require('./services');
const {
  logger,
  migrateModel,
  find,
  findOne,
  createOrUpdate,
  destroy,
  migrateById,
} = require('./services');

const registerPermissionActions = () => {
  const { actionProvider } = strapi.admin.services.permission;
  actionProvider.register({
    section: 'plugins',
    displayName: 'Read',
    uid: 'read',
    pluginName: 'elasticsearch',
  });
};

module.exports = async () => {
  /**
   * generate elasticsearch config file
   */
  generateMainConfig();

  /**
   * initialize strapi.$es object
   */
  if (strapi.config.elasticsearch) {
    const { connection } = strapi.config.elasticsearch;

    strapi.$es = new Client(connection);

    await initialStrapi();

    const functions = {
      findOne,
      find,
      destroy,
      createOrUpdate,
      migrateModel,
      transferModelData: migrateModel,
      migrateById,
      transferModelDataById: migrateById,
      log: logger,
    };

    Object.assign(strapi.$es, functions);

    if (strapi.server.app.env !== 'test') {
      strapi.log.info('The elastic plugin is running');
    }
  }

  registerPermissionActions();
};
