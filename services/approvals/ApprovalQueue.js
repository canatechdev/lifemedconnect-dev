/**
 * Approval Queue
 * Manages approval queue operations (create, fetch, update)
 */

const db = require('../../lib/dbconnection');
const logger = require('../../lib/logger');
const { APPROVAL_STATUS, DEFAULT_PRIORITY } = require('./config/approvalRules');
const { getEntityTable } = require('./config/entityConfig');

class ApprovalQueue {
    /**
     * Create a new approval request
     * @param {Object} approvalData - Approval request data
     * @param {Object} connection - Optional database connection
     * @returns {Promise<number>} Approval queue ID
     */
    async createApprovalRequest(approvalData, connection = null) {
        const {
            entity_type,
            entity_id,
            action_type,
            old_data = null,
            new_data,
            changes_summary = '',
            requested_by,
            notes = '',
            priority = DEFAULT_PRIORITY
        } = approvalData;

        const query = `
            INSERT INTO approval_queue 
            (entity_type, entity_id, action_type, old_data, new_data, changes_summary, requested_by, notes, priority, status)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending')
        `;

        const exec = connection ? connection.execute.bind(connection) : db.query.bind(db);
        const result = await exec(query, [
            entity_type,
            entity_id || null,
            action_type,
            old_data ? JSON.stringify(old_data) : null,
            JSON.stringify(new_data),
            changes_summary || '',
            requested_by,
            notes || '',
            priority || DEFAULT_PRIORITY
        ]);

        // Update the entity's pending approval flag
        await this.updateEntityPendingFlag(entity_type, entity_id, 1, connection || null);

        logger.info('Approval request created', {
            approvalId: result.insertId,
            entity_type,
            entity_id,
            action_type,
            requested_by
        });

        return result.insertId;
    }

    /**
     * Get all pending approvals
     * @param {Object} filters - Filter options
     * @returns {Promise<Array>} List of pending approvals
     */
    async getPendingApprovals(filters = {}) {
        const { entity_type, priority, requested_by, limit = 100, offset = 0 } = filters;

        // Use latest pending row per entity (no window functions to stay MySQL 5.7 compatible)
        let query = `
            SELECT 
                aq.*,
                u.full_name AS requested_by_name,
                u.email AS requested_by_email,
                r.role_name AS requested_by_role,
                (
                    CASE 
                        WHEN aq.entity_type = 'client' THEN (SELECT client_name FROM clients WHERE id = aq.entity_id)
                        WHEN aq.entity_type = 'center' THEN (SELECT center_name FROM diagnostic_centers WHERE id = aq.entity_id)
                        WHEN aq.entity_type = 'doctor' THEN (SELECT doctor_name FROM doctors WHERE id = aq.entity_id)
                        WHEN aq.entity_type = 'insurer' THEN (SELECT insurer_name FROM insurers WHERE id = aq.entity_id)
                        WHEN aq.entity_type = 'appointment' THEN (SELECT case_number FROM appointments WHERE id = aq.entity_id)
                        WHEN aq.entity_type = 'test' THEN (SELECT test_name FROM tests WHERE id = aq.entity_id)
                        WHEN aq.entity_type = 'test_rate' THEN (SELECT CONCAT(item_name, ' (', (SELECT client_name FROM clients WHERE id = bulk_test_rates.client_id), ')') FROM bulk_test_rates WHERE id = aq.entity_id)
                        ELSE 'N/A'
                    END
                ) AS entity_name
            FROM approval_queue aq
            INNER JOIN (
                SELECT 
                    entity_type,
                    COALESCE(entity_id, -1) AS entity_id_key,
                    MAX(requested_at) AS max_requested_at
                FROM approval_queue
                WHERE status = 'pending'
                GROUP BY entity_type, COALESCE(entity_id, -1)
            ) latest ON latest.entity_type = aq.entity_type 
                    AND latest.entity_id_key = COALESCE(aq.entity_id, -1)
                    AND latest.max_requested_at = aq.requested_at
            LEFT JOIN users u ON aq.requested_by = u.id
            LEFT JOIN roles r ON u.role_id = r.id
            WHERE aq.status = 'pending'
        `;

        const params = [];

        if (entity_type) {
            query += ' AND aq.entity_type = ?';
            params.push(entity_type);
        }

        if (priority) {
            query += ' AND aq.priority = ?';
            params.push(priority);
        }

        if (requested_by) {
            query += ' AND aq.requested_by = ?';
            params.push(requested_by);
        }

        query += `
            ORDER BY aq.requested_at DESC, aq.id DESC
            LIMIT ${parseInt(limit)} OFFSET ${parseInt(offset)}
        `;

        const rows = await db.query(query, params);

        return rows.map(row => {
            const oldData = row.old_data
                ? typeof row.old_data === 'string'
                    ? JSON.parse(row.old_data)
                    : row.old_data
                : null;
            const newData = row.new_data
                ? typeof row.new_data === 'string'
                    ? JSON.parse(row.new_data)
                    : row.new_data
                : null;
            
            // Skip filtering for bulk operations (old_data is array, new_data is object)
            // Bulk operations should show all new_data fields, not just changed ones
            const isBulkOperation = Array.isArray(oldData) && newData && typeof newData === 'object';
            
            if (isBulkOperation) {
                return {
                    ...row,
                    old_data: oldData,
                    new_data: newData
                };
            }
            
            // For single-record operations, filter to only include changed fields
            const { getChangedFields } = require('./utils/changeDetector');
            const changedFields = oldData && newData ? getChangedFields(oldData, newData) : null;
            
            const parsed = {
                ...row,
                old_data: changedFields || oldData,
                new_data: changedFields 
                    ? Object.fromEntries(Object.entries(newData).filter(([k]) => changedFields.hasOwnProperty(k)))
                    : newData
            };

            // For bulk test_rate updates, enhance entity_name
            if (row.entity_type === 'test_rate' && row.action_type === 'bulk_update' &&
                Array.isArray(parsed.old_data) && parsed.old_data.length > 0) {
                const clientName = parsed.old_data[0].client_name || 'Unknown Client';
                const count = parsed.old_data.length;
                parsed.entity_name = `${clientName} (${count} test rate${count > 1 ? 's' : ''})`;
            }

            return parsed;
        });
    }

    /**
     * Get approval by ID
     * @param {number} approvalId - Approval queue ID
     * @returns {Promise<Object|null>} Approval details or null
     */
    async getApprovalById(approvalId) {
        const query = `
            SELECT 
                aq.*,
                u1.full_name AS requested_by_name,
                u1.email AS requested_by_email,
                r1.role_name AS requested_by_role,
                u2.full_name AS reviewed_by_name,
                u2.email AS reviewed_by_email
            FROM approval_queue aq
            LEFT JOIN users u1 ON aq.requested_by = u1.id
            LEFT JOIN roles r1 ON u1.role_id = r1.id
            LEFT JOIN users u2 ON aq.reviewed_by = u2.id
            WHERE aq.id = ?
        `;

        const rows = await db.query(query, [approvalId]);

        if (!rows || rows.length === 0) {
            return null;
        }

        const approval = rows[0];
        const oldData = approval.old_data 
            ? (typeof approval.old_data === 'string' ? JSON.parse(approval.old_data) : approval.old_data) 
            : null;
        const newData = approval.new_data 
            ? (typeof approval.new_data === 'string' ? JSON.parse(approval.new_data) : approval.new_data) 
            : null;
        
        // Skip filtering for bulk operations (old_data is array, new_data is object)
        // Bulk operations should show all new_data fields, not just changed ones
        const isBulkOperation = Array.isArray(oldData) && newData && typeof newData === 'object';
        
        if (isBulkOperation) {
            return {
                ...approval,
                old_data: oldData,
                new_data: newData
            };
        }
        
        // For single-record operations, filter to only include changed fields
        const { getChangedFields } = require('./utils/changeDetector');
        const changedFields = oldData && newData ? getChangedFields(oldData, newData) : null;
        
        return {
            ...approval,
            old_data: changedFields || oldData,
            new_data: changedFields 
                ? Object.fromEntries(Object.entries(newData).filter(([k]) => changedFields.hasOwnProperty(k)))
                : newData
        };
    }

    /**
     * Update approval status
     * @param {number} approvalId - Approval queue ID
     * @param {string} status - New status
     * @param {number} reviewedBy - Reviewer user ID
     * @param {string} rejectionReason - Optional rejection reason
     * @param {Object} connection - Optional database connection
     * @returns {Promise<boolean>} Success status
     */
    async updateApprovalStatus(approvalId, status, reviewedBy, rejectionReason = null, connection = null) {
        const query = `
            UPDATE approval_queue 
            SET status = ?, 
                reviewed_by = ?, 
                reviewed_at = NOW(),
                rejection_reason = ?
            WHERE id = ? AND status = 'pending'
        `;

        const exec = connection ? connection.execute.bind(connection) : db.query.bind(db);
        const result = await exec(query, [status, reviewedBy, rejectionReason, approvalId]);

        if (!result || result.affectedRows === 0) {
            throw new Error('Approval already processed');
        }

        logger.info('Approval status updated', { approvalId, status, reviewedBy });
        return true;
    }

    /**
     * Get approval statistics
     * @returns {Promise<Array>} Statistics by status and entity type
     */
    async getApprovalStats() {
        const query = `
            SELECT 
                status,
                COUNT(*) as count,
                entity_type
            FROM approval_queue
            GROUP BY status, entity_type
        `;

        const rows = await db.query(query);
        return rows;
    }

    /**
     * Get user's pending requests
     * @param {number} userId - User ID
     * @param {string} status - Status filter (pending, approved, rejected, all)
     * @param {number} limit - Limit
     * @param {number} offset - Offset
     * @returns {Promise<Object>} Data and total count
     */
    async getUserPendingRequests(userId, status = 'pending', limit = 10, offset = 0) {
        let whereClause = 'aq.requested_by = ?';
        let params = [userId];

        if (status !== 'all') {
            whereClause += ' AND aq.status = ?';
            params.push(status);
        } else {
            whereClause += ' AND aq.status IN ("pending","approved","rejected")';
        }

        // Count query
        const countQuery = `SELECT COUNT(*) as total FROM approval_queue aq WHERE ${whereClause}`;
        const countResult = await db.query(countQuery, params);
        const total = countResult[0]?.total || 0;

        // Data query
        const dataQuery = `
            SELECT 
                aq.*,
                CASE 
                    WHEN aq.entity_type = 'client' THEN (SELECT client_name FROM clients WHERE id = aq.entity_id)
                    WHEN aq.entity_type = 'center' THEN (SELECT center_name FROM diagnostic_centers WHERE id = aq.entity_id)
                    WHEN aq.entity_type = 'doctor' THEN (SELECT doctor_name FROM doctors WHERE id = aq.entity_id)
                    WHEN aq.entity_type = 'insurer' THEN (SELECT insurer_name FROM insurers WHERE id = aq.entity_id)
                    WHEN aq.entity_type = 'appointment' THEN (SELECT case_number FROM appointments WHERE id = aq.entity_id)
                    ELSE 'N/A'
                END AS entity_name
            FROM approval_queue aq
            WHERE ${whereClause}
            ORDER BY aq.requested_at DESC
            LIMIT ${parseInt(limit)} OFFSET ${parseInt(offset)}
        `;

        const rows = await db.query(dataQuery, params);

        const data = rows.map(row => ({
            ...row,
            old_data: row.old_data ? (typeof row.old_data === 'string' ? JSON.parse(row.old_data) : row.old_data) : null,
            new_data: row.new_data ? (typeof row.new_data === 'string' ? JSON.parse(row.new_data) : row.new_data) : null
        }));

        return { data, total };
    }

    /**
     * Update entity's pending approval flag
     * @param {string} entityType - Entity type
     * @param {number} entityId - Entity ID
     * @param {number} flag - Flag value (0 or 1)
     * @param {Object} connection - Optional database connection
     * @returns {Promise<void>}
     */
    async updateEntityPendingFlag(entityType, entityId, flag, connection = null) {
        const table = getEntityTable(entityType);
        if (!table || !entityId) {
            return; // Skip if table doesn't support this flag or entity_id is null
        }

        const query = `UPDATE ${table} SET has_pending_approval = ? WHERE id = ?`;

        if (connection) {
            await connection.execute(query, [flag, entityId]);
        } else {
            await db.query(query, [flag, entityId]);
        }
    }

    /**
     * Delete temporary entity (for rejected CREATE actions)
     * @param {string} entityType - Entity type
     * @param {number} entityId - Entity ID
     * @returns {Promise<void>}
     */
    async deleteTemporaryEntity(entityType, entityId) {
        const table = getEntityTable(entityType);
        if (!table) {
            throw new Error(`Unknown entity type: ${entityType}`);
        }

        // Hard delete the temporary entity
        await db.execute(`DELETE FROM ${table} WHERE id = ?`, [entityId]);
        logger.info('Temporary entity deleted', { entityType, entityId });
    }
}

module.exports = ApprovalQueue;
