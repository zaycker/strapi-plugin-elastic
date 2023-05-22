const pluginPkg = require('../../package.json');

const pluginId = pluginPkg.name.replace(/^@zrpaplicacoes\/strapi-plugin-/i, '');

module.exports = pluginId;
