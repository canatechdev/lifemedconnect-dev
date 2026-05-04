const express = require('express');
const router = express.Router();
const Joi = require('joi');
const { verifyToken } = require('../lib/auth');
const { requirePermission } = require('../lib/permissions');
const { asyncHandler } = require('../middleware/errorHandler');
const validateRequest = require('../middleware/validateRequest');
const ApiResponse = require('../lib/response');
const logger = require('../lib/logger');
const { createWithApproval, updateWithApproval, deleteWithApproval, formatApprovalResponse } = require('../lib/approvalHelper');
const { toFloat } = require('../lib/normalizers');
const { parsePaginationParams } = require('../lib/helpers');
const service = require('../services/s_test_categories');
const categorySchemas = require('../validation/v_test_categories');

router.get('/category', verifyToken, asyncHandler(async (req, res) => {
    const { page, limit, search, sortBy, sortOrder } = parsePaginationParams(req.query);

    logger.info('Fetching test categories', {
        userId: req.user.id,
        ip: req.ip,
        options: { page, limit, search, sortBy, sortOrder }
    });

    const result = await service.listCategories({
        page,
        limit,
        search,
        sortBy,
        sortOrder
    });

    return ApiResponse.paginated(res, result.data, result.pagination);
}));

router.get('/category/:id', verifyToken, asyncHandler(async (req, res) => {
    const categoryId = parseInt(req.params.id);

    if (isNaN(categoryId)) {
        return ApiResponse.error(res, 'Invalid category ID', 400);
    }

    logger.info('Fetching test category', {
        userId: req.user.id,
        ip: req.ip,
        categoryId
    });

    const row = await service.getCategory(categoryId);
    if (!row) {
        return ApiResponse.notFound(res, 'Category not found');
    }

    return ApiResponse.success(res, row);
}));

router.post(
    '/category',
    verifyToken,
    requirePermission('categories.create'),
    validateRequest(categorySchemas.create),
    asyncHandler(async (req, res) => {
        const categoryData = {
            ...req.body,
            created_by: req.user.id,
            report_type: req.body.report_type
        };

        // Normalize rate field
        if (categoryData.rate !== undefined && categoryData.rate !== null) {
            categoryData.rate = toFloat(categoryData.rate);
        }

        logger.info('Creating test category', {
            userId: req.user.id,
            ip: req.ip,
            categoryName: categoryData.category_name,
            hasRate: !!(categoryData.client_id || categoryData.insurer_id || categoryData.rate)
        });

        const result = await createWithApproval({
            entity_type: 'test_category',
            createFunction: async (data) => {
                return await service.createCategory(data, req.user.id);
            },
            data: categoryData,
            user: req.user,
            notes: req.body.approval_notes || '',
            priority: req.body.priority || 'medium'
        });

        const response = formatApprovalResponse(result);
        logger.info('Category creation request', {
            categoryId: response.id,
            needsApproval: response.approval_required,
            userId: req.user.id
        });

        return ApiResponse.success(res, response, response.message, 201);
    })
);

router.put(
    '/category/:id',
    verifyToken,
    requirePermission('categories.update'),
    validateRequest(categorySchemas.update),
    asyncHandler(async (req, res) => {
        const categoryId = parseInt(req.params.id);

        if (isNaN(categoryId)) {
            return ApiResponse.error(res, 'Invalid category ID', 400);
        }

        const updateData = {
            ...req.body,
            updated_by: req.user.id,
            report_type: req.body.report_type
        };

        // Normalize rate field
        if (updateData.rate !== undefined && updateData.rate !== null) {
            updateData.rate = toFloat(updateData.rate);
        }

        logger.info('Updating test category', {
            userId: req.user.id,
            ip: req.ip,
            categoryId,
            updatedFields: Object.keys(updateData)
        });

        const result = await updateWithApproval({
            entity_type: 'test_category',
            entity_id: categoryId,
            getFunction: async (id) => {
                return await service.getCategory(id);
            },
            updateFunction: async (id, data) => {
                return await service.updateCategory(id, data);
            },
            new_data: updateData,
            user: req.user,
            notes: req.body.approval_notes || '',
            priority: req.body.priority || 'medium'
        });

        const response = formatApprovalResponse(result);
        logger.info('Category update request', {
            categoryId,
            needsApproval: response.approval_required,
            userId: req.user.id
        });

        return ApiResponse.success(res, response, response.message);
    })
);

router.delete('/category/:id', verifyToken, requirePermission('categories.delete'), asyncHandler(async (req, res) => {
    const categoryId = parseInt(req.params.id);

    if (isNaN(categoryId)) {
        return ApiResponse.error(res, 'Invalid category ID', 400);
    }

    logger.info('Deleting test category', {
        userId: req.user.id,
        ip: req.ip,
        categoryId
    });

    const affected = await service.deleteCategory(categoryId);
    if (!affected) {
        return ApiResponse.notFound(res, 'Category not found');
    }

    logger.info('Category deleted', { categoryId, deletedBy: req.user.id });
    return ApiResponse.success(res, { deleted: affected }, 'Category deleted successfully');
}));

/**
 * @route POST /category/delete
 * @desc Soft delete test categories (with approval support)
 * @access Private (Admin, Super Admin)
 */
router.post(
    '/category/delete',
    verifyToken,
    requirePermission('categories.delete'),
    validateRequest(categorySchemas.delete),
    asyncHandler(async (req, res) => {
        logger.info('Processing test categories deletion request', {
            userId: req.user.id,
            ip: req.ip,
            categoryIds: req.body.ids
        });

        const results = [];

        for (const id of req.body.ids) {
            try {
                const result = await deleteWithApproval({
                    entity_type: 'test_category',
                    entity_id: id,
                    getFunction: async (ids) => {
                        // Handle both single ID and array of IDs
                        if (Array.isArray(ids)) {
                            return await service.getCategoriesByIds(ids);
                        }
                        return await service.getCategory(ids);
                    },
                    deleteFunction: async (entityId) => {
                        return await service.softDeleteCategory([entityId], req.user.id);
                    },
                    user: req.user,
                    notes: req.body.approval_notes || '',
                    priority: req.body.priority || 'high'
                });

                results.push({ id, ...formatApprovalResponse(result) });

            } catch (error) {
                logger.error('Failed to process category deletion', {
                    categoryId: id,
                    error: error.message,
                    userId: req.user.id
                });
                results.push({ id, error: error.message });
            }
        }

        const needsApproval = results.some(r => r.approval_required);
        const message = needsApproval
            ? 'Delete requests submitted for Super Admin approval'
            : 'Categories deleted successfully';

        logger.info('Category deletion request completed', {
            count: results.length,
            needsApproval,
            userId: req.user.id
        });

        return ApiResponse.success(res, { results }, message);
    })
);

module.exports = router;