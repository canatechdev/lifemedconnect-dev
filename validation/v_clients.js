const Joi = require('joi');

// Client creation validation schema
const createClientSchema = Joi.object({
  client_code: Joi.string().max(50).optional().allow(null, ''),
  client_name: Joi.string().max(255).required(),
  short_code: Joi.string().max(50).optional().allow(null, ''),
  client_type: Joi.string().max(50).optional().allow(null, ''),
  gst_number: Joi.string().max(50).optional().allow(null, ''),
  pan_number: Joi.string().max(50).optional().allow(null, ''),
  mode_of_payment: Joi.string().max(50).optional().allow(null, ''),
  payment_frequency: Joi.string().max(50).optional().allow(null, ''),
  // Legacy generic fields (kept for backward compatibility)
  contact_person: Joi.string().max(255).optional().allow(null, ''),
  contact_email: Joi.string().email().optional().allow(null, ''),
  contact_phone: Joi.string().max(20).optional().allow(null, ''),
  address: Joi.string().optional().allow(null, ''),
  // New fields matching DB columns
  registered_address: Joi.string().optional().allow(null, ''),
  email_id: Joi.string().email().optional().allow(null, ''),
  email_id_2: Joi.string().email().optional().allow(null, ''),
  email_id_3: Joi.string().email().optional().allow(null, ''),
  contact_person_name: Joi.string().max(255).optional().allow(null, ''),
  contact_person_no: Joi.string().max(45).optional().allow(null, ''),
  contact_person_address: Joi.string().max(455).optional().allow(null, ''),
  city: Joi.string().max(100).optional().allow(null, ''),
  state: Joi.string().max(100).optional().allow(null, ''),
  pincode: Joi.string().max(15).optional().allow(null, ''),
  country: Joi.string().max(100).optional().allow(null, ''),
  website: Joi.string().max(255).optional().allow(null, ''),
  description: Joi.string().optional().allow(null, ''),
  onboarding_date: Joi.date().optional().allow(null),
  is_active: Joi.number().valid(0, 1).optional(),
  invoice_format_upload: Joi.string().optional().allow(null, ''), // File path for invoice format
  mou: Joi.string().max(45).optional().allow(null, ''),
  IRDAI_no: Joi.string().max(45).optional().allow(null, ''),
  agreement_id: Joi.string().max(45).optional().allow(null, ''),
  validity_period_start: Joi.date().optional().allow(null),
  validity_period_end: Joi.date().optional().allow(null),
  user_id: Joi.alternatives().try(
  Joi.number().integer().positive().optional(),
  Joi.string().allow('').optional()
).optional().allow(null), // TPA user assignment - allows number, empty string, or null
  insurer_ids: Joi.array().items(Joi.number().integer().positive()).optional()
});

// Client update validation schema (all fields optional)
const updateClientSchema = createClientSchema.fork(
  Object.keys(createClientSchema.describe().keys),
  schema => schema.optional()
);

// Delete clients validation schema
const deleteClientsSchema = Joi.object({
  ids: Joi.array().items(Joi.number().integer().positive()).min(1).required()
});

module.exports = {
  createClientSchema,
  updateClientSchema,
  deleteClientsSchema
};