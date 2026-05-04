const db = require('./dbconnection');
const logger = require('./logger');
const { buildSearchClause, validateSortParams, calculatePagination } = require('./helpers');

class BaseService {
    constructor(tableName, primaryKey = 'id', searchColumns = [], sortableColumns = [], options = {}) {
        this.tableName = tableName;
        this.primaryKey = primaryKey;
        this.searchColumns = searchColumns;
        this.sortableColumns = sortableColumns;
        this.options = options;
        this.hasPendingApproval = options.hasPendingApproval !== false;
    }

    async findById(id) {
        try {
            const sql = `SELECT * FROM ${this.tableName} WHERE ${this.primaryKey} = ?`;
            const rows = await db.query(sql, [id]);
            return rows[0] || null;
        } catch (error) {
            logger.error(`Error finding ${this.tableName} by ID`, { id, error: error.message, stack: error.stack });
            throw new Error(`Failed to find ${this.tableName}: ${error.message}`);
        }
    }

    async findByIds(ids) {
        if (!Array.isArray(ids) || ids.length === 0) {
            return [];
        }

        try {
            const placeholders = ids.map(() => '?').join(', ');
            const sql = `SELECT * FROM ${this.tableName} WHERE ${this.primaryKey} IN (${placeholders})`;
            const rows = await db.query(sql, ids);
            return rows;
        } catch (error) {
            logger.error(`Error finding ${this.tableName} by IDs`, { count: ids.length, error: error.message, stack: error.stack });
            throw new Error(`Failed to find ${this.tableName} records: ${error.message}`);
        }
    }

    async list(options = {}) {
        try {
            const { whereClause: searchClause, params: searchParams } = buildSearchClause(this.searchColumns, options.search);
            const { validSortBy, validSortOrder } = validateSortParams(options.sortBy, options.sortOrder, this.sortableColumns);

            // let whereClause = 'WHERE is_deleted = 0 AND has_pending_approval = 0';

            let whereClause = 'WHERE is_deleted = 0';

            if (this.hasPendingApproval) {
                whereClause += ' AND has_pending_approval = 0';
            }


            const params = [];

            if (searchClause) {
                whereClause += searchClause;
                params.push(...searchParams);
            }

            if (options.additionalWhere) {
                whereClause += ` AND ${options.additionalWhere}`;
                params.push(...options.additionalParams);
            }

            const countSql = `SELECT COUNT(*) as total FROM ${this.tableName} ${whereClause}`;
            const countRows = await db.query(countSql, params);
            const total = countRows[0].total;

            const numericLimit = Number(options.limit);
            const numericPage = Number(options.page);
            const offset = (numericPage - 1) * numericLimit;
           


            let dataSql = `SELECT * FROM ${this.tableName} ${whereClause} ORDER BY ${validSortBy} ${validSortOrder}`;

            

            const dataParams = [...params];

             // If limit is null => return ALL data, no pagination
            if (!options.limit) {
                const rows = await db.query(dataSql, dataParams);
                return {
                    data: rows,
                    pagination: null
                };
            }

            if (numericLimit > 0) {
                dataSql += ` LIMIT ${parseInt(numericLimit)} OFFSET ${parseInt(offset)}`;
            }

            const rows = await db.query(dataSql, dataParams);

            logger.info(`Listed ${this.tableName}`, { total, page: numericPage, limit: numericLimit, search: options.search || 'none' });

            return {
                data: rows,
                pagination: calculatePagination(total, numericPage, numericLimit)
            };
        } catch (error) {
            logger.error(`Error listing ${this.tableName}`, { error: error.message, stack: error.stack });
            throw new Error(`Failed to list ${this.tableName}: ${error.message}`);
        }
    }

    async create(data, createdBy = null, connection = null) {
        try {
            const fields = Object.keys(data);
            const values = Object.values(data);
            const placeholders = fields.map(() => '?').join(', ');

            const sql = `
                INSERT INTO ${this.tableName} 
                (${fields.join(', ')}, created_by, created_at, updated_at)
                VALUES (${placeholders}, ?, NOW(), NOW())
            `;

            const exec = connection ? connection.query.bind(connection) : db.query.bind(db);
            const result = await exec(sql, [...values, createdBy]);

            logger.info(`Created ${this.tableName}`, { id: result.insertId, createdBy });

            return result.insertId;
        } catch (error) {
            logger.error(`Error creating ${this.tableName}`, { data, error: error.message, stack: error.stack });
            throw new Error(`Failed to create ${this.tableName}: ${error.message}`);
        }
    }

    async update(id, updates, updatedBy = null, connection = null) {
        try {
            const fields = [];
            const values = [];

            for (const [key, value] of Object.entries(updates)) {
                if (value !== undefined) {
                    fields.push(`${key} = ?`);
                    values.push(value);
                }
            }

            if (fields.length === 0) {
                logger.warn(`No fields to update for ${this.tableName}`, { id });
                return 0;
            }

            fields.push('updated_by = ?', 'updated_at = NOW()');
            values.push(updatedBy, id);

            const sql = `UPDATE ${this.tableName} SET ${fields.join(', ')} WHERE ${this.primaryKey} = ?`;

            const exec = connection ? connection.query.bind(connection) : db.query.bind(db);
            const result = await exec(sql, values);

            logger.info(`Updated ${this.tableName}`, { id, affectedRows: result.affectedRows, updatedBy });

            return result.affectedRows;
        } catch (error) {
            logger.error(`Error updating ${this.tableName}`, { id, updates, error: error.message, stack: error.stack });
            throw new Error(`Failed to update ${this.tableName}: ${error.message}`);
        }
    }

    async softDelete(ids, deletedBy = null, connection = null) {
        if (!Array.isArray(ids) || ids.length === 0) {
            return 0;
        }

        try {
            const placeholders = ids.map(() => '?').join(', ');
            const sql = `
                UPDATE ${this.tableName}
                SET is_deleted = 1, updated_by = ?, updated_at = NOW()
                WHERE ${this.primaryKey} IN (${placeholders})
            `;

            const exec = connection ? connection.query.bind(connection) : db.query.bind(db);
            const result = await exec(sql, [deletedBy, ...ids]);

            logger.info(`Soft deleted ${this.tableName}`, { count: result.affectedRows, deletedBy });

            return result.affectedRows;
        } catch (error) {
            logger.error(`Error soft deleting ${this.tableName}`, { count: ids.length, error: error.message, stack: error.stack });
            throw new Error(`Failed to soft delete ${this.tableName}: ${error.message}`);
        }
    }

    async hardDelete(id, connection = null) {
        try {
            const sql = `DELETE FROM ${this.tableName} WHERE ${this.primaryKey} = ?`;

            const exec = connection ? connection.query.bind(connection) : db.query.bind(db);
            const result = await exec(sql, [id]);

            logger.warn(`Hard deleted ${this.tableName}`, { id, affectedRows: result.affectedRows });

            return result.affectedRows;
        } catch (error) {
            logger.error(`Error hard deleting ${this.tableName}`, {
                id,
                error: error.message,
                stack: error.stack
            });
            throw new Error(`Failed to hard delete ${this.tableName}: ${error.message}`);
        }
    }

    async exists(id) {
        try {
            const sql = `SELECT 1 FROM ${this.tableName} WHERE ${this.primaryKey} = ? LIMIT 1`;
            const rows = await db.query(sql, [id]);

            return rows.length > 0;
        } catch (error) {
            logger.error(`Error checking existence in ${this.tableName}`, {
                id,
                error: error.message
            });
            throw new Error(`Failed to check ${this.tableName} existence: ${error.message}`);
        }
    }

    async count(whereClause = '', params = []) {
        try {
            let sql = `SELECT COUNT(*) as total FROM ${this.tableName}`;

            if (whereClause) {
                sql += ` WHERE ${whereClause}`;
            }

            const rows = await db.query(sql, params);
            return rows[0].total;
        } catch (error) {
            logger.error(`Error counting ${this.tableName}`, {
                error: error.message
            });
            throw new Error(`Failed to count ${this.tableName}: ${error.message}`);
        }
    }
}

module.exports = BaseService;
