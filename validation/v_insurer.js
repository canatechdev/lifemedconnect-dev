const Joi = require('joi');

/**
 * Validation schemas for insurer operations
 */

// Create insurer schema
const createInsurerSchema = Joi.object({
    insurer_code: Joi.string().max(50).allow(null, ''),
    short_code: Joi.string().max(50).allow(null, ''),
    insurer_name: Joi.string().max(255).allow(null, ''),
    insurer_type: Joi.string().max(50).optional().allow(null, ''),
    contact_number: Joi.string().max(20).optional().allow(null, ''),
    email: Joi.string().email().optional().allow(null, ''),
    is_active: Joi.number().valid(0, 1).optional()
});

// Update insurer schema
const updateInsurerSchema = createInsurerSchema.fork(
    Object.keys(createInsurerSchema.describe().keys),
    schema => schema.optional()
);

// Delete insurers schema
const deleteInsurersSchema = Joi.object({
    ids: Joi.array().items(Joi.number().integer().positive()).min(1).required()
});

module.exports = {
    createInsurerSchema,
    updateInsurerSchema,
    deleteInsurersSchema
};