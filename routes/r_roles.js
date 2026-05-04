const express = require('express');
const router = express.Router();
const roleSchemas = require('../validation/v_role');
const { verifyToken } = require('../lib/auth');
const { requirePermission } = require('../lib/permissions');
const { asyncHandler } = require('../middleware/errorHandler');
const validateRequest = require('../middleware/validateRequest');
const ApiResponse = require('../lib/response');
const logger = require('../lib/logger');
const { parsePaginationParams } = require('../lib/helpers');
const service = require('../services/s_roles');


router.get('/roles', asyncHandler(async (req, res) => {
    const { page, limit, search, sortBy, sortOrder } = parsePaginationParams(req.query);

    const result = await service.listRoles({
        page,
        limit,
        search,
        sortBy,
        sortOrder
    });
    
    return ApiResponse.paginated(res, result.data, result.pagination);
}));

router.get('/roles/check-name', validateRequest(roleSchemas.checkName, 'query'), asyncHandler(async (req, res) => {
    const { name, excludeId } = req.query;
    
    const exists = await service.checkRoleNameExists(name, excludeId);
    
    return ApiResponse.success(res, {
        available: !exists,
        message: exists ? 'Role name already exists' : 'Role name is available'
    });
}));

router.get('/roles/:id', verifyToken, asyncHandler(async (req, res) => {
    const role = await service.getRole(req.params.id);
    
    if (!role) {
        return ApiResponse.notFound(res, 'Role not found');
    }
    
    return ApiResponse.success(res, role);
}));

router.post('/roles', verifyToken, requirePermission('roles.create'), validateRequest(roleSchemas.create), asyncHandler(async (req, res) => {
    const id = await service.createRole(req.body, req.user.id);
    
    logger.info('Role created', {
        roleId: id,
        roleName: req.body.role_name,
        createdBy: req.user.id,
        who: req.user.who,
        ip: req.ip
    });
    
    return ApiResponse.success(res, { id }, 'Role created successfully', 201);
}));

router.put('/roles/:id', verifyToken, requirePermission('roles.update'), validateRequest(roleSchemas.update), asyncHandler(async (req, res) => {
    const affected = await service.updateRole(req.params.id, req.body, req.user.id);
    
    if (!affected) {
        return ApiResponse.notFound(res, 'Role not found or no changes made');
    }

    logger.info('Role updated', {
        roleId: req.params.id,
        updatedFields: Object.keys(req.body),
        updatedBy: req.user.id,
        who: req.user.who,
        ip: req.ip
    });
    
    return ApiResponse.success(res, { updated: affected }, 'Role updated successfully');
}));

router.post('/roles/delete', verifyToken, requirePermission('roles.delete'), validateRequest(roleSchemas.delete), asyncHandler(async (req, res) => {
    const { ids } = req.body;
    const idsArray = Array.isArray(ids) ? ids : [ids];
    
    let totalDeleted = 0;
    for (const id of idsArray) {
        const affected = await service.deleteRole(id, req.user.id);
        totalDeleted += affected;
    }

    if (totalDeleted === 0) {
        return ApiResponse.notFound(res, 'No roles found to delete');
    }

    logger.info('Roles deleted', {
        roleIds: idsArray,
        totalDeleted,
        deletedBy: req.user.id,
        who: req.user.who,
        ip: req.ip
    });
    
    return ApiResponse.success(res, { deleted: totalDeleted }, `${totalDeleted} role(s) deleted successfully`);
}));

router.delete('/roles/:id', verifyToken, requirePermission('roles.delete'), asyncHandler(async (req, res) => {
    const roleId = parseInt(req.params.id);
    
    const affected = await service.deleteRole(roleId, req.user.id);
    
    if (!affected) {
        return ApiResponse.notFound(res, 'Role not found');
    }

    logger.warn('Role permanently deleted', {
        roleId,
        deletedBy: req.user.id,
        who: req.user.who,
        ip: req.ip
    });
    
    return ApiResponse.success(res, { deleted: affected }, 'Role permanently deleted');
}));

module.exports = router;
