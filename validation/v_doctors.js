const Joi = require('joi');

/**
 * Doctor validation schemas
 * Handles file uploads for documents and certificates
 */

// Base doctor schema (common fields)
const baseDoctorSchema = {
  user_id: Joi.number().integer().optional().allow(null, ''),
  doctor_name: Joi.string().max(255).required(),
  email: Joi.string().email().allow(null, ''),
  mobile: Joi.string().max(20).allow(null, ''),
  gender: Joi.string().allow(null, ''),
  date_of_birth: Joi.alternatives()
    .try(Joi.string(), Joi.date())
    .allow(null, '')
    .required()
    .custom((value, helpers) => {
      if (value === null || value === '') {
        return helpers.error('any.required');
      }
      return value;
    }, 'Date of birth is required'),
  registration_number: Joi.string().max(100).allow(null, ''),
  qualification: Joi.string().max(255).allow(null, ''),
  specialization: Joi.string().max(255).allow(null, ''),
  experience_years: Joi.number().integer().allow(null, ''),
  aadhar_number: Joi.string().max(20).allow(null, ''),
  pan_number: Joi.string().max(20).allow(null, ''),
  address: Joi.string().allow(null, ''),
  city: Joi.string().max(100).allow(null, ''),
  state: Joi.string().max(100).allow(null, ''),
  pincode: Joi.string().max(15).allow(null, ''),
  country: Joi.string().max(100).allow(null, ''),
  acc_name: Joi.string().max(105).allow(null, ''),
  acc_no: Joi.string().max(105).allow(null, ''),
  ifsc_code: Joi.string().max(105).allow(null, ''),
  receivers_name: Joi.string().max(105).allow(null, ''),
  branch_name: Joi.string().max(105).allow(null, ''),
  is_active: Joi.number().valid(0, 1).optional()
};

// Create doctor schema
const createDoctorSchema = Joi.object({
  ...baseDoctorSchema,
  // File paths will be handled by multer and fileUpload middleware
  // These fields are optional in validation but required in business logic
  aadhar_doc_path: Joi.string().optional().allow(null, ''),
  pan_doc_path: Joi.string().optional().allow(null, ''),
  profile_photo_path: Joi.string().optional().allow(null, ''),
  educational_certificates: Joi.string().optional().allow(null, '') // JSON string of file paths
});

// Update doctor schema - all fields optional
const updateDoctorSchema = Joi.object({
  ...Object.keys(baseDoctorSchema).reduce((acc, key) => {
    acc[key] = baseDoctorSchema[key].optional();
    return acc;
  }, {}),
  // File removal markers for update operations
  existing_educational_certificates: Joi.string().optional().allow(null, ''),
  educational_certificates_remove: Joi.string().optional().allow(null, ''),
  aadhar_doc_remove: Joi.string().optional().allow(null, ''),
  pan_doc_remove: Joi.string().optional().allow(null, ''),
  profile_photo_remove: Joi.string().optional().allow(null, ''),
  // File paths (will be populated by fileUpload middleware)
  aadhar_doc_path: Joi.string().optional().allow(null, ''),
  pan_doc_path: Joi.string().optional().allow(null, ''),
  profile_photo_path: Joi.string().optional().allow(null, ''),
  educational_certificates: Joi.string().optional().allow(null, '')
});

// Delete doctors schema
const deleteDoctorsSchema = Joi.object({
  ids: Joi.array().items(Joi.number().integer().positive()).min(1).required()
});

module.exports = {
  createDoctorSchema,
  updateDoctorSchema,
  deleteDoctorsSchema
};