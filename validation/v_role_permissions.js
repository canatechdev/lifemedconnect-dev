const Joi = require('joi');

/**
 * Validation schemas for role-permission management endpoints
 */

const assignPermissions = Joi.object({
    permission_ids: Joi.array()
        .items(Joi.number().integer().positive())
        .min(1)
        .required()
        .messages({
            'array.base': 'permission_ids must be an array',
            'array.min': 'At least one permission ID is required',
            'any.required': 'permission_ids is required'
        })
});

const removePermissions = Joi.object({
    permission_ids: Joi.array()
        .items(Joi.number().integer().positive())
        .min(1)
        .required()
        .messages({
            'array.base': 'permission_ids must be an array',
            'array.min': 'At least one permission ID is required',
            'any.required': 'permission_ids is required'
        })
});

const syncPermissions = Joi.object({
    permission_ids: Joi.array()
        .items(Joi.number().integer().positive())
        .required()
        .messages({
            'array.base': 'permission_ids must be an array',
            'any.required': 'permission_ids is required'
        })
});

module.exports = {
    assignPermissions,
    removePermissions,
    syncPermissions
};
