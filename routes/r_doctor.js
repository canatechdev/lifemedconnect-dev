const express = require('express');
const router = express.Router();
const { verifyToken } = require('../lib/auth');
const { requirePermission } = require('../lib/permissions');
const service = require('../services/s_doctor');
const { mixedUpload } = require('../lib/multer');
const { processUploadFields } = require('../lib/fileUpload');
const db = require('../lib/dbconnection');
const { asyncHandler } = require('../middleware/errorHandler');
const validateRequest = require('../middleware/validateRequest');
const ApiResponse = require('../lib/response');
const logger = require('../lib/logger');
const { parsePaginationParams } = require('../lib/helpers');
const { createWithApproval, updateWithApproval, deleteWithApproval, formatApprovalResponse } = require('../lib/approvalHelper');
const { toMySqlDate } = require('../lib/normalizers');

//  NEW: Import security middleware
const { uploadLimiter } = require('../middleware/security');

// Import validation schemas
const { createDoctorSchema, updateDoctorSchema, deleteDoctorsSchema } = require('../validation/v_doctors');

/* -------------------------------------------------------
 *  Multer Upload Configuration
 * ----------------------------------------------------- */
const uploadFields = mixedUpload.fields([
  { name: 'aadhar_doc_path', maxCount: 1 },
  { name: 'pan_doc_path', maxCount: 1 },
  { name: 'profile_photo_path', maxCount: 1 },
  { name: 'educational_certificates', maxCount: 10 }
]);

/* -------------------------------------------------------
 *  Utility - Extract file paths from uploaded files with compression
 * ----------------------------------------------------- */
// Helper: Look up doctor_code for file organization
async function getDoctorCode(doctorId) {
    try {
        const rows = await db.query('SELECT doctor_code FROM doctors WHERE id = ?', [doctorId]);
        return rows?.[0]?.doctor_code || '';
    } catch { return ''; }
}

async function extractFilePaths(files, existingCertificates = '[]', doctorCode = '') {
  if (!files) return {};

  // Process all uploaded files with compression
  const processedFiles = await processUploadFields(files, 'doctors', doctorCode);

  // Handle existing educational certificates
  let existing = [];
  try {
    existing = JSON.parse(existingCertificates);
    if (!Array.isArray(existing)) existing = [];
    // Normalize paths - replace backslashes with forward slashes
    existing = existing.map(path => path.replace(/\\/g, '/'));
  } catch (e) { /* ignore */ }

  const newCertificates = Array.isArray(processedFiles.educational_certificates)
    ? processedFiles.educational_certificates
    : [];
  const allCertificates = [...existing, ...newCertificates];

  return {
    aadhar_doc_path: processedFiles.aadhar_doc_path || null,
    pan_doc_path: processedFiles.pan_doc_path || null,
    profile_photo_path: processedFiles.profile_photo_path || null,
    educational_certificates: allCertificates.length > 0
      ? JSON.stringify(allCertificates)
      : null
  };
}

/* -------------------------------------------------------
 *  Routes
 * ----------------------------------------------------- */

//  List doctors
router.get(
  '/doctors',
  verifyToken,
  asyncHandler(async (req, res) => {
    const { page, limit, search, sortBy, sortOrder } = parsePaginationParams(req.query);

    logger.debug('Listing doctors', { page, limit, search, sortBy, sortOrder });

    const result = await service.listDoctors({ page, limit, search, sortBy, sortOrder });
    return ApiResponse.paginated(res, result.data, result.pagination);
  })
);

//  Get single doctor
router.get(
  '/doctors/:id',
  verifyToken,
  asyncHandler(async (req, res) => {
    logger.debug('Getting doctor', { id: req.params.id });
    
    const doctor = await service.getDoctor(req.params.id);
    if (!doctor) {
      logger.debug('Doctor not found', { id: req.params.id });
      return ApiResponse.notFound(res, 'Doctor not found');
    }
    
    return ApiResponse.success(res, doctor);
  })
);

//  Create new doctor
router.post(
  '/doctors',
  verifyToken,
  requirePermission('doctors.create'),
  uploadLimiter,
  uploadFields,
  validateRequest(createDoctorSchema),
  asyncHandler(async (req, res) => {
    logger.info('Creating doctor', { userId: req.user.id, hasFiles: !!req.files });
    
    const filePaths = await extractFilePaths(req.files, '[]', req.body.doctor_code || '');
    const doctorData = {
      ...req.body,
      ...filePaths,
      ...(req.body.date_of_birth && { date_of_birth: toMySqlDate(req.body.date_of_birth) }),
      created_by: req.user.id
    };

    const result = await createWithApproval({
      entity_type: 'doctor',
      createFunction: async (data) => {
        return await service.createDoctor(data);
      },
      data: doctorData,
      user: req.user,
      notes: req.body.approval_notes || '',
      priority: req.body.priority || 'medium'
    });

    const response = formatApprovalResponse(result);
    logger.info('Doctor creation request', {
      doctorId: response.id,
      needsApproval: response.approval_required,
      userId: req.user.id
    });

    return ApiResponse.success(res, response, response.message, 201);
  })
);

//  Update doctor
router.put(
  '/doctors/:id',
  verifyToken,
  requirePermission('doctors.update'),
  uploadLimiter,
  uploadFields,
  validateRequest(updateDoctorSchema),
  asyncHandler(async (req, res) => {
    logger.info('Updating doctor', {
      doctorId: req.params.id,
      userId: req.user.id,
      hasFiles: !!req.files,
      fileFields: req.files ? Object.keys(req.files) : []
    });

    const existingCertificates = req.body.existing_educational_certificates || '[]';
    const doctorCode = await getDoctorCode(req.params.id);
    const filePaths = await extractFilePaths(req.files, existingCertificates, doctorCode);

    // File fields to check
    const fileFields = ['aadhar_doc_path', 'pan_doc_path', 'profile_photo_path', 'educational_certificates'];

    // Build updates object, excluding file fields initially
    const updates = { updated_by: req.user.id };

    // Add non-file fields from req.body
    // Exclude file fields, existing_educational_certificates, and removal markers (they're not database columns)
    const excludeFields = [
      ...fileFields,
      'existing_educational_certificates',
      'educational_certificates_remove',
      'aadhar_doc_remove',
      'pan_doc_remove',
      'profile_photo_remove'
    ];
    Object.keys(req.body).forEach(key => {
      if (!excludeFields.includes(key)) {
        updates[key] = req.body[key];
      }
    });

    // Now handle file fields - only include if explicitly changed
    fileFields.forEach(field => {
      // Check if user explicitly sent this field (either as file upload or removal)
      const hasNewFile = req.files && req.files[field];
      const hasRemovalFlag = field in req.body && req.body[field] === ''; // Empty string means removal
      const hasExistingData = field === 'educational_certificates' && req.body.existing_educational_certificates;
      
      // Check for explicit removal markers
      // Frontend sends: aadhar_doc_remove, pan_doc_remove, profile_photo_remove, educational_certificates_remove
      const removalMarkerField = field.replace('_path', '') + '_remove';
      const hasRemovalMarker = req.body[removalMarkerField] === 'true';

      if (hasNewFile || hasRemovalFlag || hasExistingData || hasRemovalMarker) {
        // User made a change to this field - include it in updates
        if (hasRemovalMarker) {
          // Explicit removal - set to null
          updates[field] = null;
        } else {
          updates[field] = filePaths[field];
        }
      }
      // If none of the above, don't include the field (no change)
    });

    // Normalize date field
    if (updates.date_of_birth) {
      updates.date_of_birth = toMySqlDate(updates.date_of_birth);
    }

    const result = await updateWithApproval({
      entity_type: 'doctor',
      entity_id: parseInt(req.params.id),
      getFunction: async (id) => await service.getDoctor(id),
      updateFunction: async (id, data) => await service.updateDoctor(id, data),
      new_data: updates,
      user: req.user,
      notes: req.body.approval_notes || '',
      priority: req.body.priority || 'medium'
    });

    const response = formatApprovalResponse(result);
    logger.info('Doctor update request', {
      doctorId: req.params.id,
      needsApproval: response.approval_required,
      userId: req.user.id
    });

    return ApiResponse.success(res, response, response.message);
  })
);

//  Soft delete doctors
router.post(
  '/doctors/delete',
  verifyToken,
  requirePermission('doctors.delete'),
  validateRequest(deleteDoctorsSchema),
  asyncHandler(async (req, res) => {
    logger.info('Deleting doctors', { ids: req.body.ids, userId: req.user.id });
    
    const results = [];

    for (const id of req.body.ids) {
      try {
        const result = await deleteWithApproval({
          entity_type: 'doctor',
          entity_id: id,
          getFunction: async (ids) => {
            // Handle both single ID and array of IDs
            if (Array.isArray(ids)) {
              return await service.getDoctorsByIds(ids);
            }
            return await service.getDoctor(ids);
          },
          deleteFunction: async (entityId) => {
            return await service.softDeleteDoctors([entityId]);
          },
          user: req.user,
          notes: req.body.approval_notes || '',
          priority: req.body.priority || 'high'
        });
        results.push({ id, ...formatApprovalResponse(result) });
      } catch (error) {
        logger.error('Failed to delete doctor', { id, error: error.message });
        results.push({ id, error: error.message });
      }
    }

    const needsApproval = results.some(r => r.approval_required);
    const message = needsApproval
      ? 'Delete requests submitted for Super Admin approval'
      : 'Doctors deleted successfully';

    logger.info('Doctors deletion request completed', {
      count: results.length,
      needsApproval,
      userId: req.user.id
    });

    return ApiResponse.success(res, { results }, message);
  })
);




module.exports = router;
