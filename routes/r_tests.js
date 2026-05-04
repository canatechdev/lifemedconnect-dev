/**
 * Test Routes
 * Handles all test-related endpoints with approval workflow integration
 */

const express = require('express');
const router = express.Router();
const Joi = require('joi');
const logger = require('../lib/logger');
const ApiResponse = require('../lib/response');
const { asyncHandler } = require('../middleware/errorHandler');
const { verifyToken } = require('../lib/auth');
const { requirePermission } = require('../lib/permissions');
const validateRequest = require('../middleware/validateRequest');
const { createWithApproval, updateWithApproval, deleteWithApproval, formatApprovalResponse } = require('../lib/approvalHelper');
const db = require('../lib/dbconnection');
const { processSingleFile } = require('../lib/fileUpload');
const { mixedUpload } = require('../lib/multer');
const testSchemas = require('../validation/v_test');
const service = require('../services/s_tests');

// ===============================
// Test Routes
// ===============================

// GET /tests - List tests with pagination and search
router.get('/tests', verifyToken, asyncHandler(async (req, res) => {

  const page = req.query.page ? parseInt(req.query.page) : null;
  const limit = req.query.limit ? parseInt(req.query.limit) : null;

  const search = req.query.q || '';
  const sortBy = req.query.sortBy || 'id';
  const sortOrder = req.query.sortOrder || 'DESC';

  const result = await service.listTests({ page, limit, search, sortBy, sortOrder });
  return ApiResponse.paginated(res, result.data, result.pagination, 'Tests retrieved successfully');
}));

// GET /tests/check-name - Check if test name is available
router.get('/tests/check-name', verifyToken, validateRequest(testSchemas.checkName, 'query'), asyncHandler(async (req, res) => {
  const { name, excludeId } = req.query;
  const result = await service.checkTestNameAvailability(name, excludeId);
  logger.info('Test name availability checked', { name, available: result.available, userId: req.user.id });
  return ApiResponse.success(res, result, result.message);
}));

// GET /tests/:id - Get single test
router.get('/tests/:id', verifyToken, asyncHandler(async (req, res) => {
  const test = await service.getTest(req.params.id);
  if (!test) return ApiResponse.notFound(res, 'Test not found');
  return ApiResponse.success(res, test, 'Test retrieved successfully');
}));

// POST /tests - Create test
router.post(
  '/tests',
  verifyToken,
  requirePermission('tests.create'),
  validateRequest(testSchemas.create), asyncHandler(async (req, res) => {
    const result = await createWithApproval({
      entity_type: 'test',
      createFunction: async (data, connection) => {
        return await service.createTest(data, req.user.id, connection);
      },
      data: {
        test_name: req.body.test_name,
        description: req.body.description,
        test_code: req.body.test_code,
        is_active: req.body.is_active,
        report_type: req.body.report_type
      },
      user: req.user,
      notes: req.body.approval_notes || '',
      priority: req.body.priority || 'medium'
    });

    const response = formatApprovalResponse(result);
    logger.info('Test creation request submitted', {
      testId: response.id,
      needsApproval: response.approval_required,
      userId: req.user.id,
      test_name: req.body.test_name
    });

    return ApiResponse.success(res, response, response.message, 201);
  })
);

// PUT /tests/:id - Update test
router.put(
  '/tests/:id',
  verifyToken,
  requirePermission('tests.update'),
  validateRequest(testSchemas.update), asyncHandler(async (req, res) => {
    const testId = parseInt(req.params.id);
    const result = await updateWithApproval({
      entity_type: 'test',
      entity_id: testId,
      getFunction: async (id) => {
        return await service.getTest(id);
      },
      updateFunction: async (id, data, connection) => {
        return await service.updateTest(id, data, req.user.id, connection);
      },
      new_data: {
        test_name: req.body.test_name,
        description: req.body.description,
        test_code: req.body.test_code,
        is_active: req.body.is_active,
        report_type: req.body.report_type
      },
      user: req.user,
      notes: req.body.approval_notes || '',
      priority: req.body.priority || 'medium'
    });

    const response = formatApprovalResponse(result);
    logger.info('Test update request submitted', {
      testId,
      needsApproval: response.approval_required,
      userId: req.user.id
    });

    return ApiResponse.success(res, response, response.message);
  })
);

// POST /tests/delete - Soft delete multiple tests
router.post(
  '/tests/delete',
  verifyToken,
  requirePermission('tests.delete'),
  validateRequest(testSchemas.delete), asyncHandler(async (req, res) => {
    const { ids, approval_notes, priority } = req.body;
    const results = [];

    // Process each test deletion
    for (const id of ids) {
      try {
        const result = await deleteWithApproval({
          entity_type: 'test',
          entity_id: id,
          getFunction: async (testIds) => {
            // Handle both single ID and array of IDs
            if (Array.isArray(testIds)) {
              return await service.getTestsByIds(testIds);
            }
            return await service.getTest(testIds);
          },
          deleteFunction: async (entityId, connection) => {
            return await service.softDeleteTests([entityId], req.user.id, connection);
          },
          user: req.user,
          notes: approval_notes || '',
          priority: priority || 'high'
        });

        results.push({
          id,
          ...formatApprovalResponse(result)
        });

      } catch (error) {
        logger.error('Error processing test deletion', {
          testId: id,
          error: error.message
        });
        results.push({
          id,
          error: error.message,
          status: 'failed'
        });
      }
    }

    const needsApproval = results.some(r => r.approval_required);
    const successCount = results.filter(r => !r.error).length;
    const message = needsApproval
      ? `Delete requests submitted for Super Admin approval (${successCount}/${ids.length})`
      : `Tests deleted successfully (${successCount}/${ids.length})`;

    logger.info('Test deletion requests processed', {
      total: ids.length,
      successful: successCount,
      needsApproval,
      userId: req.user.id
    });

    return ApiResponse.success(res, { results }, message);
  })
);

// DELETE /tests/:id - Hard delete test (admin only)
router.delete('/tests/:id', verifyToken, requirePermission('tests.delete'), asyncHandler(async (req, res) => {
  const affected = await service.deleteTest(req.params.id);
  if (!affected) {
    return ApiResponse.notFound(res, 'Test not found');
  }

  logger.warn('Test permanently deleted', { testId: req.params.id, deletedBy: req.user.id });
  return ApiResponse.success(res, { deleted: affected }, 'Test deleted successfully');
}));

module.exports = router;
