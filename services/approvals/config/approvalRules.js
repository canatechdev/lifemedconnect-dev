/**
 * Approval Rules Configuration
 * Business rules for the approval system
 */

/**
 * Legacy role-based approval bypass (deprecated)
 * Now uses permission-based system with 'approvals.process' permission
 * SUPER_ADMIN_ROLE_ID still used for backward compatibility
 */
const SUPER_ADMIN_ROLE_ID = parseInt(process.env.SUPER_ADMIN_ROLE_ID || '5', 10);
const BYPASS_APPROVAL_ROLES = [SUPER_ADMIN_ROLE_ID]; // Deprecated - use permissions instead

/**
 * Valid action types
 */
const ACTION_TYPES = {
    CREATE: 'create',
    UPDATE: 'update',
    DELETE: 'delete',
    BULK_CREATE: 'bulk_create',
    BULK_UPDATE: 'bulk_update',
    BULK_DELETE: 'bulk_delete'
};

/**
 * Valid approval statuses
 */
const APPROVAL_STATUS = {
    PENDING: 'pending',
    APPROVED: 'approved',
    REJECTED: 'rejected'
};

/**
 * Valid priority levels
 */
const PRIORITY_LEVELS = {
    URGENT: 'urgent',
    HIGH: 'high',
    MEDIUM: 'medium',
    LOW: 'low'
};

/**
 * Default priority
 */
const DEFAULT_PRIORITY = PRIORITY_LEVELS.MEDIUM;

/**
 * Check if user needs approval for their actions
 * Users with 'approvals.process' permission or Super Admin role bypass approval workflow
 * @param {number} roleId - User's role ID
 * @param {Array} permissions - User's permissions array
 * @returns {boolean}
 */
const needsApproval = (roleId, permissions = []) => {
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
 * Validate action type
 * @param {string} actionType - Action type to validate
 * @returns {boolean}
 */
const isValidActionType = (actionType) => {
    return Object.values(ACTION_TYPES).includes(actionType);
};

/**
 * Validate approval status
 * @param {string} status - Status to validate
 * @returns {boolean}
 */
const isValidStatus = (status) => {
    return Object.values(APPROVAL_STATUS).includes(status);
};

/**
 * Validate priority level
 * @param {string} priority - Priority to validate
 * @returns {boolean}
 */
const isValidPriority = (priority) => {
    return Object.values(PRIORITY_LEVELS).includes(priority);
};

module.exports = {
    BYPASS_APPROVAL_ROLES,
    SUPER_ADMIN_ROLE_ID,
    ACTION_TYPES,
    APPROVAL_STATUS,
    PRIORITY_LEVELS,
    DEFAULT_PRIORITY,
    needsApproval,
    isValidActionType,
    isValidStatus,
    isValidPriority
};
