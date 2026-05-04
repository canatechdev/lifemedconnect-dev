const db = require('../lib/dbconnection');
const logger = require('../lib/logger');

/**
 * Service layer for role-permission management
 * Handles the many-to-many relationship between roles and permissions
 */
class RolePermissionsService {
    /**
     * Get all permissions assigned to a specific role
     * @param {number} roleId - The role ID
     * @returns {Promise<Array>} Array of permission objects
     */
    async getRolePermissions(roleId) {
        try {
            const sql = `
                SELECT 
                    p.id,
                    p.name,
                    p.description,
                    rp.assigned_at
                FROM permissions p
                INNER JOIN role_permissions rp ON p.id = rp.permission_id
                WHERE rp.role_id = ?
                ORDER BY p.name
            `;
            
            const permissions = await db.query(sql, [roleId]);
            
            logger.debug('Retrieved role permissions', {
                roleId,
                count: permissions.length
            });
            
            return permissions;
        } catch (error) {
            logger.error('Failed to get role permissions', {
                error: error.message,
                roleId
            });
            throw error;
        }
    }

    /**
     * Get all available permissions in the system
     * @returns {Promise<Array>} Array of all permission objects
     */
    async getAllPermissions() {
        try {
            const sql = `
                SELECT 
                    id,
                    name,
                    description,
                    created_at,
                    updated_at
                FROM permissions
                ORDER BY name
            `;
            
            const permissions = await db.query(sql);
            
            logger.debug('Retrieved all permissions', {
                count: permissions.length
            });
            
            return permissions;
        } catch (error) {
            logger.error('Failed to get all permissions', {
                error: error.message
            });
            throw error;
        }
    }

    /**
     * Assign permissions to a role
     * @param {number} roleId - The role ID
     * @param {Array<number>} permissionIds - Array of permission IDs to assign
     * @returns {Promise<number>} Number of permissions assigned
     */
    async assignPermissionsToRole(roleId, permissionIds) {
        try {
            if (!Array.isArray(permissionIds) || permissionIds.length === 0) {
                return 0;
            }

            // Use INSERT IGNORE to avoid duplicate key errors
            const values = permissionIds.map(permId => `(${roleId}, ${permId})`).join(',');
            const sql = `
                INSERT IGNORE INTO role_permissions (role_id, permission_id)
                VALUES ${values}
            `;
            
            const result = await db.query(sql);
            
            logger.info('Permissions assigned to role', {
                roleId,
                permissionIds,
                assigned: result.affectedRows
            });
            
            return result.affectedRows;
        } catch (error) {
            logger.error('Failed to assign permissions to role', {
                error: error.message,
                roleId,
                permissionIds
            });
            throw error;
        }
    }

    /**
     * Remove permissions from a role
     * @param {number} roleId - The role ID
     * @param {Array<number>} permissionIds - Array of permission IDs to remove
     * @returns {Promise<number>} Number of permissions removed
     */
    async removePermissionsFromRole(roleId, permissionIds) {
        try {
            if (!Array.isArray(permissionIds) || permissionIds.length === 0) {
                return 0;
            }

            const placeholders = permissionIds.map(() => '?').join(',');
            const sql = `
                DELETE FROM role_permissions
                WHERE role_id = ? AND permission_id IN (${placeholders})
            `;
            
            const result = await db.query(sql, [roleId, ...permissionIds]);
            
            logger.info('Permissions removed from role', {
                roleId,
                permissionIds,
                removed: result.affectedRows
            });
            
            return result.affectedRows;
        } catch (error) {
            logger.error('Failed to remove permissions from role', {
                error: error.message,
                roleId,
                permissionIds
            });
            throw error;
        }
    }

    /**
     * Sync role permissions - replace all permissions for a role
     * @param {number} roleId - The role ID
     * @param {Array<number>} permissionIds - Array of permission IDs to set
     * @returns {Promise<Object>} Object with added and removed counts
     */
    async syncRolePermissions(roleId, permissionIds) {
        const connection = await db.getConnection();
        
        try {
            await connection.beginTransaction();

            // Get current permissions - use execute instead of query
            const [currentPerms] = await connection.execute(
                'SELECT permission_id FROM role_permissions WHERE role_id = ?',
                [roleId]
            );
            const currentIds = currentPerms.map(p => p.permission_id);
            
            // Calculate differences
            const toAdd = permissionIds.filter(id => !currentIds.includes(id));
            const toRemove = currentIds.filter(id => !permissionIds.includes(id));

            let added = 0;
            let removed = 0;

            // Remove permissions that are no longer selected
            if (toRemove.length > 0) {
                const placeholders = toRemove.map(() => '?').join(',');
                const [result] = await connection.execute(
                    `DELETE FROM role_permissions WHERE role_id = ? AND permission_id IN (${placeholders})`,
                    [roleId, ...toRemove]
                );
                removed = result.affectedRows;
                
                logger.info('Removed permissions from role', {
                    roleId,
                    removedIds: toRemove,
                    removedCount: removed
                });
            }

            // Add new permissions
            if (toAdd.length > 0) {
                const values = toAdd.map(permId => `(${roleId}, ${permId})`).join(',');
                const [result] = await connection.execute(
                    `INSERT IGNORE INTO role_permissions (role_id, permission_id) VALUES ${values}`
                );
                added = result.affectedRows;
                
                logger.info('Added permissions to role', {
                    roleId,
                    addedIds: toAdd,
                    addedCount: added
                });
            }

            await connection.commit();
            
            logger.info('Role permissions synchronized successfully', {
                roleId,
                added,
                removed,
                total: permissionIds.length,
                currentTotal: currentIds.length,
                newTotal: permissionIds.length
            });

            return { added, removed, total: permissionIds.length };
        } catch (error) {
            await connection.rollback();
            logger.error('Failed to sync role permissions', {
                error: error.message,
                stack: error.stack,
                roleId,
                permissionIds
            });
            throw error;
        } finally {
            connection.release();
        }
    }

    /**
     * Get roles with their permission counts
     * @returns {Promise<Array>} Array of roles with permission counts
     */
    async getRolesWithPermissionCounts() {
        try {
            const sql = `
                SELECT 
                    r.id,
                    r.role_name,
                    r.description,
                    COUNT(rp.permission_id) as permission_count,
                    r.created_at,
                    r.updated_at
                FROM roles r
                LEFT JOIN role_permissions rp ON r.id = rp.role_id
                GROUP BY r.id, r.role_name, r.description, r.created_at, r.updated_at
                ORDER BY r.id
            `;
            
            const roles = await db.query(sql);
            
            logger.debug('Retrieved roles with permission counts', {
                count: roles.length
            });
            
            return roles;
        } catch (error) {
            logger.error('Failed to get roles with permission counts', {
                error: error.message
            });
            throw error;
        }
    }

    /**
     * Get detailed role information including all permissions
     * @param {number} roleId - The role ID
     * @returns {Promise<Object>} Role object with permissions array
     */
    async getRoleWithPermissions(roleId) {
        try {
            // Get role details
            const roleRows = await db.query(
                'SELECT * FROM roles WHERE id = ?',
                [roleId]
            );
            
            if (roleRows.length === 0) {
                return null;
            }

            const role = roleRows[0];
            
            // Get permissions
            const permissions = await this.getRolePermissions(roleId);
            
            return {
                ...role,
                permissions
            };
        } catch (error) {
            logger.error('Failed to get role with permissions', {
                error: error.message,
                roleId
            });
            throw error;
        }
    }
}

// Create singleton instance
const rolePermissionsService = new RolePermissionsService();

// Export methods
module.exports = {
    getRolePermissions: (roleId) => rolePermissionsService.getRolePermissions(roleId),
    getAllPermissions: () => rolePermissionsService.getAllPermissions(),
    assignPermissionsToRole: (roleId, permissionIds) => rolePermissionsService.assignPermissionsToRole(roleId, permissionIds),
    removePermissionsFromRole: (roleId, permissionIds) => rolePermissionsService.removePermissionsFromRole(roleId, permissionIds),
    syncRolePermissions: (roleId, permissionIds) => rolePermissionsService.syncRolePermissions(roleId, permissionIds),
    getRolesWithPermissionCounts: () => rolePermissionsService.getRolesWithPermissionCounts(),
    getRoleWithPermissions: (roleId) => rolePermissionsService.getRoleWithPermissions(roleId)
};
