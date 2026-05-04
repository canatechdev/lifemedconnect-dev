const express = require('express');
const router = express.Router();
const rolePermissionSchemas = require('../validation/v_role_permissions');
const { verifyToken } = require('../lib/auth');
const { requirePermission } = require('../lib/permissions');
const { asyncHandler } = require('../middleware/errorHandler');
const validateRequest = require('../middleware/validateRequest');
const ApiResponse = require('../lib/response');
const logger = require('../lib/logger');
const service = require('../services/s_role_permissions');

/**
 * GET /api/permissions
 * Get all available permissions in the system
 */
router.get('/permissions', verifyToken, asyncHandler(async (req, res) => {
    const permissions = await service.getAllPermissions();
    
    return ApiResponse.success(res, permissions);
}));

/**
 * GET /api/roles/:roleId/permissions
 * Get all permissions assigned to a specific role
 */
router.get('/roles/:roleId/permissions', verifyToken, asyncHandler(async (req, res) => {
    const roleId = parseInt(req.params.roleId);
    
    if (isNaN(roleId)) {
        return ApiResponse.badRequest(res, 'Invalid role ID');
    }
    
    const permissions = await service.getRolePermissions(roleId);
    
    return ApiResponse.success(res, permissions);
}));

/**
 * GET /api/roles/:roleId/details
 * Get role details including all assigned permissions
 */
router.get('/roles/:roleId/details', verifyToken, asyncHandler(async (req, res) => {
    const roleId = parseInt(req.params.roleId);
    
    if (isNaN(roleId)) {
        return ApiResponse.badRequest(res, 'Invalid role ID');
    }
    
    const role = await service.getRoleWithPermissions(roleId);
    
    if (!role) {
        return ApiResponse.notFound(res, 'Role not found');
    }
    
    return ApiResponse.success(res, role);
}));

/**
 * GET /api/roles/with-permissions
 * Get all roles with their permission counts
 */
router.get('/roles/with-permissions', verifyToken, asyncHandler(async (req, res) => {
    const roles = await service.getRolesWithPermissionCounts();
    
    return ApiResponse.success(res, roles);
}));

/**
 * POST /api/roles/:roleId/permissions/assign
 * Assign permissions to a role (adds to existing permissions)
 */
router.post(
    '/roles/:roleId/permissions/assign',
    verifyToken,
    requirePermission('roles.update'),
    validateRequest(rolePermissionSchemas.assignPermissions),
    asyncHandler(async (req, res) => {
        const roleId = parseInt(req.params.roleId);
        
        if (isNaN(roleId)) {
            return ApiResponse.badRequest(res, 'Invalid role ID');
        }
        
        const { permission_ids } = req.body;
        
        const assigned = await service.assignPermissionsToRole(roleId, permission_ids);
        
        logger.info('Permissions assigned to role', {
            roleId,
            permissionIds: permission_ids,
            assigned,
            assignedBy: req.user.id,
            who: req.user.who,
            ip: req.ip
        });
        
        return ApiResponse.success(
            res,
            { assigned, total: permission_ids.length },
            `${assigned} permission(s) assigned to role`
        );
    })
);

/**
 * POST /api/roles/:roleId/permissions/remove
 * Remove permissions from a role
 */
router.post(
    '/roles/:roleId/permissions/remove',
    verifyToken,
    requirePermission('roles.update'),
    validateRequest(rolePermissionSchemas.removePermissions),
    asyncHandler(async (req, res) => {
        const roleId = parseInt(req.params.roleId);
        
        if (isNaN(roleId)) {
            return ApiResponse.badRequest(res, 'Invalid role ID');
        }
        
        const { permission_ids } = req.body;
        
        const removed = await service.removePermissionsFromRole(roleId, permission_ids);
        
        logger.info('Permissions removed from role', {
            roleId,
            permissionIds: permission_ids,
            removed,
            removedBy: req.user.id,
            who: req.user.who,
            ip: req.ip
        });
        
        return ApiResponse.success(
            res,
            { removed, total: permission_ids.length },
            `${removed} permission(s) removed from role`
        );
    })
);

/**
 * PUT /api/roles/:roleId/permissions/sync
 * Sync role permissions - replace all permissions with the provided list
 */
router.put(
    '/roles/:roleId/permissions/sync',
    verifyToken,
    requirePermission('roles.update'),
    validateRequest(rolePermissionSchemas.syncPermissions),
    asyncHandler(async (req, res) => {
        const roleId = parseInt(req.params.roleId);
        
        if (isNaN(roleId)) {
            return ApiResponse.badRequest(res, 'Invalid role ID');
        }
        
        const { permission_ids } = req.body;
        
        const result = await service.syncRolePermissions(roleId, permission_ids);
        
        logger.info('Role permissions synchronized', {
            roleId,
            permissionIds: permission_ids,
            result,
            syncedBy: req.user.id,
            who: req.user.who,
            ip: req.ip
        });
        
        return ApiResponse.success(
            res,
            result,
            'Role permissions synchronized successfully'
        );
    })
);

module.exports = router;
