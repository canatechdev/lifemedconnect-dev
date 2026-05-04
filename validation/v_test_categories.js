/**
 * Centralized Joi validation schemas for test categories entity
 */

const Joi = require('joi');

const categorySchemas = {
    /**
     * Schema for creating a new test category
     */
    create: Joi.object({
        category_name: Joi.string().max(255).required().messages({
            'string.empty': 'Category name is required',
            'string.max': 'Category name must not exceed 255 characters',
            'any.required': 'Category name is required'
        }),
        description: Joi.string().allow(null, '').optional().messages({
            'string.base': 'Description must be a string'
        }),
        is_active: Joi.number().valid(0, 1).default(1).messages({
            'number.base': 'Active status must be a number',
            'any.only': 'Active status must be 0 or 1'
        }),
        test_ids: Joi.array().items(Joi.number().integer().positive()).optional().messages({
            'array.base': 'Test IDs must be an array',
            'number.integer': 'Test ID must be an integer',
            'number.positive': 'Test ID must be a positive number'
        }),
        client_id: Joi.number().integer().positive().allow(null).optional().messages({
            'number.base': 'Client ID must be a number',
            'number.integer': 'Client ID must be an integer',
            'number.positive': 'Client ID must be a positive number'
        }),
        insurer_id: Joi.number().integer().positive().allow(null).optional().messages({
            'number.base': 'Insurer ID must be a number',
            'number.integer': 'Insurer ID must be an integer',
            'number.positive': 'Insurer ID must be a positive number'
        }),
        rate: Joi.number().precision(2).min(0).allow(null).optional().messages({
            'number.base': 'Rate must be a number',
            'number.min': 'Rate must be a positive number',
            'number.precision': 'Rate can have maximum 2 decimal places'
        }),
        report_type: Joi.array().optional(),
        approval_notes: Joi.string().allow('', null).optional().messages({
            'string.base': 'Approval notes must be a string'
        }),
        priority: Joi.string().valid('low', 'medium', 'high').default('medium').messages({
            'string.base': 'Priority must be a string',
            'any.only': 'Priority must be low, medium, or high'
        })
    }),

    /**
     * Schema for updating a test category
     */
    update: Joi.object({
        category_name: Joi.string().max(255).optional().messages({
            'string.empty': 'Category name cannot be empty',
            'string.max': 'Category name must not exceed 255 characters'
        }),
        description: Joi.string().allow(null, '').optional().messages({
            'string.base': 'Description must be a string'
        }),
        is_active: Joi.number().valid(0, 1).optional().messages({
            'number.base': 'Active status must be a number',
            'any.only': 'Active status must be 0 or 1'
        }),
        test_ids: Joi.array().items(Joi.number().integer().positive()).optional().messages({
            'array.base': 'Test IDs must be an array',
            'number.integer': 'Test ID must be an integer',
            'number.positive': 'Test ID must be a positive number'
        }),
        client_id: Joi.number().integer().positive().allow(null).optional().messages({
            'number.base': 'Client ID must be a number',
            'number.integer': 'Client ID must be an integer',
            'number.positive': 'Client ID must be a positive number'
        }),
        insurer_id: Joi.number().integer().positive().allow(null).optional().messages({
            'number.base': 'Insurer ID must be a number',
            'number.integer': 'Insurer ID must be an integer',
            'number.positive': 'Insurer ID must be a positive number'
        }),
        rate: Joi.number().precision(2).min(0).allow(null).optional().messages({
            'number.base': 'Rate must be a number',
            'number.min': 'Rate must be a positive number',
            'number.precision': 'Rate can have maximum 2 decimal places'
        }),
        report_type: Joi.array().optional(),
        approval_notes: Joi.string().allow('', null).optional().messages({
            'string.base': 'Approval notes must be a string'
        }),
        priority: Joi.string().valid('low', 'medium', 'high').default('medium').messages({
            'string.base': 'Priority must be a string',
            'any.only': 'Priority must be low, medium, or high'
        })
    }),

    /**
     * Schema for deleting test categories
     */
    delete: Joi.object({
        ids: Joi.array().items(Joi.number().integer().positive()).required().messages({
            'array.base': 'IDs must be an array',
            'any.required': 'Category IDs are required',
            'number.integer': 'Category ID must be an integer',
            'number.positive': 'Category ID must be a positive number'
        }),
        approval_notes: Joi.string().allow('', null).optional().messages({
            'string.base': 'Approval notes must be a string'
        }),
        priority: Joi.string().valid('low', 'medium', 'high').default('high').messages({
            'string.base': 'Priority must be a string',
            'any.only': 'Priority must be low, medium, or high'
        })
    })
};

module.exports = categorySchemas;