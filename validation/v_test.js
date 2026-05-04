/**
 * Test Validation Schemas
 * Centralized Joi validation schemas for test entity
 */

const Joi = require('joi');

const testSchemas = {
    /**
     * Schema for creating a new test
     */
    create: Joi.object({
        test_name: Joi.string()
            .max(255)
            .required()
            .messages({
                'string.empty': 'Test name is required',
                'string.max': 'Test name cannot exceed 255 characters',
                'any.required': 'Test name is required'
            }),
        description: Joi.string()
            .allow(null, '')
            .optional(),
        is_active: Joi.number()
            .valid(0, 1)
            .optional()
            .default(1),
        // Approval-related fields
        approval_notes: Joi.string()
            .allow(null, '')
            .optional(),
        priority: Joi.string()
            .valid('low', 'medium', 'high')
            .optional()
            .default('medium'),
        report_type: Joi.string()
            .valid('pathology', 'cardiology', 'radiology', 'mer', 'mtrf', 'other')
            .optional()
            .allow(null)
    }),

    /**
     * Schema for updating an existing test
     */
    update: Joi.object({
        test_name: Joi.string()
            .max(255)
            .optional()
            .messages({
                'string.max': 'Test name cannot exceed 255 characters'
            }),
        description: Joi.string()
            .allow(null, '')
            .optional(),
        is_active: Joi.number()
            .valid(0, 1)
            .optional(),
        // Approval-related fields
        approval_notes: Joi.string()
            .allow(null, '')
            .optional(),
        priority: Joi.string()
            .valid('low', 'medium', 'high')
            .optional()
            .default('medium'),
        report_type: Joi.string()
            .valid('pathology', 'cardiology', 'radiology', 'mer', 'mtrf', 'other')
            .optional()
            .allow(null)
    }),

    /**
     * Schema for deleting tests (bulk delete)
     */
    delete: Joi.object({
        ids: Joi.array()
            .items(Joi.number().integer().positive())
            .min(1)
            .required()
            .messages({
                'array.min': 'At least one test ID is required',
                'any.required': 'Test IDs are required'
            }),
        // Approval-related fields
        approval_notes: Joi.string()
            .allow(null, '')
            .optional(),
        priority: Joi.string()
            .valid('low', 'medium', 'high')
            .optional()
            .default('high') // Delete operations default to high priority
    }),

    /**
     * Schema for checking test name availability
     */
    checkName: Joi.object({
        name: Joi.string()
            .required()
            .messages({
                'string.empty': 'Name is required for checking availability',
                'any.required': 'Name is required for checking availability'
            }),
        excludeId: Joi.number()
            .integer()
            .positive()
            .optional()
    }),

    /**
     * Schema for list/pagination query parameters
     */
    listQuery: Joi.object({
        page: Joi.number()
            .integer()
            .min(1)
            .optional()
            .default(1),
        limit: Joi.number()
            .integer()
            .min(0)
            .max(100)
            .optional()
            .default(10),
        q: Joi.string()
            .allow('')
            .optional(),
        search: Joi.string()
            .allow('')
            .optional(),
        sortBy: Joi.string()
            .valid('id', 'test_name', 'description', 'is_active', 'created_at', 'updated_at')
            .optional()
            .default('id'),
        sortOrder: Joi.string()
            .valid('ASC', 'DESC', 'asc', 'desc')
            .optional()
            .default('DESC')
    })
};

module.exports = testSchemas;
