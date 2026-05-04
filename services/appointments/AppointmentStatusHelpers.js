/**
 * Helper functions for appointment status computation
 */

const { parsePendingReportTypes, serializePendingReportTypes } = require('./AppointmentQueries');

/**
 * Compute overall appointment status from center and home medical statuses
 * Used for Both appointments to determine the main status field
 * 
 * @param {string|null} centerStatus - Center side medical status
 * @param {string|null} homeStatus - Home side medical status
 * @returns {string} Overall appointment status
 */
function computeOverallStatus(centerStatus, homeStatus) {
    // If either side is null/undefined, treat as not started
    if (!centerStatus && !homeStatus) {
        return 'scheduled';
    }
    
    // If only one side exists, use that side's status
    if (!centerStatus) {
        return mapMedicalToMainStatus(homeStatus);
    }
    if (!homeStatus) {
        return mapMedicalToMainStatus(centerStatus);
    }
    
    // Both sides exist - compute combined status
    
    // If BOTH are completed, overall is medical_completed
    if (centerStatus === 'completed' && homeStatus === 'completed') {
        return 'medical_completed';
    }
    
    // If either is partially_completed or one is completed and other is not, overall is medical_partially_completed
    if (centerStatus === 'partially_completed' || homeStatus === 'partially_completed' ||
        (centerStatus === 'completed' && homeStatus !== 'completed') ||
        (homeStatus === 'completed' && centerStatus !== 'completed')) {
        return 'medical_partially_completed';
    }
    
    // If either is in_process, overall is medical_in_process
    if (centerStatus === 'in_process' || homeStatus === 'in_process') {
        return 'medical_in_process';
    }
    
    // If either is arrived, overall is checked_in
    if (centerStatus === 'arrived' || homeStatus === 'arrived') {
        return 'checked_in';
    }
    
    // If both are scheduled, overall is pending
    if (centerStatus === 'scheduled' && homeStatus === 'scheduled') {
        return 'pending';
    }
    
    // Default fallback
    return 'scheduled';
}

/**
 * Map medical_status to main status for single-side appointments
 * @param {string} medicalStatus
 * @returns {string}
 */
function mapMedicalToMainStatus(medicalStatus) {
    const mapping = {
        'scheduled': 'pending',
        'arrived': 'checked_in',
        'in_process': 'medical_in_process',
        'partially_completed': 'medical_partially_completed',
        'completed': 'medical_completed'
    };
    return mapping[medicalStatus] || 'scheduled';
}

module.exports = {
    computeOverallStatus,
    mapMedicalToMainStatus,
    parsePendingReportTypes,
    serializePendingReportTypes
};
