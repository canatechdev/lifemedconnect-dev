const express = require('express');
const router = express.Router();
const { verifyToken } = require('../lib/auth');
const { requirePermission } = require('../lib/permissions');
const service = require('../services/s_insurers');
const { asyncHandler } = require('../middleware/errorHandler');
const validateRequest = require('../middleware/validateRequest');
const ApiResponse = require('../lib/response');
const logger = require('../lib/logger');
const { parsePaginationParams } = require('../lib/helpers');
const { createWithApproval, updateWithApproval, deleteWithApproval, formatApprovalResponse } = require('../lib/approvalHelper');
const { createInsurerSchema, updateInsurerSchema, deleteInsurersSchema } = require('../validation/v_insurer');

//  List insurers
router.get('/insurers', verifyToken, asyncHandler(async (req, res) => {
    const { page, limit, search, sortBy, sortOrder } = parsePaginationParams(req.query);

    const result = await service.listInsurers({ page, limit, search, sortBy, sortOrder });
    return ApiResponse.paginated(res, result.data, result.pagination);
}));

//  Get single insurer
router.get('/insurers/:id', verifyToken, asyncHandler(async (req, res) => {
    const row = await service.getInsurer(req.params.id);
    if (!row) return ApiResponse.notFound(res, 'Insurer not found');
    return ApiResponse.success(res, row);
}));

//  Create insurer
router.post(
  '/insurers',
  verifyToken,
  requirePermission('insurers.create'),
  validateRequest(createInsurerSchema),
  asyncHandler(async (req, res) => {
    logger.info('Creating insurer request', { 
      insurerName: req.body.insurer_name,
      requestedBy: req.user.id 
    });

    const result = await createWithApproval({
      entity_type: 'insurer',
      createFunction: async (data) => {
        return await service.createInsurer(data, req.user.id);
      },
      data: {
        ...req.body,
        created_by: req.user.id
      },
      user: req.user,
      req
    });

    logger.info('Insurer creation completed', {
      insurerId: result.data?.id,
      requiresApproval: result.requiresApproval,
      requestedBy: req.user.id
    });

    return ApiResponse.success(res, result.data, result.message, 201);
  })
);

//  Update insurer
router.put(
  '/insurers/:id',
  verifyToken,
  requirePermission('insurers.update'),
  validateRequest(updateInsurerSchema),
  asyncHandler(async (req, res) => {
    const result = await updateWithApproval({
      entity_type: 'insurer',
      entity_id: parseInt(req.params.id),
      getFunction: async (id) => {
        return await service.getInsurer(id);
      },
      updateFunction: async (id, data) => {
        return await service.updateInsurer(id, data);
      },
      new_data: {
        ...req.body,
        updated_by: req.user.id
      },
      user: req.user,
      notes: req.body.approval_notes || '',
      priority: req.body.priority || 'medium'
    });

    const response = formatApprovalResponse(result);
    logger.info('Insurer update request', { 
      insurerId: req.params.id, 
      needsApproval: response.approval_required,
      userId: req.user.id 
    });

    return ApiResponse.success(res, response, response.message);
  })
);

//  Soft delete insurers
router.post(
  '/insurers/delete',
  verifyToken,
  requirePermission('insurers.delete'),
  validateRequest(deleteInsurersSchema),
  asyncHandler(async (req, res) => {
    // Handle multiple deletions
    const results = [];
    
    for (const id of req.body.ids) {
      try {
        const result = await deleteWithApproval({
          entity_type: 'insurer',
          entity_id: id,
          getFunction: async (ids) => {
            // Handle both single ID and array of IDs
            if (Array.isArray(ids)) {
              return await service.getInsurersByIds(ids);
            }
            return await service.getInsurer(ids);
          },
          deleteFunction: async (entityId) => {
            return await service.softDeleteInsurer([entityId], req.user.id);
          },
          user: req.user,
          notes: req.body.approval_notes || '',
          priority: req.body.priority || 'high'
        });
        results.push({ id, ...formatApprovalResponse(result) });
      } catch (error) {
        results.push({ id, error: error.message });
      }
    }

    const needsApproval = results.some(r => r.approval_required);
    const message = needsApproval 
      ? 'Delete requests submitted for Super Admin approval'
      : 'Insurers deleted successfully';

    logger.info('Insurers deletion request', { 
      count: results.length, 
      needsApproval,
      userId: req.user.id 
    });

    return ApiResponse.success(res, { results }, message);
  })
);

//  Permanent delete
router.delete('/insurers/:id', verifyToken, requirePermission('insurers.delete'), asyncHandler(async (req, res) => {
    const affected = await service.deleteInsurer(req.params.id);
    if (!affected) return ApiResponse.notFound(res, 'Insurer not found');
    logger.info('Insurer deleted permanently', { insurerId: req.params.id, deletedBy: req.user.id });
    return ApiResponse.success(res, { deleted: affected }, 'Insurer deleted successfully');
}));

module.exports = router;
