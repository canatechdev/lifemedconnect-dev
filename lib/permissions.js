const db = require('./dbconnection');
const logger = require('./logger');
const ApiResponse = require('./response');

/**
 * Fetch all permissions assigned to a role from the database
 * @param {number} roleId - The role ID
 * @returns {Promise<string[]>} Array of permission names
 */
async function getRolePermissions(roleId) {
    if (!roleId) return [];
    try {
        const rows = await db.query(
            `SELECT p.name 
             FROM role_permissions rp 
             JOIN permissions p ON rp.permission_id = p.id 
             WHERE rp.role_id = ?`,
            [roleId]
        );
        return rows.map(row => row.name);
    } catch (error) {
        logger.error('Failed to load role permissions', { roleId, error: error.message });
        return [];
    }
}

/**
 * Fetch user-specific permission overrides (grants and revokes)
 * @param {number} userId - The user ID
 * @returns {Promise<{grants: string[], revokes: string[]}>}
 */
async function getUserPermissionOverrides(userId) {
    if (!userId) return { grants: [], revokes: [] };
    try {
        const rows = await db.query(
            `SELECT p.name, up.assignment_type 
             FROM user_permissions up
             JOIN permissions p ON up.permission_id = p.id
             WHERE up.user_id = ?`,
            [userId]
        );

        const grants = [];
        const revokes = [];
        for (const row of rows) {
            if (row.assignment_type === 'revoke') {
                revokes.push(row.name);
            } else {
                grants.push(row.name);
            }
        }
        return { grants, revokes };
    } catch (error) {
        logger.error('Failed to load user permission overrides', { userId, error: error.message });
        return { grants: [], revokes: [] };
    }
}

/**
 * Get the final merged permissions for a user (role permissions + user overrides)
 * @param {number} userId - The user ID
 * @param {number} roleId - The user's role ID
 * @returns {Promise<string[]>} Final array of permission names
 */
async function getUserPermissions(userId, roleId) {
    const rolePerms = await getRolePermissions(roleId);
    const overrides = await getUserPermissionOverrides(userId);

    const permSet = new Set(rolePerms);
    overrides.grants.forEach((perm) => permSet.add(perm));
    overrides.revokes.forEach((perm) => permSet.delete(perm));

    return Array.from(permSet);
}

/**
 * Check if a user has a specific permission (supports wildcards)
 * @param {string[]} userPermissions - Array of user's permission names
 * @param {string} required - The required permission name
 * @returns {boolean} True if user has the permission
 */
function hasPermission(userPermissions, required) {
    if (!required || !userPermissions || !userPermissions.length) return false;
    if (userPermissions.includes('*')) return true; // global wildcard
    if (userPermissions.includes(required)) return true;

    // Support wildcard patterns
    for (const perm of userPermissions) {
        if (perm.endsWith('.*')) {
            const prefix = perm.slice(0, -1);
            if (required.startsWith(prefix)) return true;
        }
        if (perm.startsWith('*.')) {
            const suffix = perm.slice(1);
            if (required.endsWith(suffix)) return true;
        }
    }
    return false;
}

/**
 * Express middleware to require one or more permissions
 * @param {string|string[]} permissions - Required permission(s)
 * @param {Object} options - Options: { requireAll: false }
 * @returns {Function} Express middleware function
 */
function requirePermission(permissions, options = {}) {
    const permsArray = Array.isArray(permissions) ? permissions : [permissions];
    const { requireAll = false } = options;

    return (req, res, next) => {
        const userPerms = req.user?.permissions || [];

        if (permsArray.length === 0) {
            return next();
        }

        const checker = requireAll
            ? permsArray.every((perm) => hasPermission(userPerms, perm))
            : permsArray.some((perm) => hasPermission(userPerms, perm));

        if (!checker) {
            return ApiResponse.forbidden(res, 'You do not have permission to perform this action');
        }

        return next();
    };
}

/**
 * Middleware to require any of the specified permissions (OR logic)
 * @param {string[]} permissions - Array of permission names (user needs ANY of these)
 * @returns {Function} Express middleware function
 */
function requireAnyPermission(permissions) {
    return (req, res, next) => {
        if (!req.user || !req.user.permissions) {
            return ApiResponse.forbidden(res, 'Authentication required');
        }

        const userPerms = req.user.permissions;
        const hasAnyPerm = permissions.some(perm => hasPermission(userPerms, perm));

        if (!hasAnyPerm) {
            return ApiResponse.forbidden(res, 'You do not have permission to perform this action');
        }

        return next();
    };
}

module.exports = {
    getRolePermissions,
    getUserPermissionOverrides,
    getUserPermissions,
    hasPermission,
    requirePermission,
    requireAnyPermission
};
