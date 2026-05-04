const Joi = require('joi');

const roleSchemas = {
    /**
     * Schema for creating a new role
     */
    create: Joi.object({
        role_name: Joi.string().max(50).required().messages({
            'string.empty': 'Role name is required',
            'string.max': 'Role name must not exceed 50 characters',
            'any.required': 'Role name is required'
        }),
        description: Joi.string().allow(null, '').optional()
    }),

    /**
     * Schema for updating an existing role
     */
    update: Joi.object({
        role_name: Joi.string().max(50).required().messages({
            'string.empty': 'Role name is required',
            'string.max': 'Role name must not exceed 50 characters',
            'any.required': 'Role name is required'
        }),
        description: Joi.string().allow(null, '').optional()
    }),

    /**
     * Schema for checking role name availability
     */
    checkName: Joi.object({
        name: Joi.string().required().messages({
            'string.empty': 'Name is required for checking availability',
            'any.required': 'Name is required for checking availability'
        }),
        excludeId: Joi.number().positive().optional().messages({
            'number.base': 'Exclude ID must be a number',
            'number.positive': 'Exclude ID must be a positive number'
        })
    }),

    /**
     * Schema for delete operations
     */
    delete: Joi.object({
        ids: Joi.alternatives().try(
            Joi.number().positive(),
            Joi.array().items(Joi.number().positive())
        ).required().messages({
            'any.required': 'Role ID(s) are required',
            'number.base': 'Role ID must be a number',
            'number.positive': 'Role ID must be a positive number',
            'array.base': 'Role IDs must be an array'
        })
    })
};

module.exports = roleSchemas;