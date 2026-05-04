const express = require('express');
const router = express.Router();
const { verifyToken } = require('../lib/auth');
const { requirePermission } = require('../lib/permissions');
const { asyncHandler } = require('../middleware/errorHandler');
const ApiResponse = require('../lib/response');
const logger = require('../lib/logger');
const db = require('../lib/dbconnection');
const { permissionCatalog } = require('../lib/permissionCatalog');

/**
 * GET /api/permissions - List all available permissions
 * Returns the complete permission catalog
 */
router.get('/permissions', verifyToken, requirePermission('roles.view'), asyncHandler(async (req, res) => {
    return ApiResponse.success(res, permissionCatalog, 'Permissions retrieved successfully');
}));

/**
 * GET /api/rbac/roles - List all roles with their permissions
 * Returns roles with their assigned permissions
 */
router.get('/rbac/roles', verifyToken, requirePermission('roles.view'), asyncHandler(async (req, res) => {
    const roles = await db.query(`
        SELECT 
            r.id,
            r.role_name,
            r.description,
            GROUP_CONCAT(p.name ORDER BY p.name SEPARATOR ',') as permissions
        FROM roles r
        LEFT JOIN role_permissions rp ON r.id = rp.role_id
        LEFT JOIN permissions p ON rp.permission_id = p.id
        GROUP BY r.id, r.role_name, r.description
        ORDER BY r.id
    `);

    // Parse permissions string into array
    const rolesWithPermissions = roles.map(role => ({
        ...role,
        permissions: role.permissions ? role.permissions.split(',') : []
    }));

    return ApiResponse.success(res, rolesWithPermissions, 'Roles retrieved successfully');
}));

/**
 * GET /api/rbac/roles/:id - Get a single role with its permissions
 */
router.get('/rbac/roles/:id', verifyToken, requirePermission('roles.view'), asyncHandler(async (req, res) => {
    const roleId = parseInt(req.params.id, 10);

    const roleRows = await db.query('SELECT * FROM roles WHERE id = ?', [roleId]);
    if (!roleRows.length) {
        return ApiResponse.notFound(res, 'Role not found');
    }

    const permissionRows = await db.query(`
        SELECT p.id, p.name, p.description
        FROM role_permissions rp
        JOIN permissions p ON rp.permission_id = p.id
        WHERE rp.role_id = ?
        ORDER BY p.name
    `, [roleId]);

    const role = {
        ...roleRows[0],
        permissions: permissionRows
    };

    return ApiResponse.success(res, role, 'Role retrieved successfully');
}));

/**
 * POST /api/roles/:id/permissions - Bulk set permissions for a role
 * Replaces all existing permissions with the provided list
 */
router.post('/roles/:id/permissions', verifyToken, requirePermission('roles.update'), asyncHandler(async (req, res) => {
    const roleId = parseInt(req.params.id, 10);
    const { permissions } = req.body;

    if (!Array.isArray(permissions)) {
        return ApiResponse.badRequest(res, 'Permissions must be an array');
    }

    // Verify role exists
    const roleRows = await db.query('SELECT id FROM roles WHERE id = ?', [roleId]);
    if (!roleRows.length) {
        return ApiResponse.notFound(res, 'Role not found');
    }

    // Get permission IDs from names
    if (permissions.length > 0) {
        const placeholders = permissions.map(() => '?').join(',');
        const permissionRows = await db.query(
            `SELECT id, name FROM permissions WHERE name IN (${placeholders})`,
            permissions
        );

        if (permissionRows.length !== permissions.length) {
            const foundNames = permissionRows.map(p => p.name);
            const missing = permissions.filter(p => !foundNames.includes(p));
            return ApiResponse.badRequest(res, `Invalid permissions: ${missing.join(', ')}`);
        }

        // Delete existing permissions
        await db.query('DELETE FROM role_permissions WHERE role_id = ?', [roleId]);

        // Insert new permissions
        const values = permissionRows.map(() => '(?, ?)').join(',');
        const params = permissionRows.flatMap(p => [roleId, p.id]);
        await db.query(
            `INSERT INTO role_permissions (role_id, permission_id) VALUES ${values}`,
            params
        );

        logger.info('Role permissions updated', { 
            roleId, 
            permissionCount: permissions.length,
            updatedBy: req.user.id 
        });
    } else {
        // Remove all permissions if empty array provided
        await db.query('DELETE FROM role_permissions WHERE role_id = ?', [roleId]);
        logger.info('All role permissions removed', { roleId, updatedBy: req.user.id });
    }

    return ApiResponse.success(res, { roleId, permissions }, 'Role permissions updated successfully');
}));

/**
 * GET /api/rbac/users - List users with role filtering
 */
router.get('/rbac/users', verifyToken, requirePermission('users.view'), asyncHandler(async (req, res) => {
    const { role_id } = req.query;

    let query = `
        SELECT 
            u.id,
            u.username,
            u.email,
            u.full_name,
            u.role_id,
            r.role_name,
            u.is_active,
            u.created_at
        FROM users u
        LEFT JOIN roles r ON u.role_id = r.id
        WHERE u.deleted_at IS NULL
    `;
    const params = [];

    if (role_id) {
        query += ' AND u.role_id = ?';
        params.push(parseInt(role_id, 10));
    }

    query += ' ORDER BY u.created_at DESC';

    const users = await db.query(query, params);
    return ApiResponse.success(res, users, 'Users retrieved successfully');
}));

/**
 * POST /api/users/:id/permissions - Grant or revoke specific permissions for a user
 */
router.post('/users/:id/permissions', verifyToken, requirePermission('users.manage_roles'), asyncHandler(async (req, res) => {
    const userId = parseInt(req.params.id, 10);
    const { permission, action } = req.body; // action: 'grant' or 'revoke'

    if (!permission || !action) {
        return ApiResponse.badRequest(res, 'Permission name and action (grant/revoke) are required');
    }

    if (!['grant', 'revoke'].includes(action)) {
        return ApiResponse.badRequest(res, 'Action must be either "grant" or "revoke"');
    }

    // Verify user exists
    const userRows = await db.query('SELECT id FROM users WHERE id = ?', [userId]);
    if (!userRows.length) {
        return ApiResponse.notFound(res, 'User not found');
    }

    // Get permission ID
    const permRows = await db.query('SELECT id FROM permissions WHERE name = ?', [permission]);
    if (!permRows.length) {
        return ApiResponse.notFound(res, 'Permission not found');
    }

    const permissionId = permRows[0].id;

    // Check if override already exists
    const existingRows = await db.query(
        'SELECT * FROM user_permissions WHERE user_id = ? AND permission_id = ?',
        [userId, permissionId]
    );

    if (existingRows.length > 0) {
        // Update existing override
        await db.query(
            'UPDATE user_permissions SET assignment_type = ? WHERE user_id = ? AND permission_id = ?',
            [action, userId, permissionId]
        );
    } else {
        // Insert new override
        await db.query(
            'INSERT INTO user_permissions (user_id, permission_id, assignment_type) VALUES (?, ?, ?)',
            [userId, permissionId, action]
        );
    }

    logger.info('User permission override set', { 
        userId, 
        permission, 
        action,
        setBy: req.user.id 
    });

    return ApiResponse.success(res, { userId, permission, action }, 'User permission updated successfully');
}));

/**
 * DELETE /api/users/:id/permissions/:permission - Remove a permission override for a user
 */
router.delete('/users/:id/permissions/:permission', verifyToken, requirePermission('users.manage_roles'), asyncHandler(async (req, res) => {
    const userId = parseInt(req.params.id, 10);
    const permissionName = req.params.permission;

    // Get permission ID
    const permRows = await db.query('SELECT id FROM permissions WHERE name = ?', [permissionName]);
    if (!permRows.length) {
        return ApiResponse.notFound(res, 'Permission not found');
    }

    const permissionId = permRows[0].id;

    // Delete override
    const result = await db.query(
        'DELETE FROM user_permissions WHERE user_id = ? AND permission_id = ?',
        [userId, permissionId]
    );

    if (result.affectedRows === 0) {
        return ApiResponse.notFound(res, 'Permission override not found');
    }

    logger.info('User permission override removed', { 
        userId, 
        permission: permissionName,
        removedBy: req.user.id 
    });

    return ApiResponse.success(res, null, 'Permission override removed successfully');
}));

/**
 * GET /api/users/:id/permissions - Get all permissions for a specific user
 * Returns role permissions + user overrides
 */
router.get('/users/:id/permissions', verifyToken, requirePermission('users.view'), asyncHandler(async (req, res) => {
    const userId = parseInt(req.params.id, 10);

    // Verify user exists
    const userRows = await db.query('SELECT id, role_id FROM users WHERE id = ?', [userId]);
    if (!userRows.length) {
        return ApiResponse.notFound(res, 'User not found');
    }

    const user = userRows[0];

    // Get role permissions
    const rolePerms = await db.query(`
        SELECT p.name, p.description, 'role' as source
        FROM role_permissions rp
        JOIN permissions p ON rp.permission_id = p.id
        WHERE rp.role_id = ?
        ORDER BY p.name
    `, [user.role_id]);

    // Get user overrides
    const userOverrides = await db.query(`
        SELECT p.name, p.description, up.assignment_type as source
        FROM user_permissions up
        JOIN permissions p ON up.permission_id = p.id
        WHERE up.user_id = ?
        ORDER BY p.name
    `, [userId]);

    return ApiResponse.success(res, {
        userId,
        roleId: user.role_id,
        rolePermissions: rolePerms,
        userOverrides: userOverrides
    }, 'User permissions retrieved successfully');
}));

module.exports = router;
