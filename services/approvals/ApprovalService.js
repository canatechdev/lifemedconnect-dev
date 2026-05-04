/**
 * Approval Service
 * Main orchestrator for approval operations
 */

const db = require('../../lib/dbconnection');
const logger = require('../../lib/logger');
const ApprovalQueue = require('./ApprovalQueue');
const { getHandler } = require('./handlers');
const coreAppointments = require('../appointments');
const { getEntityTable, getDisallowedFields, getFieldTypeHints, GLOBAL_DISALLOWED_FIELDS } = require('./config/entityConfig');
const { normalizeValue } = require('./utils/normalizers');
const { ACTION_TYPES } = require('./config/approvalRules');

class ApprovalService {
    constructor() {
        this.queue = new ApprovalQueue();
    }

    /**
     * Approve a request and apply changes
     * @param {number} approvalId - Approval queue ID
     * @param {number} reviewedBy - Super Admin user ID
     * @returns {Promise<boolean>} Success status
     */
    async approveRequest(approvalId, reviewedBy) {
        const approval = await this.queue.getApprovalById(approvalId);

        if (!approval) {
            throw new Error('Approval request not found');
        }

        
        if (approval.status !== 'pending') {
            throw new Error(`Approval already ${approval.status}`);
        }

        // Start transaction
        const connection = await db.getConnection();
        await connection.beginTransaction();

        try {
            // Update approval status with idempotent guard
            const [updateResult] = await connection.execute(
                `UPDATE approval_queue 
                 SET status = 'approved', reviewed_by = ?, reviewed_at = NOW() 
                 WHERE id = ? AND status = 'pending'`,
                [reviewedBy, approvalId]
            );

            if (!updateResult || updateResult.affectedRows === 0) {
                throw new Error('Approval already processed');
            }

            // Apply the changes to the actual entity
            logger.info('Applying approved changes', {
                approvalId,
                entity_type: approval.entity_type,
                entity_id: approval.entity_id,
                action_type: approval.action_type,
                new_data_keys: approval.new_data ? Object.keys(approval.new_data) : [],
                has_medical_status: !!approval.new_data?.medical_status
            });

            await this.applyApprovedChanges(connection, approval, { reviewedBy });

            // Clear pending approval flag
            await this.queue.updateEntityPendingFlag(approval.entity_type, approval.entity_id, 0, connection);

            // Close any older pending requests for the same entity to avoid stale duplicates
            await connection.execute(
                `UPDATE approval_queue 
                 SET status = 'rejected', reviewed_by = ?, reviewed_at = NOW(), rejection_reason = 'Superseded by newer approval'
                 WHERE entity_type = ? AND entity_id <=> ? AND status = 'pending' AND id <> ?`,
                [reviewedBy, approval.entity_type, approval.entity_id, approvalId]
            );

            await connection.commit();

            logger.info('Approval request approved', {
                approvalId,
                entity_type: approval.entity_type,
                entity_id: approval.entity_id,
                reviewed_by: reviewedBy
            });

            return true;
        } catch (error) {
            await connection.rollback();
            logger.error('Error approving request', { approvalId, error: error.message });
            throw error;
        } finally {
            connection.release();
        }
    }

    /**
     * Reject a request
     * @param {number} approvalId - Approval queue ID
     * @param {number} reviewedBy - Super Admin user ID
     * @param {string} rejectionReason - Reason for rejection
     * @returns {Promise<boolean>} Success status
     */
    async rejectRequest(approvalId, reviewedBy, rejectionReason) {
        const approval = await this.queue.getApprovalById(approvalId);

        if (!approval) {
            throw new Error('Approval request not found');
        }

        if (approval.status !== 'pending') {
            throw new Error(`Approval already ${approval.status}`);
        }

        await this.queue.updateApprovalStatus(approvalId, 'rejected', reviewedBy, rejectionReason);

        // Clear pending approval flag
        await this.queue.updateEntityPendingFlag(approval.entity_type, approval.entity_id, 0);

        // If it was a CREATE action, delete the temporary entity
        if (approval.action_type === ACTION_TYPES.CREATE) {
            await this.queue.deleteTemporaryEntity(approval.entity_type, approval.entity_id);
        }

        logger.info('Approval request rejected', {
            approvalId,
            entity_type: approval.entity_type,
            entity_id: approval.entity_id,
            reviewed_by: reviewedBy,
            reason: rejectionReason
        });

        return true;
    }

    /**
     * Apply approved changes to the actual entity
     * @param {Object} connection - Database connection
     * @param {Object} approval - Approval object
     * @returns {Promise<void>}
     */
    async applyApprovedChanges(connection, approval, context = {}) {
        const { entity_type, entity_id, action_type, new_data, old_data } = approval;

        // Get entity handler if available
        const handler = getHandler(entity_type);

        // Special handling: appointment reschedule must go through rescheduleAppointment
        logger.info('Reschedule condition check', {
            entity_type,
            has_medical_status: !!new_data?.medical_status,
            medical_status: new_data?.medical_status,
            has_confirmed_date: !!new_data?.confirmed_date,
            confirmed_date: new_data?.confirmed_date,
            has_confirmed_time: !!new_data?.confirmed_time,
            confirmed_time: new_data?.confirmed_time,
            condition_met: entity_type === 'appointment' && new_data?.medical_status === 'rescheduled' && new_data?.confirmed_date && new_data?.confirmed_time
        });

        if (entity_type === 'appointment' && new_data?.medical_status === 'rescheduled' && new_data?.confirmed_date && new_data?.confirmed_time) {
            // Extract actorContext if it was stored in the approval request
            let actorContext = new_data._actorContext || null;

            // Fallback: infer actorContext from requesting user's center/technician when missing
            if (!actorContext && approval.requested_by) {
                try {
                    const [users] = await connection.query('SELECT center_id, diagnostic_center_id, technician_id FROM users WHERE id = ?', [approval.requested_by]);
                    if (users && users[0]) {
                        const centerId = users[0].center_id || users[0].diagnostic_center_id || null;
                        const technicianId = users[0].technician_id || null;
                        actorContext = centerId
                            ? { centerId, type: 'center' }
                            : (technicianId ? { technicianId, type: 'technician' } : null);
                    }
                } catch (e) {
                    // leave actorContext null if lookup fails
                }
            }

            // Final fallback: infer from appointment data for Both
            if (!actorContext) {
                try {
                    const [apptRows] = await connection.query('SELECT visit_type, center_id, other_center_id FROM appointments WHERE id = ?', [entity_id]);
                    if (apptRows && apptRows[0] && apptRows[0].visit_type === 'Both') {
                        const appt = apptRows[0];
                        
                        // Check which side the requesting user manages
                        const [userRows] = await connection.query('SELECT center_id, diagnostic_center_id, technician_id FROM users WHERE id = ?', [approval.requested_by]);
                        if (userRows && userRows[0]) {
                            const userCenterId = userRows[0].center_id || userRows[0].diagnostic_center_id;
                            const isTechnician = !!userRows[0].technician_id;
                            
                            if (isTechnician) {
                                actorContext = { centerId: appt.other_center_id, type: 'technician' };
                            } else if (userCenterId) {
                                if (userCenterId === appt.center_id) {
                                    actorContext = { centerId: appt.center_id, type: 'center' };
                                } else if (userCenterId === appt.other_center_id) {
                                    actorContext = { centerId: appt.other_center_id, type: 'technician' };
                                } else {
                                    actorContext = { centerId: appt.center_id, type: 'center' };
                                }
                            } else {
                                actorContext = { centerId: appt.center_id, type: 'center' };
                            }
                        } else {
                            actorContext = { centerId: appt.center_id, type: 'center' };
                        }
                    }
                } catch (e) {
                    // leave null if lookup fails
                }
            }

            logger.info('applyApprovedChanges: appointment reschedule detected - delegating to rescheduleAppointment', {
                entity_id,
                confirmed_date: new_data.confirmed_date,
                confirmed_time: new_data.confirmed_time,
                reschedule_reason: new_data.reschedule_reason,
                actorContext: actorContext
            });

            await coreAppointments.rescheduleAppointment(
                entity_id,
                new_data.confirmed_date,
                new_data.confirmed_time,
                new_data.reschedule_reason || null,
                context.reviewedBy || approval.requested_by || null,
                actorContext
            );

            return;
        }
        
        // Special handling: appointment medical_status updates must go through core flow to update tests/statuses
        if (entity_type === 'appointment' && new_data?.medical_status) {
            // Extract actorContext if it was stored in the approval request
            let actorContext = new_data._actorContext || null;

            // Fallback: infer actorContext from requesting user's center/technician when missing
            if (!actorContext && approval.requested_by) {
                try {
                    const [users] = await connection.query('SELECT center_id, diagnostic_center_id, technician_id FROM users WHERE id = ?', [approval.requested_by]);
                    if (users && users[0]) {
                        const centerId = users[0].center_id || users[0].diagnostic_center_id || null;
                        const technicianId = users[0].technician_id || null;
                        actorContext = centerId
                            ? { centerId, type: 'center' }
                            : (technicianId ? { technicianId, type: 'technician' } : null);
                    }
                } catch (e) {
                    // leave actorContext null if lookup fails
                }
            }

            // Final fallback: infer from appointment data for Both
            if (!actorContext) {
                try {
                    const [apptRows] = await connection.query('SELECT visit_type, center_id, other_center_id, center_confirmed_at, home_confirmed_at FROM appointments WHERE id = ?', [entity_id]);
                    if (apptRows && apptRows[0] && apptRows[0].visit_type === 'Both') {
                        const appt = apptRows[0];
                        
                        // Check which side the requesting user manages
                        const [userRows] = await connection.query('SELECT center_id, diagnostic_center_id, technician_id FROM users WHERE id = ?', [approval.requested_by]);
                        if (userRows && userRows[0]) {
                            const userCenterId = userRows[0].center_id || userRows[0].diagnostic_center_id;
                            const isTechnician = !!userRows[0].technician_id;
                            
                            if (isTechnician) {
                                // Technician always manages home side
                                actorContext = { centerId: appt.other_center_id, type: 'technician' };
                            } else if (userCenterId) {
                                // Center user: check which center they manage
                                if (userCenterId === appt.center_id) {
                                    actorContext = { centerId: appt.center_id, type: 'center' };
                                } else if (userCenterId === appt.other_center_id) {
                                    actorContext = { centerId: appt.other_center_id, type: 'technician' };
                                } else {
                                    // Default to center side if no match
                                    actorContext = { centerId: appt.center_id, type: 'center' };
                                }
                            } else {
                                // Admin: default to center side
                                actorContext = { centerId: appt.center_id, type: 'center' };
                            }
                        } else {
                            // No user info: default to center side
                            actorContext = { centerId: appt.center_id, type: 'center' };
                        }
                    }
                } catch (e) {
                    // leave null if lookup fails
                }
            }
            
            logger.info('applyApprovedChanges: appointment medical_status detected - delegating to updateMedicalStatus', {
                entity_id,
                medical_status: new_data.medical_status,
                has_pending: Array.isArray(new_data.pending_report_types) || typeof new_data.pending_report_types === 'string',
                reviewer: context.reviewedBy || null,
                actorContext: actorContext
            });

            const additionalData = {
                medical_remarks: new_data.medical_remarks,
                pending_report_types: new_data.pending_report_types
            };

            // Handle files if present in approval
            if (new_data._files && Array.isArray(new_data._files) && new_data._files.length > 0) {
                await coreAppointments.saveAppointmentMedicalFiles(
                    entity_id,
                    new_data._files,
                    context.reviewedBy || approval.requested_by || null
                );
            }

            // Pass actorContext if available (for Both appointments); null for simple Center/Home
            await coreAppointments.updateMedicalStatus(
                entity_id,
                new_data.medical_status,
                additionalData,
                context.reviewedBy || approval.requested_by || null,
                actorContext
            );

            return;
        }

        switch (action_type) {
            case ACTION_TYPES.CREATE:
                // For CREATE, just activate the entity (it was created with is_active=0)
                if (handler) {
                    await handler.activate(connection, entity_id);
                } else {
                    await this.activateEntity(connection, entity_type, entity_id);
                }
                break;

            case ACTION_TYPES.UPDATE:
                // For UPDATE, apply the new data
                // First let handler process rich fields (e.g., selected_items)
                if (handler) {
                    await handler.update(connection, entity_id, new_data, { old_data });
                }

                // Prevent non-column fields like selected_items and _actorContext from hitting the generic DB update
                const sanitizedData = { ...new_data };
                delete sanitizedData.selected_items;
                delete sanitizedData._actorContext;

                await this.updateEntity(connection, entity_type, entity_id, sanitizedData, { old_data, handler: null });
                break;

            case ACTION_TYPES.DELETE:
                // For DELETE, soft delete the entity
                if (handler) {
                    await handler.softDelete(connection, entity_id);
                } else {
                    await this.softDeleteEntity(connection, entity_type, entity_id);
                }
                break;

            case ACTION_TYPES.BULK_UPDATE:
                // For BULK UPDATE, apply changes to multiple entities
                if (Array.isArray(old_data)) {
                    if (Array.isArray(new_data)) {
                        // Array format: match by index
                        for (let i = 0; i < old_data.length; i++) {
                            const oldRecord = old_data[i];
                            const newRecord = new_data[i];
                            if (oldRecord && newRecord && oldRecord.id) {
                                await this.updateEntity(connection, entity_type, oldRecord.id, newRecord, { old_data: oldRecord, handler });
                            }
                        }
                    } else if (new_data && typeof new_data === 'object') {
                        // Single object format: apply same changes to all records
                        for (const oldRecord of old_data) {
                            if (oldRecord && oldRecord.id) {
                                await this.updateEntity(connection, entity_type, oldRecord.id, new_data, { old_data: oldRecord, handler });
                            }
                        }
                    }
                }
                break;

            case ACTION_TYPES.BULK_CREATE:
                // For BULK CREATE, activate multiple entities
                if (Array.isArray(new_data)) {
                    for (const record of new_data) {
                        if (record.id) {
                            if (handler) {
                                await handler.activate(connection, record.id);
                            } else {
                                await this.activateEntity(connection, entity_type, record.id);
                            }
                        }
                    }
                }
                break;

            case ACTION_TYPES.BULK_DELETE:
                // For BULK DELETE, soft delete multiple entities
                if (Array.isArray(old_data)) {
                    for (const record of old_data) {
                        if (record.id) {
                            if (handler) {
                                await handler.softDelete(connection, record.id);
                            } else {
                                await this.softDeleteEntity(connection, entity_type, record.id);
                            }
                        }
                    }
                }
                break;

            default:
                throw new Error(`Unknown action type: ${action_type}`);
        }
    }

    /**
     * Activate an entity (set is_active = 1)
     * @param {Object} connection - Database connection
     * @param {string} entityType - Entity type
     * @param {number} entityId - Entity ID
     * @returns {Promise<void>}
     */
    async activateEntity(connection, entityType, entityId) {
        const table = getEntityTable(entityType);
        if (!table) {
            throw new Error(`Unknown entity type: ${entityType}`);
        }

        await connection.execute(
            `UPDATE ${table} SET is_active = 1, has_pending_approval = 0 WHERE id = ?`,
            [entityId]
        );
    }

    /**
     * Soft delete entity
     * @param {Object} connection - Database connection
     * @param {string} entityType - Entity type
     * @param {number} entityId - Entity ID
     * @returns {Promise<void>}
     */
    async softDeleteEntity(connection, entityType, entityId) {
        const table = getEntityTable(entityType);
        if (!table) {
            throw new Error(`Unknown entity type: ${entityType}`);
        }

        await connection.execute(
            `UPDATE ${table} SET is_deleted = 1, updated_at = NOW() WHERE id = ?`,
            [entityId]
        );
    }

    /**
     * Update entity with new data
     * @param {Object} connection - Database connection
     * @param {string} entityType - Entity type
     * @param {number} entityId - Entity ID
     * @param {Object} newData - New data to apply
     * @param {Object} context - Additional context (old_data, handler)
     * @returns {Promise<void>}
     */
    async updateEntity(connection, entityType, entityId, newData, context = {}) {
        const table = getEntityTable(entityType);
        if (!table) {
            throw new Error(`Unknown entity type: ${entityType}`);
        }

        const { handler, old_data } = context;

        // If entity has custom handler, use it
        if (handler) {
            await handler.update(connection, entityId, newData, { old_data });
        }

        // Build UPDATE query dynamically with per-table and global filtering
        const tableDisallowed = getDisallowedFields(table);
        const fields = Object.keys(newData).filter((f) => 
            !GLOBAL_DISALLOWED_FIELDS.has(f) && !tableDisallowed.has(f)
        );

        const fieldTypeHints = getFieldTypeHints(table);

        if (fields.length > 0) {
            const setClause = fields.map(field => `${field} = ?`).join(', ');
            const values = fields.map(field => normalizeValue(table, field, newData[field], fieldTypeHints));
            
            await connection.execute(
                `UPDATE ${table} SET ${setClause}, updated_at = NOW() WHERE id = ?`,
                [...values, entityId]
            );
        }
    }
}

module.exports = ApprovalService;
