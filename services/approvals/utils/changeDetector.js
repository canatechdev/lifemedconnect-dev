/**
 * Change Detector
 * Intelligent change detection between old and new data
 */

const { normalizeDate, normalizeTime, isEmptyLike } = require('./normalizers');
const { shouldIgnoreField } = require('../config/entityConfig');

/**
 * Compare two values for equality with smart handling
 * @param {*} oldValue - Old value
 * @param {*} newValue - New value
 * @param {string} key - Field name
 * @param {Object} context - Additional context (oldData, newData)
 * @returns {boolean} True if values are equal
 */
const areValuesEqual = (oldValue, newValue, key, context = {}) => {
    // Both empty-like
    if (isEmptyLike(oldValue) && isEmptyLike(newValue)) return true;
    
    // Helper to compare selected_items arrays (order-insensitive by id)
    const compareSelectedItems = (a, b) => {
        const arrA = Array.isArray(a) ? a : [];
        const arrB = Array.isArray(b) ? b : [];
        if (arrA.length !== arrB.length) return false;
        const normalize = (item) => ({
            id: item.id ?? null,
            assigned_center_id: item.assigned_center_id ?? null,
            assigned_technician_id: item.assigned_technician_id ?? null,
            visit_subtype: item.visit_subtype ?? null,
            rate: Number(item.rate)
        });
        const mapA = arrA.map(normalize).sort((x, y) => Number(x.id) - Number(y.id));
        const mapB = arrB.map(normalize).sort((x, y) => Number(x.id) - Number(y.id));
        return mapA.every((item, idx) => {
            const other = mapB[idx];
            return item.id === other.id &&
                item.assigned_center_id === other.assigned_center_id &&
                item.assigned_technician_id === other.assigned_technician_id &&
                item.visit_subtype === other.visit_subtype &&
                item.rate === other.rate;
        });
    };

    // Special handling for selected_items (deep compare)
    if (key === 'selected_items') {
        return compareSelectedItems(oldValue, newValue);
    }
    
    // Special handling for *_ids arrays (order-insensitive)
    if (key && key.endsWith('_ids')) {
        const arrA = Array.isArray(oldValue) 
            ? oldValue.map(Number).sort((x, y) => x - y) 
            : String(oldValue || '').split(',').filter(Boolean).map(Number).sort((x, y) => x - y);
        const arrB = Array.isArray(newValue) 
            ? newValue.map(Number).sort((x, y) => x - y) 
            : String(newValue || '').split(',').filter(Boolean).map(Number).sort((x, y) => x - y);
        if (arrA.length === arrB.length && arrA.every((v, i) => v === arrB[i])) return true;
    }
    
    // Special handling for total_amount
    if (key === 'total_amount') {
        const selNewEmpty = isEmptyLike(context.newData?.selected_items);
        const selOldEmpty = isEmptyLike(context.oldData?.selected_items);
        if ((isEmptyLike(oldValue) && Number(newValue) === 0 && selNewEmpty) || 
            (isEmptyLike(newValue) && Number(oldValue) === 0 && selOldEmpty)) {
            return true;
        }
    }
    
    // Number comparison
    if (typeof oldValue === 'number' || typeof newValue === 'number') {
        return Number(oldValue) === Number(newValue);
    }
    
    // Date comparison - handle datetime vs date properly
    if (key && key.toLowerCase().includes('date')) {
        // Special handling for confirmed_date - check both date and time
        if (key === 'confirmed_date') {
            // If both values normalize to same date, check if there's actually a time difference
            const oldDate = normalizeDate(oldValue);
            const newDate = normalizeDate(newValue);
            
            if (oldDate === newDate) {
                // Same date - check if there's a time component that changed
                const oldTime = oldValue && oldValue.includes('T') ? oldValue.split('T')[1]?.slice(0, 8) : null;
                const newTime = newValue && newValue.includes('T') ? newValue.split('T')[1]?.slice(0, 8) : null;
                
                // If old has time but new doesn't, or times are different, it's a change
                if (oldTime && (!newTime || oldTime !== newTime)) {
                    return false; // There IS a change
                }
            }
            return oldDate === newDate;
        }
        
        // Regular date comparison for other date fields
        return normalizeDate(oldValue) === normalizeDate(newValue);
    }
    
    // Time comparison
    if (key && key.toLowerCase().includes('time')) {
        return normalizeTime(oldValue) === normalizeTime(newValue);
    }
    
    // Default string comparison
    return String(oldValue) === String(newValue);
};

/**
 * Check if there are actual changes between old and new data
 * @param {Object} oldData - Original data
 * @param {Object} newData - New data
 * @returns {boolean} True if there are changes
 */
const hasActualChanges = (oldData, newData) => {
    for (const key in newData) {
        if (shouldIgnoreField(key)) continue;
        if (newData[key] === undefined) continue;
        
        const oldValue = oldData[key];
        const newValue = newData[key];
        
        // Handle null/empty comparisons
        const isOldEmpty = oldValue === null || oldValue === undefined || oldValue === '';
        const isNewEmpty = newValue === null || newValue === undefined || newValue === '';
        
        if (isOldEmpty && isNewEmpty) continue;
        if (isOldEmpty !== isNewEmpty) return true;
        
        // Handle arrays (like test_ids, insurer_ids)
        if (Array.isArray(newValue) || Array.isArray(oldValue)) {
            const arrOld = Array.isArray(oldValue) 
                ? oldValue 
                : String(oldValue || '').split(',').filter(Boolean).map(Number);
            const arrNew = Array.isArray(newValue) 
                ? newValue 
                : String(newValue || '').split(',').filter(Boolean).map(Number);
            
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

/**
 * Get only the fields that changed between old and new data
 * @param {Object} oldData - Original data
 * @param {Object} newData - New data
 * @returns {Object|null} Object with only changed fields, or null if no changes
 */
const getChangedFields = (oldData, newData) => {
    if (!oldData || !newData) return null;
    
    const changed = {};
    let hasChanges = false;
    
        
    for (const key in newData) {
        if (shouldIgnoreField(key)) continue;
        
        const oldVal = oldData[key];
        const newVal = newData[key];
        
        // Skip if values are equal
        if (areValuesEqual(oldVal, newVal, key, { oldData, newData })) continue;
        
        changed[key] = oldVal;
        hasChanges = true;
    }
    
    return hasChanges ? changed : null;
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

    const changes = [];
    for (const key in newData) {
        if (shouldIgnoreField(key)) continue;

        const oldVal = oldData[key];
        const newVal = newData[key];

        // Ignore benign diffs where both are effectively empty
        if (areValuesEqual(oldVal, newVal, key, { oldData, newData })) continue;

        changes.push(`${key}: "${isEmptyLike(oldVal) ? 'empty' : oldVal}" → "${isEmptyLike(newVal) ? 'empty' : newVal}"`);
    }

    return changes.length > 0 ? changes.join(', ') : 'No changes detected';
};

module.exports = {
    areValuesEqual,
    hasActualChanges,
    getChangedFields,
    generateChangesSummary
};
