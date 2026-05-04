/**
 * Validation schemas for appointment QC workflow
 */

const Joi = require('joi');

// Push back to reports
const pushBackToReportsSchema = Joi.object({
    remarks: Joi.string()
        .required()
        .min(5)
        .max(1000)
        .messages({
            'any.required': 'Remarks are required when pushing back',
            'string.min': 'Remarks must be at least 5 characters',
            'string.max': 'Remarks must not exceed 1000 characters'
        })
});

// Save QC verification (partial or complete)
const saveQCVerificationSchema = Joi.object({
    checkboxes: Joi.object({
        pathology: Joi.boolean().required(),
        cardiology: Joi.boolean().required(),
        radiology: Joi.boolean().required(),
        mer: Joi.boolean().required(),
        mtrf: Joi.boolean().required(),
        other: Joi.boolean().required()
    }).required().messages({
        'any.required': 'All checkbox states are required'
    }),
    remarks: Joi.string()
        .allow('', null)
        .max(1000)
        .messages({
            'string.max': 'Remarks must not exceed 1000 characters'
        }),
    isComplete: Joi.boolean()
        .required()
        .messages({
            'any.required': 'isComplete flag is required'
        })
});

module.exports = {
    pushBackToReportsSchema,
    saveQCVerificationSchema
};
