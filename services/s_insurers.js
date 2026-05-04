const db = require('../lib/dbconnection');
const BaseService = require('../lib/baseService');
const logger = require('../lib/logger');
const { generateCustomCode } = require('../lib/generateCode');

/**
 * Service layer for insurers management
 * Extends BaseService for standard CRUD operations
 */
class InsurersService extends BaseService {
    constructor() {
        super('insurers', 'id',
              ['insurer_code', 'insurer_name', 'short_code', 'insurer_type', 'contact_number', 'email'],
              ['id', 'insurer_code', 'insurer_name', 'short_code', 'insurer_type', 'contact_number', 'email', 'is_active', 'created_at']);
    }

    async createInsurer(row, createdBy = null, connection = null) {
        try {
            logger.info('Creating insurer', { insurerName: row.insurer_name, createdBy });

            if (!row.insurer_code) {
                row.insurer_code = await generateCustomCode({ prefix: 'INS', table: 'insurers', column: 'insurer_code' });
            }

            // Ensure short_code is not empty (unique index forbids '')
            const shortCode = (row.short_code || '').trim() || row.insurer_code;

            const sql = `
                INSERT INTO insurers (
                    insurer_code, insurer_name, short_code, insurer_type, contact_number, email, 
                    is_active, created_by, created_at, updated_at
                ) 
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, NOW(), NOW())
            `;
            const params = [
                row.insurer_code,
                row.insurer_name,
                shortCode,
                row.insurer_type || 'Life',
                row.contact_number || null,
                row.email || null,
                row.is_active ?? 1,
                createdBy || row.created_by || null
            ];

            const exec = connection ? connection.query.bind(connection) : db.query.bind(db);
            const result = await exec(sql, params);
            
            logger.info('Insurer created successfully', {
                insurerId: result.insertId,
                insurerCode: row.insurer_code,
                insurerName: row.insurer_name,
                createdBy
            });

            return result.insertId;
        } catch (error) {
            logger.error('Failed to create insurer', {
                error: error.message,
                stack: error.stack,
                insurerData: row,
                createdBy
            });
            throw new Error(`Failed to create insurer: ${error.message}`);
        }
    }

    async updateInsurer(id, updates, updatedBy = null) {
        try {
            logger.info('Updating insurer', { insurerId: id, updatedFields: Object.keys(updates), updatedBy });

            const fields = [];
            const values = [];

            Object.entries(updates).forEach(([k, v]) => {
                if (v !== undefined) {
                    fields.push(`${k} = ?`);
                    values.push(v);
                }
            });

            if (!fields.length) {
                logger.warn('No valid fields to update for insurer', { insurerId: id, updates });
                return 0;
            }

            fields.push('updated_by = ?', 'updated_at = NOW()');
            values.push(updatedBy, id);

            const sql = `
                UPDATE insurers 
                SET ${fields.join(', ')}
                WHERE id = ?
            `;
            const result = await db.query(sql, values);
            
            logger.info('Insurer updated successfully', {
                insurerId: id,
                affectedRows: result.affectedRows,
                updatedFields: Object.keys(updates),
                updatedBy
            });

            return result.affectedRows;
        } catch (error) {
            logger.error('Failed to update insurer', {
                error: error.message,
                stack: error.stack,
                insurerId: id,
                updates,
                updatedBy
            });
            throw new Error(`Failed to update insurer: ${error.message}`);
        }
    }

    async softDeleteInsurer(ids, deletedBy = null) {
        try {
            logger.info('Soft deleting insurers', { insurerIds: ids, deletedBy });

            if (!Array.isArray(ids) || ids.length === 0) {
                return 0;
            }

            const placeholders = ids.map(() => '?').join(', ');
            const sql = `
                UPDATE insurers 
                SET is_deleted = 1, updated_by = ?, updated_at = NOW()
                WHERE id IN (${placeholders})
            `;
            const result = await db.query(sql, [deletedBy, ...ids]);
            
            logger.info('Insurers soft deleted successfully', {
                insurerIds: ids,
                affectedRows: result.affectedRows,
                deletedBy
            });

            return result.affectedRows;
        } catch (error) {
            logger.error('Failed to soft delete insurers', {
                error: error.message,
                stack: error.stack,
                insurerIds: ids,
                deletedBy
            });
            throw new Error(`Failed to soft delete insurers: ${error.message}`);
        }
    }

    async deleteInsurer(id) {
        try {
            logger.info('Deleting insurer', { insurerId: id });

            const result = await db.query('DELETE FROM insurers WHERE id = ?', [id]);
            
            logger.info('Insurer deleted successfully', {
                insurerId: id,
                affectedRows: result.affectedRows
            });

            return result.affectedRows;
        } catch (error) {
            logger.error('Failed to delete insurer', {
                error: error.message,
                stack: error.stack,
                insurerId: id
            });
            throw new Error(`Failed to delete insurer: ${error.message}`);
        }
    }

    async getInsurer(id) {
        try {
            const rows = await db.query('SELECT * FROM insurers WHERE id = ?', [id]);
            return rows.length > 0 ? rows[0] : null;
        } catch (error) {
            logger.error('Failed to get insurer', {
                error: error.message,
                stack: error.stack,
                insurerId: id
            });
            throw new Error(`Failed to get insurer: ${error.message}`);
        }
    }

    async getInsurersByIds(ids) {
        try {
            if (!Array.isArray(ids) || ids.length === 0) {
                return [];
            }

            const placeholders = ids.map(() => '?').join(', ');
            const sql = `SELECT * FROM insurers WHERE id IN (${placeholders})`;
            const rows = await db.query(sql, ids);
            return rows;
        } catch (error) {
            logger.error('Failed to get insurers by IDs', {
                error: error.message,
                stack: error.stack,
                insurerIds: ids
            });
            throw new Error(`Failed to get insurers: ${error.message}`);
        }
    }

    async listInsurers(options = {}) {
        try {
            const {
                page = 1,
                limit = 0,
                search = '',
                sortBy = 'id',
                sortOrder = 'DESC'
            } = options;

            const validSortColumns = [
                'id', 'insurer_code', 'insurer_name', 'short_code', 'insurer_type',
                'contact_number', 'email', 'is_active', 'created_at'
            ];

            // Use BaseService.list() directly with validation
            const result = await this.list({
                page,
                limit,
                search,
                sortBy: validSortColumns.includes(sortBy) ? sortBy : 'id',
                sortOrder: sortOrder.toUpperCase() === 'ASC' ? 'ASC' : 'DESC'
            });

            logger.debug('Insurers listed successfully', {
                total: result.pagination?.total ?? result.data.length,
                page: result.pagination?.page ?? null,
                returned: result.data.length,
                search,
                limit
            });

            return result;
        } catch (error) {
            logger.error('Failed to list insurers', {
                error: error.message,
                stack: error.stack,
                options
            });
            throw new Error(`Failed to list insurers: ${error.message}`);
        }
    }
}

// Create and export service instance
const insurersService = new InsurersService();

// Export both instance and class for flexibility
module.exports = {
    InsurersService,
    insurersService,
    // Backward compatibility - export methods bound to instance
    createInsurer: insurersService.createInsurer.bind(insurersService),
    updateInsurer: insurersService.updateInsurer.bind(insurersService),
    softDeleteInsurer: insurersService.softDeleteInsurer.bind(insurersService),
    deleteInsurer: insurersService.deleteInsurer.bind(insurersService),
    getInsurer: insurersService.getInsurer.bind(insurersService),
    getInsurersByIds: insurersService.getInsurersByIds.bind(insurersService),
    listInsurers: insurersService.listInsurers.bind(insurersService),
};
