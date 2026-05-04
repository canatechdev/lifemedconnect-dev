/**
 * Approval Helper
 * Utility functions to integrate approval workflow into existing routes
 */

const approvalService = require('../services/approvals');
const logger = require('./logger');
const db = require('../lib/dbconnection');

/**
 * Check if user needs approval for their actions
 * Users with 'approvals.process' permission or Super Admin role bypass approval workflow
 * This allows users with approval permissions to auto-approve their own changes
 * @param {number} roleId - User's role ID
 * @param {Array} permissions - User's permissions array
 * @returns {boolean}
 */
const needsApproval = (roleId, permissions = []) => {
    // Get Super Admin role ID from environment (defaults to 5)
    const SUPER_ADMIN_ROLE_ID = parseInt(process.env.SUPER_ADMIN_ROLE_ID || '5', 10);
    
    // Super Admin bypasses approval
    if (roleId === SUPER_ADMIN_ROLE_ID) {
        return false;
    }
    
    // Users with approvals.process permission also bypass approval
    if (permissions && permissions.includes('approvals.process')) {
        return false;
    }
    
    // All other users go through approval workflow
    return true;
};

/**
 * Generate human-readable changes summary
 * @param {Object} oldData - Original data
 * @param {Object} newData - New data
 * @returns {string} Summary of changes
 */
const generateChangesSummary = (oldData, newData) => {
    if (!oldData) {
        return 'New record creation';
    }

    const IGNORE_KEYS = new Set([
        'updated_at', 'created_at', 'has_pending_approval', 'updated_by', 'priority'
    ]);
    const isEmpty = (v) => v === undefined || v === null || v === '' || v === 'undefined';
    const isEmptyArray = (v) => Array.isArray(v) && v.length === 0;
    const isEmptyLike = (v) => isEmpty(v) || isEmptyArray(v);
    const normalizeDate = (v) => {
        if (!v) return null;
        try {
            const d = new Date(v);
            if (!isNaN(d)) return d.toISOString().slice(0, 10);
        } catch (_) {}
        return String(v);
    };
    const normalizeTime = (v) => {
        if (!v) return null;
        if (typeof v === 'string' && /^\d{2}:\d{2}(:\d{2})?$/.test(v)) {
            const [h, m, s] = v.split(':');
            return `${h.padStart(2,'0')}:${(m||'00').padStart(2,'0')}:${(s||'00').padStart(2,'0')}`;
        }
        return String(v);
    };
    const eq = (a, b, key) => {
        if (isEmptyLike(a) && isEmptyLike(b)) return true;
        if (key === 'selected_items') {
            if (isEmptyLike(a) && isEmptyLike(b)) return true;
        }
        if (key === 'total_amount') {
            return (isEmpty(a) && Number(b) === 0) || (isEmpty(b) && Number(a) === 0);
        }
        if (typeof a === 'number' || typeof b === 'number') return Number(a) === Number(b);
        if (key && key.toLowerCase().includes('date')) return normalizeDate(a) === normalizeDate(b);
        if (key && key.toLowerCase().includes('time')) return normalizeTime(a) === normalizeTime(b);
        return String(a) === String(b);
    };

    const changes = [];
    for (const key in newData) {
        if (IGNORE_KEYS.has(key)) continue;
        if (key.includes('password')) continue;

        const oldVal = oldData[key];
        const newVal = newData[key];

        // Ignore benign diffs where both are effectively empty
        if (eq(oldVal, newVal, key)) continue;

        // Special handling for selected_items
        if (key === 'selected_items') {
            const oldCount = Array.isArray(oldVal) ? oldVal.length : 0;
            const newCount = Array.isArray(newVal) ? newVal.length : 0;
            changes.push(`${key}: "${oldCount} test(s)" → "${newCount} test(s)"`);
            continue;
        }

        changes.push(`${key}: "${isEmptyLike(oldVal) ? 'empty' : oldVal}" → "${isEmptyLike(newVal) ? 'empty' : newVal}"`);
    }

    return changes.length > 0 ? changes.join(', ') : 'No changes detected';
};

/**
 * Submit entity for approval (for CREATE operations)
 * @param {Object} params
 * @returns {Promise<Object>} Result with approval info
 */
const submitForApproval = async ({
    entity_type,
    entity_id,
    action_type,
    old_data = null,
    new_data,
    requested_by,
    notes = '',
    priority = 'medium'
}) => {
    try {
        logger.info('submitForApproval payload debug', {
            entity_type,
            entity_id,
            action_type,
            oldDataKeys: old_data ? Object.keys(old_data) : [],
            newDataKeys: new_data ? Object.keys(new_data) : [],
            hasSelectedItems: !!new_data?.selected_items,
            selectedItemsCount: Array.isArray(new_data?.selected_items) ? new_data.selected_items.length : null,
            selectedItemsPreview: Array.isArray(new_data?.selected_items) ? new_data.selected_items.slice(0, 2) : null
        });

        const changes_summary = generateChangesSummary(old_data, new_data);

        const approvalId = await approvalService.createApprovalRequest({
            entity_type,
            entity_id,
            action_type,
            old_data,
            new_data,
            changes_summary,
            requested_by,
            notes,
            priority
        });

        logger.info('Entity submitted for approval', {
            entity_type,
            entity_id,
            action_type,
            approvalId
        });

        return {
            success: true,
            needsApproval: true,
            approvalId,
            message: 'Your request has been submitted for Super Admin approval.',
            entity_id
        };
    } catch (error) {
        logger.error('Error submitting for approval', {
            entity_type,
            entity_id,
            error: error.message
        });
        throw error;
    }
};

/**
 * Wrapper for CREATE operations with approval
 * @param {Object} params
 * @returns {Promise<Object>}
 */
const createWithApproval = async ({
    entity_type,
    createFunction,
    data,
    user,
    notes = '',
    priority = 'medium'
}) => {
    console.log(' [APPROVAL HELPER] createWithApproval called');
    console.log(' [APPROVAL HELPER] entity_type:', entity_type);
    console.log(' [APPROVAL HELPER] user:', user);
    console.log(' [APPROVAL HELPER] data keys:', Object.keys(data || {}));
    
    // If user has approval permission, create directly without approval
    if (!needsApproval(user.role_id, user.permissions)) {
        console.log(' [APPROVAL HELPER] Super Admin - creating directly without approval...');
        const entity_id = await createFunction(data);
        console.log(' [APPROVAL HELPER] Created entity with ID:', entity_id);
        return {
            success: true,
            entity_id,
            needsApproval: false
        };
    }

    // For other users, create with is_active=0 and submit for approval in one transaction when possible
    console.log(' [APPROVAL HELPER] User needs approval, starting approval flow...');
    const dataWithInactive = {
        ...data,
        is_active: 0,
        created_by: user.id
    };
    console.log(' [APPROVAL HELPER] Data with inactive flag prepared');
    
    // Attempt end-to-end transaction
    console.log(' [APPROVAL HELPER] Getting database connection...');
    const connection = await db.pool.getConnection();
    try {
        console.log(' [APPROVAL HELPER] Starting transaction...');
        await connection.beginTransaction();

        // Allow createFunction to use provided connection when supported
        console.log(' [APPROVAL HELPER] Calling createFunction with data...');
        const entity_id = await createFunction(dataWithInactive, connection);
        console.log(' [APPROVAL HELPER] Entity created with ID:', entity_id);

        // Enqueue approval within same transaction
        console.log(' [APPROVAL HELPER] Creating approval request...');
        await approvalService.createApprovalRequest({
            entity_type,
            entity_id,
            action_type: 'create',
            old_data: null,
            new_data: data,
            requested_by: user.id,
            notes,
            priority
        }, connection);
        console.log(' [APPROVAL HELPER] Approval request created');

        console.log(' [APPROVAL HELPER] Committing transaction...');
        await connection.commit();

        return {
            success: true,
            needsApproval: true,
            approvalId: undefined,
            message: 'Your request has been submitted for Super Admin approval.',
            entity_id
        };
    } catch (txError) {
        console.log(' [APPROVAL HELPER] Transaction failed, rolling back...');
        console.log(' [APPROVAL HELPER] Transaction error:', txError);
        await connection.rollback();
        throw txError;
    } finally {
        console.log(' [APPROVAL HELPER] Releasing connection...');
        connection.release();
    }
};

/**
 * Wrapper for UPDATE operations with approval
 * @param {Object} params
 * @returns {Promise<Object>}
 */
// const updateWithApproval = async ({
//     entity_type,
//     entity_id,
//     getFunction,
//     updateFunction,
//     new_data,
//     user,
//     notes = '',
//     priority = 'medium'
// }) => {
//     // Get current data
//     const old_data = await getFunction(entity_id);

//     if (!old_data) {
//         throw new Error('Entity not found');
//     }

//     // If Super Admin, update directly without approval
//     if (!needsApproval(user.role_id)) {
//         await updateFunction(entity_id, new_data);
//         return {
//             success: true,
//             needsApproval: false,
//             message: 'Record updated successfully.'
//         };
//     }

//     // For other users, submit for approval without applying changes
//     return await submitForApproval({
//         entity_type,
//         entity_id,
//         action_type: 'update',
//         old_data,
//         new_data,
//         requested_by: user.id,
//         notes,
//         priority
//     });
// };

/**
 * Helper to check if there are actual changes between old and new data
 */
const hasActualChanges = (oldData, newData) => {
    // Ignore these fields in comparison
    const ignoreFields = new Set(['updated_at', 'updated_by', 'created_at', 'created_by', 'has_pending_approval']);
    
    for (const key in newData) {
        if (ignoreFields.has(key)) continue;
        if (newData[key] === undefined) continue;
        
        const oldValue = oldData[key];
        const newValue = newData[key];
        
        // Handle null/empty comparisons
        const isOldEmpty = oldValue === null || oldValue === undefined || oldValue === '';
        const isNewEmpty = newValue === null || newValue === undefined || newValue === '';
        
        if (isOldEmpty && isNewEmpty) continue;
        if (isOldEmpty !== isNewEmpty) return true;
        
        // Special handling for selected_items (array of objects)
        if (key === 'selected_items') {
            const arrOld = Array.isArray(oldValue) ? oldValue : [];
            const arrNew = Array.isArray(newValue) ? newValue : [];
            
            if (arrOld.length !== arrNew.length) return true;
            
            // Compare each item by key properties
            for (let i = 0; i < arrNew.length; i++) {
                const oldItem = arrOld[i] || {};
                const newItem = arrNew[i];
                
                // Compare key fields that matter for assignments
                const keysToCompare = ['id', 'assigned_center_id', 'assigned_technician_id', 'visit_subtype', 'rate'];
                for (const k of keysToCompare) {
                    if (String(oldItem[k] || '') !== String(newItem[k] || '')) {
                        return true;
                    }
                }
            }
            continue;
        }
        
        // Handle arrays (like test_ids, insurer_ids)
        if (Array.isArray(newValue) || Array.isArray(oldValue)) {
            const arrOld = Array.isArray(oldValue) ? oldValue : String(oldValue || '').split(',').filter(Boolean).map(Number);
            const arrNew = Array.isArray(newValue) ? newValue : String(newValue || '').split(',').filter(Boolean).map(Number);
            
            if (arrOld.length !== arrNew.length) return true;
            
            // Sort and compare
            const sortedOld = [...arrOld].sort((a, b) => a - b);
            const sortedNew = [...arrNew].sort((a, b) => a - b);
            
            if (!sortedOld.every((val, idx) => val === sortedNew[idx])) return true;
            continue;
        }
        
        // Handle dates
        if (key.toLowerCase().includes('date')) {
            const dateOld = oldValue ? new Date(oldValue).toISOString().slice(0, 10) : null;
            const dateNew = newValue ? new Date(newValue).toISOString().slice(0, 10) : null;
            if (dateOld !== dateNew) return true;
            continue;
        }
        
        // Handle times
        if (key.toLowerCase().includes('time')) {
            const timeOld = oldValue ? String(oldValue).slice(0, 8) : null; // HH:MM:SS
            const timeNew = newValue ? String(newValue).slice(0, 8) : null;
            if (timeOld !== timeNew) return true;
            continue;
        }
        
        // Handle numbers
        if (typeof oldValue === 'number' || typeof newValue === 'number') {
            if (Number(oldValue) !== Number(newValue)) return true;
            continue;
        }
        
        // Default string comparison
        if (String(oldValue) !== String(newValue)) {
            return true;
        }
    }
    return false;
};

const updateWithApproval = async ({
    entity_type,
    entity_id,
    entity_ids,
    getFunction,
    updateFunction,
    new_data,
    user,
    notes = '',
    priority = 'medium'
}) => {
    console.log(' [APPROVAL] updateWithApproval called:', {
        entity_type,
        entity_id,
        entity_ids,
        hasNewData: !!new_data,
        newDataKeys: new_data ? Object.keys(new_data) : [],
        hasSelectedItems: !!new_data?.selected_items,
        selectedItemsCount: new_data?.selected_items?.length
    });
    
    let old_data;
    let bulkInfo = '';

    // Handle bulk operations
    if (entity_ids) {
        old_data = await getFunction(entity_ids);
        
        if (!old_data || 
            (Array.isArray(old_data) && old_data.length === 0) ||
            (typeof old_data === 'object' && Object.keys(old_data).length === 0)) {
            throw new Error('No entities found');
        }
        
        // Filter out records with no actual changes
        if (Array.isArray(old_data)) {
            const changedRecords = [];
            const changedIds = [];
            
            if (Array.isArray(new_data)) {
                // Array format: match by index (e.g., test_rate bulk updates)
                for (let i = 0; i < old_data.length; i++) {
                    const oldRecord = old_data[i];
                    const newRecord = new_data[i];
                    
                    if (newRecord && hasActualChanges(oldRecord, newRecord)) {
                        changedRecords.push(oldRecord);
                        changedIds.push(oldRecord.id);
                    }
                }
            } else if (new_data && typeof new_data === 'object') {
                // Single object format: same changes applied to all (e.g., appointment bulk updates)
                for (const oldRecord of old_data) {
                    if (hasActualChanges(oldRecord, new_data)) {
                        changedRecords.push(oldRecord);
                        changedIds.push(oldRecord.id);
                    }
                }
            }
            
            if (changedRecords.length === 0) {
                return {
                    success: true,
                    needsApproval: false,
                    message: 'No changes detected. No approval needed.',
                    skipped: true
                };
            }
            
            // Update to only include changed records
            old_data = changedRecords;
            entity_ids = changedIds;
        }
        
        // Store bulk information for tracking with human-readable identifiers
        const identifiers = Array.isArray(old_data) 
            ? old_data.map(item => {
                // Try to get a meaningful identifier based on entity type
                if (entity_type === 'appointment') {
                    return item.case_number || item.application_number || `ID: ${item.id}`;
                } else if (entity_type === 'client') {
                    return item.client_name || `ID: ${item.id}`;
                } else if (entity_type === 'center') {
                    return item.center_name || `ID: ${item.id}`;
                } else if (entity_type === 'doctor') {
                    return item.doctor_name || `ID: ${item.id}`;
                } else if (entity_type === 'insurer') {
                    return item.insurer_name || `ID: ${item.id}`;
                } else if (entity_type === 'test') {
                    return item.test_name || `ID: ${item.id}`;
                } else if (entity_type === 'test_rate') {
                    return `${item.item_name} (${item.client_name || 'Client'})`;
                } else if (entity_type === 'technician') {
                    return item.technician_name || `ID: ${item.id}`;
                } else {
                    return `ID: ${item.id}`;
                }
            }).join(', ')
            : entity_ids.join(', ');
        
        bulkInfo = `BULK_OPERATION: Affecting ${entity_ids.length} records: ${identifiers}. `;
        
        // Use first ID as entity_id (required by database schema)
        entity_id = entity_ids[0];
    } else {
        // Handle single entity operations
        old_data = await getFunction(entity_id);
        if (!old_data) {
            throw new Error('Entity not found');
        }
        
        // Check if there are actual changes for single entity
        if (!hasActualChanges(old_data, new_data)) {
            return {
                success: true,
                needsApproval: false,
                message: 'No changes detected. No approval needed.',
                skipped: true
            };
        }
    }

    // If user has approval processing permission, update directly without approval
    if (!needsApproval(user.role_id, user.permissions)) {
        console.log(' [APPROVAL-HELPER] User has approval permission - Updating directly without approval:', {
            entity_type,
            entity_id,
            entity_ids,
            hasSelectedItems: !!new_data?.selected_items,
            selectedItemsCount: new_data?.selected_items?.length,
            newDataKeys: Object.keys(new_data)
        });
        
        if (entity_ids) {
            await updateFunction(entity_ids, new_data);
        } else {
            console.log(' [APPROVAL-HELPER] Calling updateFunction with data:', {
                entity_id,
                hasSelectedItems: !!new_data?.selected_items,
                selectedItemsPreview: new_data?.selected_items?.slice(0, 2)
            });
            await updateFunction(entity_id, new_data);
        }
        
        console.log(' [APPROVAL-HELPER] Direct update completed successfully');
        return {
            success: true,
            needsApproval: false,
            message: entity_ids ? 'Records updated successfully.' : 'Record updated successfully.'
        };
    }

    // For other users, submit for approval without applying changes
    console.log(' [APPROVAL-HELPER] Non-Super Admin - Submitting for approval:', {
        entity_type,
        entity_id,
        userRoleId: user.role_id,
        action_type: entity_ids ? 'bulk_update' : 'update',
        hasSelectedItems: !!new_data?.selected_items,
        selectedItemsCount: new_data?.selected_items?.length,
        selectedItemsSample: new_data?.selected_items?.[0],
        newDataKeys: Object.keys(new_data)
    });
    
    const approvalResult = await submitForApproval({
        entity_type,
        entity_id, // Integer value required
        action_type: entity_ids ? 'bulk_update' : 'update',
        old_data,
        new_data,
        requested_by: user.id,
        notes: bulkInfo + notes,
        priority
    });
    
    console.log(' [APPROVAL-HELPER] Approval request created:', {
        approvalId: approvalResult.approvalId,
        needsApproval: approvalResult.needsApproval
    });
    
    return approvalResult;
};

/**
 * Wrapper for DELETE operations with approval
 * @param {Object} params
 * @returns {Promise<Object>}
 */
const deleteWithApproval = async ({
    entity_type,
    entity_id,
    entity_ids,
    getFunction,
    deleteFunction,
    user,
    notes = '',
    priority = 'medium'
}) => {
    // Determine if this is a bulk operation
    const isBulk = entity_ids && Array.isArray(entity_ids);
    const ids = isBulk ? entity_ids : [entity_id];
    
    // Get current data
    const old_data = await getFunction(ids);

    if (!old_data || (Array.isArray(old_data) && old_data.length === 0)) {
        throw new Error('Entity not found');
    }

    // If user has approval permission, delete directly without approval
    if (!needsApproval(user.role_id, user.permissions)) {
        // Check if deleteFunction is softDeleteAppointments (needs updatedBy) or regular delete
        if (deleteFunction.name === 'softDeleteAppointments') {
            await deleteFunction(isBulk ? ids : entity_id, user.id);
        } else {
            await deleteFunction(isBulk ? ids : entity_id);
        }
        return {
            success: true,
            needsApproval: false,
            entity_ids: ids,
            message: 'Record(s) deleted successfully.'
        };
    }

    // For other users, submit for approval
    const action_type = isBulk ? 'bulk_delete' : 'delete';
    
    return await submitForApproval({
        entity_type,
        entity_id: isBulk ? ids[0] : entity_id,
        action_type,
        old_data,
        new_data: { is_deleted: 1 },
        requested_by: user.id,
        notes,
        priority
    });
};

/**
 * Add approval info to API response
 * @param {Object} result - Result from approval operation
 * @returns {Object} Formatted response
 */
const formatApprovalResponse = (result) => {
    console.log(' [APPROVAL HELPER] formatApprovalResponse called with:', result);
    
    if (result.needsApproval) {
        const response = {
            id: result.entity_id,
            approval_required: true,
            approval_id: result.approvalId,
            status: 'pending_approval',
            message: result.message || 'Your request has been submitted for Super Admin approval.'
        };
        console.log(' [APPROVAL HELPER] Formatted approval response:', response);
        return response;
    }

    const response = {
        id: result.entity_id,
        approval_required: false,
        status: 'completed',
        message: result.message || 'Operation completed successfully.'
    };
    console.log(' [APPROVAL HELPER] Formatted direct response:', response);
    return response;
};




module.exports = {
    needsApproval,
    generateChangesSummary,
    submitForApproval,
    createWithApproval,
    updateWithApproval,
    deleteWithApproval,
    formatApprovalResponse
};
