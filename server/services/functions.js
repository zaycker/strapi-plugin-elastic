const _ = require('lodash');
const { compareDataWithMap } = require('./helper');

module.exports = {
  /**
   *
   * @param {string} model
   * @param {Object|number|string} pk
   */
  findOne: async (model, pk) => {
    const { models } = strapi.config.elasticsearch;
    const targetModel = models.find((item) => item.model === model);

    const id = _.isObject(pk) ? pk.id : pk;

    if (!id) {
      strapi.log.error('Parameter ID is not valid');
      return;
    }

    if (!targetModel) {
      strapi.log.error('Model not found');
      return;
    }

    return strapi.$es.get({
      index: targetModel.index,
      id,
    });
  },
  /**
   *
   * @param {string} model
   * @param {Object|string|number} pk
   */
  destroy: async (model, pk) => {
    if (pk.id_in && !_.isArray(pk.id_in)) {
      strapi.log.error('id_in must be array');
      return;
    }

    const id_in = !_.isObject(pk) ? [pk] : pk.id_in || [pk.id];

    const { models } = strapi.config.elasticsearch;
    const targetModel = models.find((item) => item.model === model);

    if (!id_in) {
      strapi.log.error('pk parameter is not valid');
    }

    if (!targetModel) {
      strapi.log.error('model notfound');
      return;
    }

    const body = id_in.map((id) => {
      return {
        delete: {
          _index: targetModel.index,
          _id: id,
        },
      };
    });

    try {
      return strapi.$es.bulk({ body });
    } catch (e) {
      strapi.log.error(e.message);
    }
  },
  /**
   *
   * @param {string} model
   * @param {Object} param1
   */
  createOrUpdate: async (model, { id, data }) => {
    const { models } = strapi.config.elasticsearch;
    const targetModel = await models.find((item) => item.model === model);

    if (!data) {
      strapi.log.error('No data to index');
      return;
    }

    if (!targetModel) {
      strapi.log.error('Model not found');
      return;
    }

    const indexConfig = strapi.$es.indicesMapping[targetModel.model];

    if (indexConfig && indexConfig.mappings && indexConfig.mappings.properties) {
      const res = await compareDataWithMap({
        docs: data,
        properties: indexConfig.mappings.properties,
      });
      data = res.result || data;
    }

    if (!data) {
      strapi.log.error('No data to index');
      return;
    }

    return id
      ? strapi.$es.update({
          index: targetModel.index,
          id: data[targetModel.pk || 'id'],
          body: {
            doc: data,
            doc_as_upsert: true,
            detect_noop: false,
          },
        })
      : strapi.$es.index({
          index: targetModel.index,
          body: data,
        });
  },
  /**
   *
   * @param {string} model
   * @param {Object} param1
   */
  migrateById: async (model, { id, id_in, relations, conditions }) => {
    const { models } = strapi.config.elasticsearch;

    const targetModel = models.find((item) => item.model === model);

    if (!targetModel) return null;

    id_in = id_in || [id];

    relations = relations || targetModel.relations;
    conditions = conditions || targetModel.conditions;

    const data = await strapi
      .query(targetModel.model, targetModel.plugin)
      .find({ id_in: [...id_in], ...conditions }, [...relations]);

    if (!data) return null;

    const body = await data.flatMap((doc) => [
      {
        index: {
          _index: targetModel.index,
          _id: doc[targetModel.pk || 'id'],
        },
      },
      doc,
    ]);

    return strapi.$es.bulk({ refresh: true, body });
  },
  /**
   *
   * @param {string} model
   * @returns
   */
  migrateModel: async (model) => {
    const { models, settings } = strapi.config.elasticsearch;
    const targetModel = models.find((item) => item.model === model);
    const apiQueryKey = `api::${targetModel.model}.${targetModel.content}`;

    const { indexExist } = await strapi.$es.indices.exists({
      index: targetModel.index,
    });

    const indexConfig = indexExist ? strapi.$es.indicesMapping[targetModel.model] : null;

    const migrationIsEnabled = targetModel && !!targetModel.enabled && targetModel.migration;

    if (!migrationIsEnabled) return;

    let start = 0;
    strapi.log.debug(`Importing ${targetModel.model} to elasticsearch`);

    const modelCount = await strapi.db.query(apiQueryKey).count();

    let indexLength = parseInt(modelCount / settings.importLimit, 10);

    // eslint-disable-next-line no-constant-condition
    while (true) {
      const startSql = Date.now();
      let data = await getDocsFromModel(targetModel, apiQueryKey, settings, start, indexConfig);
      const endSql = Date.now();

      if (data.length === 0) {
        strapi.log.debug('End of import');
        break;
      }

      const start_elastic = Date.now();
      await indexData(targetModel, data);
      const end_elastic = Date.now();

      start += 1;

      // progress bar
      strapi.log.info(
        `(${start}/${indexLength + 1}) Imported to ${
          targetModel.index
        } index | sql query took ${parseInt(
          (endSql - startSql) / 1000
        )}s and insert to elasticsearch took ${parseInt((end_elastic - start_elastic) / 1000)}s`
      );
    }
  },
  /**
   *
   * @param {string} index
   * @param {number} limit
   * @param {number} start
   * @returns
   */
  find: async (index, limit, start) => {
    return strapi.$es.search({
      index,
      size: limit || 10,
      from: limit * (start - 1),
      body: {
        sort: [
          {
            updated_at: {
              order: 'desc',
              unmapped_type: 'date',
            },
          },
        ],
        query: {
          match_all: {},
        },
      },
    });
  },
};

async function getDocsFromModel(targetModel, apiQueryKey, settings, start, indexConfig) {
  strapi.log.debug(`Getting ${targetModel.model} model data from database`);

  const data = await strapi.db.query(apiQueryKey).findMany({
    limit: settings.importLimit,
    offset: settings.importLimit * start,
    populate: targetModel.relations
  });

  let result = data;
  if (indexConfig && indexConfig.mappings && indexConfig.mappings.properties) {
    const res = compareDataWithMap({
      docs: data,
      properties: indexConfig.mappings.properties,
    });

    result = res.result || result;
  }

  return result;
}

async function indexData(targetModel, data) {
  strapi.log.debug(`Sending ${targetModel.model} model to elasticsearch...`);

  const body = await parseDataToElastic(targetModel, data);

  try {
    await strapi.$es.bulk({ refresh: true, body });
  } catch (e) {
    strapi.log.error(e);
  }
}

async function parseDataToElastic(targetModel, data) {
  return data.flatMap((doc) => [
    {
      index: {
        _index: targetModel.index,
        _id: doc[targetModel.pk || 'id'],
      },
    },
    doc,
  ]);
}
