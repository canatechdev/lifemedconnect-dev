/**
 * Approvals Module - Main Export
 * Provides backward-compatible exports for the refactored approval system
 * 
 * This file maintains the same API as the old s_approvals.js
 * All existing code importing from s_approvals.js will work without changes
 */

const ApprovalService = require('./ApprovalService');
const ApprovalQueue = require('./ApprovalQueue');
const { enrichApprovalForDisplay } = require('./utils/displayBuilder');
const { getEntityTable } = require('./config/entityConfig');

// Create singleton instances
const approvalService = new ApprovalService();
const approvalQueue = new ApprovalQueue();

/**
 * Create a new approval request
 * @param {Object} approvalData - Approval request data
 * @param {Object} connection - Optional database connection
 * @returns {Promise<number>} Approval queue ID
 */
const createApprovalRequest = async (approvalData, connection = null) => {
    return await approvalQueue.createApprovalRequest(approvalData, connection);
};

/**
 * Get all pending approvals
 * @param {Object} filters - Filter options
 * @returns {Promise<Array>} List of pending approvals
 */
const getPendingApprovals = async (filters = {}) => {
    return await approvalQueue.getPendingApprovals(filters);
};

/**
 * Get approval by ID with enriched display data
 * @param {number} approvalId - Approval queue ID
 * @returns {Promise<Object>} Approval details
 */
const getApprovalById = async (approvalId) => {
    const approval = await approvalQueue.getApprovalById(approvalId);
    
    if (!approval) {
        return null;
    }

    // Enrich with display data
    return await enrichApprovalForDisplay(approval);
};

/**
 * Approve a request and apply changes
 * @param {number} approvalId - Approval queue ID
 * @param {number} reviewedBy - Super Admin user ID
 * @returns {Promise<boolean>} Success status
 */
const approveRequest = async (approvalId, reviewedBy) => {
    return await approvalService.approveRequest(approvalId, reviewedBy);
};

/**
 * Reject a request
 * @param {number} approvalId - Approval queue ID
 * @param {number} reviewedBy - Super Admin user ID
 * @param {string} rejectionReason - Reason for rejection
 * @returns {Promise<boolean>} Success status
 */
const rejectRequest = async (approvalId, reviewedBy, rejectionReason) => {
    return await approvalService.rejectRequest(approvalId, reviewedBy, rejectionReason);
};

/**
 * Get approval statistics
 * @returns {Promise<Array>} Statistics by status and entity type
 */
const getApprovalStats = async () => {
    return await approvalQueue.getApprovalStats();
};

/**
 * Get user's pending requests
 * @param {number} userId - User ID
 * @param {string} status - Status filter
 * @param {number} limit - Limit
 * @param {number} offset - Offset
 * @returns {Promise<Object>} Data and total count
 */
const getUserPendingRequests = async (userId, status = 'pending', limit = 10, offset = 0) => {
    return await approvalQueue.getUserPendingRequests(userId, status, limit, offset);
};

// Export all functions (backward compatible with old s_approvals.js)
module.exports = {
    // Main approval operations
    createApprovalRequest,
    getPendingApprovals,
    getApprovalById,
    approveRequest,
    rejectRequest,
    getApprovalStats,
    getUserPendingRequests,
    
    // Utility function
    getEntityTable,
    
    // Export classes for advanced usage
    ApprovalService,
    ApprovalQueue
};
