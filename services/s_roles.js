const db = require('../lib/dbconnection');
const BaseService = require('../lib/baseService');
const logger = require('../lib/logger');

/**
 * Service layer for roles management
 * Extends BaseService for standard CRUD operations
 */
class RolesService extends BaseService {
    constructor() {
        // super('roles');
        super('roles', 'id', [], [], { hasPendingApproval: false });

    }

    async createRole(role, createdBy = null, connection = null) {
        try {
            const sql = `
                INSERT INTO roles (role_name, description, created_at, updated_at)
                VALUES (?, ?, NOW(), NOW())
            `;
            const params = [role.role_name, role.description || null];
            
            const result = await db.query(sql, params);
            
            logger.info('Role created successfully', {
                roleId: result.insertId,
                roleName: role.role_name,
                createdBy
            });
            
            return result.insertId;
        } catch (error) {
            logger.error('Failed to create role', {
                error: error.message,
                roleData: role,
                createdBy
            });
            throw error;
        }
    }

    async getRole(id, connection = null) {
        try {
            const rows = await db.query(
                'SELECT * FROM roles WHERE id = ?',
                [id]
            );
            
            if (rows.length === 0) {
                return null;
            }
            
            const role = rows[0];
            
            // Get permissions for this role
            const permissions = await db.query(
                `SELECT p.id, p.name, p.description 
                 FROM permissions p
                 INNER JOIN role_permissions rp ON p.id = rp.permission_id
                 WHERE rp.role_id = ?
                 ORDER BY p.name`,
                [id]
            );
            
            role.permissions = permissions;
            
            return role;
        } catch (error) {
            logger.error('Failed to get role', {
                error: error.message,
                roleId: id
            });
            throw error;
        }
    }

    async updateRole(id, updates, updatedBy = null, connection = null) {
        try {
            const fields = [];
            const values = [];
            
            Object.entries(updates).forEach(([key, value]) => {
                if (value !== undefined) {
                    fields.push(`${key} = ?`);
                    values.push(value);
                }
            });
            
            if (fields.length === 0) {
                logger.warn('No valid fields to update', {
                    roleId: id,
                    updates,
                    updatedBy
                });
                return 0;
            }
            
            const sql = `
                UPDATE roles 
                SET ${fields.join(', ')}, updated_at = NOW() 
                WHERE id = ?
            `;
            values.push(id);
            
            const result = await db.query(sql, values);
            
            if (result.affectedRows > 0) {
                logger.info('Role updated successfully', {
                    roleId: id,
                    updatedFields: Object.keys(updates),
                    updatedBy
                });
            }
            
            return result.affectedRows;
        } catch (error) {
            logger.error('Failed to update role', {
                error: error.message,
                roleId: id,
                updates,
                updatedBy
            });
            throw error;
        }
    }

    async deleteRole(id, deletedBy = null, connection = null) {
        try {
            const result = await db.query('DELETE FROM roles WHERE id = ?', [id]);
            
            if (result.affectedRows > 0) {
                logger.info('Role deleted successfully', {
                    roleId: id,
                    deletedBy
                });
            }
            
            return result.affectedRows;
        } catch (error) {
            logger.error('Failed to delete role', {
                error: error.message,
                roleId: id,
                deletedBy
            });
            throw error;
        }
    }

    async listRoles(options = {}, connection = null) {
        try {
            const {
                page = 1,
                limit = 0,
                search = '',
                sortBy = 'id',
                sortOrder = 'DESC'
            } = options;

            const validSortColumns = ['id', 'role_name', 'description', 'created_at', 'updated_at'];
            
            // Use BaseService.list() directly with validation
            const result = await this.list({
                page,
                limit,
                search,
                sortBy: validSortColumns.includes(sortBy) ? sortBy : 'id',
                sortOrder: sortOrder.toUpperCase() === 'ASC' ? 'ASC' : 'DESC'
            }, connection);

            logger.debug('Roles listed successfully', {
                total: result.pagination?.total ?? result.data.length,
                page: result.pagination?.page ?? null,
                returned: result.data.length,
                search,
                limit
            });

            return result;
        } catch (error) {
            logger.error('Failed to list roles', {
                error: error.message,
                options
            });
            throw error;
        }
    }

    async checkRoleNameExists(name, excludeId = null, connection = null) {
        try {
            let sql = 'SELECT id FROM roles WHERE role_name = ?';
            const params = [name];
            
            if (excludeId) {
                sql += ' AND id != ?';
                params.push(excludeId);
            }
            
            const rows = await db.query(sql, params);
            return rows.length > 0;
        } catch (error) {
            logger.error('Failed to check role name existence', {
                error: error.message,
                name,
                excludeId
            });
            throw error;
        }
    }
}

// Create singleton instance
const rolesService = new RolesService();

// Export methods for backward compatibility
module.exports = {
    createRole: (role, createdBy, connection) => rolesService.createRole(role, createdBy, connection),
    getRole: (id, connection) => rolesService.getRole(id, connection),
    updateRole: (id, updates, updatedBy, connection) => rolesService.updateRole(id, updates, updatedBy, connection),
    deleteRole: (id, deletedBy, connection) => rolesService.deleteRole(id, deletedBy, connection),
    listRoles: (options, connection) => rolesService.listRoles(options, connection),
    checkRoleNameExists: (name, excludeId, connection) => rolesService.checkRoleNameExists(name, excludeId, connection)
};
