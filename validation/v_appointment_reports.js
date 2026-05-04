/**
 * Validation schemas for appointment categorized reports
 */

const Joi = require('joi');

// Upload categorized reports
const uploadCategorizedReportsSchema = Joi.object({
    reportType: Joi.string()
        .valid('pathology', 'cardiology', 'radiology','other', 'mer', 'mtrf')
        .required()
        .messages({
            'any.required': 'Report type is required',
            'any.only': 'Invalid report type. Must be one of: pathology, cardiology, radiology, other, mer, mtrf'
        })
});

// Delete categorized report
const deleteCategorizedReportSchema = Joi.object({
    reportId: Joi.number()
        .integer()
        .positive()
        .required()
        .messages({
            'any.required': 'Report ID is required',
            'number.base': 'Report ID must be a number',
            'number.positive': 'Report ID must be positive'
        })
});

// Submit for QC
const submitForQCSchema = Joi.object({
    // No body params needed, appointment ID comes from URL
});

module.exports = {
    uploadCategorizedReportsSchema,
    deleteCategorizedReportSchema,
    submitForQCSchema
};
