/**
 * Data Normalizers
 * Functions to normalize data for consistent comparison and storage
 */

/**
 * Check if value is empty-like
 * @param {*} value - Value to check
 * @returns {boolean}
 */
const isEmpty = (value) => {
    return value === undefined || value === null || value === '' || value === 'undefined';
};

/**
 * Check if value is empty array
 * @param {*} value - Value to check
 * @returns {boolean}
 */
const isEmptyArray = (value) => {
    return Array.isArray(value) && value.length === 0;
};

/**
 * Check if value is empty-like (includes empty arrays)
 * @param {*} value - Value to check
 * @returns {boolean}
 */
const isEmptyLike = (value) => {
    return isEmpty(value) || isEmptyArray(value);
};

/**
 * Normalize date to YYYY-MM-DD format
 * @param {*} value - Date value
 * @returns {string|null} Normalized date or null
 */
const normalizeDate = (value) => {
    if (!value) return null;
    try {
        const d = new Date(value);
        if (!isNaN(d)) return d.toISOString().slice(0, 10);
    } catch (_) {}
    return String(value);
};

/**
 * Normalize date to local timezone (Asia/Kolkata)
 * @param {*} value - Date value
 * @param {string} timeZone - Timezone (default: Asia/Kolkata)
 * @returns {string|null} Normalized date or null
 */
const normalizeDateLocal = (value, timeZone = 'Asia/Kolkata') => {
    if (!value) return null;
    try {
        const d = new Date(value);
        if (isNaN(d)) return null;
        const parts = new Intl.DateTimeFormat('en-CA', { 
            timeZone, 
            year: 'numeric', 
            month: '2-digit', 
            day: '2-digit' 
        }).formatToParts(d);
        const y = parts.find(p => p.type === 'year')?.value;
        const m = parts.find(p => p.type === 'month')?.value;
        const da = parts.find(p => p.type === 'day')?.value;
        return (y && m && da) ? `${y}-${m}-${da}` : null;
    } catch (_) {
        return null;
    }
};

/**
 * Normalize time to HH:MM:SS format
 * @param {*} value - Time value
 * @returns {string|null} Normalized time or null
 */
const normalizeTime = (value) => {
    if (!value) return null;

    // Clean string values
    if (typeof value === 'string') {
        const trimmed = value.trim();

        // Handle TimeOfDay(15:34) or TimeOfDay(15:34:00)
        const timeOfDayMatch = trimmed.match(/TimeOfDay\((\d{1,2}):(\d{2})(?::(\d{2}))?\)/i);
        if (timeOfDayMatch) {
            const [ , h, m, s ] = timeOfDayMatch;
            return `${h.padStart(2, '0')}:${m.padStart(2, '0')}:${(s || '00').padStart(2, '0')}`;
        }

        // Handle 12-hour with AM/PM (e.g., 4:03 PM or 04:03:30 am)
        const ampmMatch = trimmed.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?\s*([ap]m)$/i);
        if (ampmMatch) {
            let [ , h, m, s, period ] = ampmMatch;
            h = parseInt(h, 10);
            if (period.toLowerCase() === 'pm' && h !== 12) h += 12;
            if (period.toLowerCase() === 'am' && h === 12) h = 0;
            return `${String(h).padStart(2, '0')}:${m}:${(s || '00').padStart(2, '0')}`;
        }

        // Handle 24-hour HH:MM or HH:MM:SS
        if (/^\d{1,2}:\d{2}(:\d{2})?$/.test(trimmed)) {
            const [h, m, s] = trimmed.split(':');
            return `${h.padStart(2, '0')}:${(m || '00').padStart(2, '0')}:${(s || '00').padStart(2, '0')}`;
        }
    }

    // Fallback: attempt Date parsing
    try {
        const d = new Date(value);
        if (isNaN(d)) return null;
        return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}:${String(d.getSeconds()).padStart(2, '0')}`;
    } catch (_) {
        return null;
    }
};

/**
 * Normalize time AM PM
 */

const formatTimeAMPM = (value, timeZone = 'Asia/Kolkata') => {
    if (!value) return null;
    try {
        const d = new Date(value);
        if (isNaN(d)) return null;

        return new Intl.DateTimeFormat('en-US', {
            hour: 'numeric',
            minute: '2-digit',
            hour12: true,
            timeZone
        }).format(d);  
    } catch (_) {
        return null;
    }
};



/**
 * Normalize value based on field type
 * @param {string} table - Table name
 * @param {string} field - Field name
 * @param {*} value - Value to normalize
 * @param {Object} fieldTypeHints - Field type hints (optional, from config)
 * @returns {*} Normalized value
 */
const normalizeValue = (table, field, value, fieldTypeHints = {}) => {
    // Accept both nested {table:{field:type}} and flat {field:type}
    const type = (fieldTypeHints[table] && fieldTypeHints[table][field]) || fieldTypeHints[field] || null;
    if (!type) return value;
    
    if (type === 'date') {
        const d = normalizeDateLocal(value);
        return d; // YYYY-MM-DD for DATE column
    }
    if (type === 'datetime') {
        const d = normalizeDateLocal(value);
        return d ? `${d} 00:00:00` : null; // midnight local for DATETIME
    }
    if (type === 'time') {
        return normalizeTime(value);
    }
    return value;
};

/**
 * Check if path is an image
 * @param {*} value - Value to check
 * @returns {boolean}
 */
const isImagePath = (value) => {
    if (!value || typeof value !== 'string') return false;
    const p = value.toLowerCase();
    return p.endsWith('.png') || p.endsWith('.jpg') || p.endsWith('.jpeg') || 
           p.endsWith('.webp') || p.endsWith('.gif');
};

/**
 * Check if path is a PDF
 * @param {*} value - Value to check
 * @returns {boolean}
 */
const isPdfPath = (value) => {
    return typeof value === 'string' && value.toLowerCase().endsWith('.pdf');
};

/**
 * Normalize file path (convert backslashes to forward slashes)
 * @param {*} value - Path value
 * @returns {*} Normalized path
 */
const normalizePath = (value) => {
    if (typeof value !== 'string') return value;
    return value.replace(/\\/g, '/');
};

/*
Normalize date DD MM YYYY
*/

const formatDateDDMMYYYY = (value, timeZone = 'Asia/Kolkata') => {
    if (!value) return null;
    try {
        const d = new Date(value);
        if (isNaN(d)) return null;

        const parts = new Intl.DateTimeFormat('en-GB', {
            day: '2-digit',
            month: '2-digit',
            year: 'numeric',
            timeZone
        }).formatToParts(d);

        const dd = parts.find(p => p.type === 'day')?.value;
        const mm = parts.find(p => p.type === 'month')?.value;
        const yyyy = parts.find(p => p.type === 'year')?.value;

        return `${dd}-${mm}-${yyyy}`;
    } catch (_) {
        return null;
    }
};


module.exports = {
    isEmpty,
    isEmptyArray,
    isEmptyLike,
    normalizeDate,
    normalizeDateLocal,
    normalizeTime,
    normalizeValue,
    isImagePath,
    isPdfPath,
    normalizePath,
    formatTimeAMPM,
    formatDateDDMMYYYY
};
