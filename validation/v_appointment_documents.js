/**
 * Validation schemas for appointment documents and customer images
 */

const Joi = require('joi');

// Add document
const addDocumentSchema = Joi.object({
    docType: Joi.string()
        .valid('aadhaar', 'pan', 'driving_license', 'voter_id', 'passport','student_id','other_id')
        .required()
        .messages({
            'any.required': 'Document type is required',
            'any.only': 'Invalid document type'
        }),
    docNumber: Joi.string()
        .required()
        .min(1)
        .max(50)
        .messages({
            'any.required': 'Document number is required',
            'string.min': 'Document number is required',
            'string.max': 'Document number must not exceed 50 characters'
        })
});

// Delete document
const deleteDocumentSchema = Joi.object({
    documentId: Joi.number()
        .integer()
        .positive()
        .required()
        .messages({
            'any.required': 'Document ID is required'
        })
});

// Add customer image
const addCustomerImageSchema = Joi.object({
    imageLabel: Joi.string()
        .required()
        .min(1)
        .max(100)
        .messages({
            'any.required': 'Image label is required',
            'string.min': 'Image label is required',
            'string.max': 'Image label must not exceed 100 characters'
        })
});

// Delete customer image
const deleteCustomerImageSchema = Joi.object({
    imageId: Joi.number()
        .integer()
        .positive()
        .required()
        .messages({
            'any.required': 'Image ID is required'
        })
});

// Update image label
const updateImageLabelSchema = Joi.object({
    imageId: Joi.number()
        .integer()
        .positive()
        .required()
        .messages({
            'any.required': 'Image ID is required'
        }),
    imageLabel: Joi.string()
        .required()
        .min(1)
        .max(100)
        .messages({
            'any.required': 'Image label is required',
            'string.min': 'Image label is required',
            'string.max': 'Image label must not exceed 100 characters'
        })
});

module.exports = {
    addDocumentSchema,
    deleteDocumentSchema,
    addCustomerImageSchema,
    deleteCustomerImageSchema,
    updateImageLabelSchema
};
