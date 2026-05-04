const Joi = require('joi');

const testRateSchema = Joi.object({
    client_id: Joi.number().integer().required(),
    insurer_id: Joi.number().integer().positive().allow(null).optional(),
    item_name: Joi.string().optional(),
    item_code: Joi.string().allow('').optional(),
    item_type: Joi.string().allow('', null).optional(),
    category_id: Joi.number().allow(null).optional(),
    rate: Joi.number().precision(2).positive().required().allow(null, 0),
    test_id: Joi.number().integer().positive().required(),
    is_active: Joi.number().valid(0, 1).optional(),
});

const testRateUpdateSchema = Joi.object({
    client_id: Joi.number().integer().optional(),
    insurer_id: Joi.number().integer().positive().allow(null).optional(),
    item_name: Joi.string().optional(),
    item_code: Joi.string().allow('').optional(),
    item_type: Joi.string().allow('', null).optional(),
    category_id: Joi.number().allow(null).optional(),
    rate: Joi.number().precision(2).positive().optional().allow(null, 0),
    test_id: Joi.number().integer().positive().optional(),
    is_active: Joi.number().valid(0, 1).optional(),
});

const deleteTestRatesSchema = Joi.object({
    ids: Joi.array().items(Joi.number().integer().positive()).min(1).required(),
});

module.exports = {
    testRateSchema,
    testRateUpdateSchema,
    deleteTestRatesSchema
};