/**
 * Helper utility functions
 */

/**
 * Sanitize SQL LIKE pattern to prevent SQL injection
 * @param {string} pattern - Pattern to sanitize
 * @returns {string} Sanitized pattern
 */
const sanitizeLikePattern = (pattern) => {
    return pattern.replace(/[%_\\]/g, '\\$&');
};

/**
 * Build dynamic WHERE clause for search
 * @param {Array<string>} columns - Columns to search
 * @param {string} searchTerm - Search term
 * @returns {Object} Object with whereClause and params
 */
const buildSearchClause = (columns, searchTerm) => {
    if (!searchTerm || !searchTerm.trim()) {
        return { whereClause: '', params: [] };
    }

    const searchConditions = columns.map(col => `${col} LIKE ?`).join(' OR ');
    const whereClause = ` AND (${searchConditions})`;
    const params = columns.map(() => `%${searchTerm}%`);

    return { whereClause, params };
};

/**
 * Validate sort parameters to prevent SQL injection
 * @param {string} sortBy - Column to sort by
 * @param {string} sortOrder - Sort order (ASC/DESC)
 * @param {Array<string>} allowedColumns - Allowed columns for sorting
 * @returns {Object} Validated sort parameters
 */
const validateSortParams = (sortBy, sortOrder, allowedColumns) => {
    // Ensure allowedColumns is an array
    if (!allowedColumns || !Array.isArray(allowedColumns) || allowedColumns.length === 0) {
        allowedColumns = ['id']; // Default to id if no columns specified
    }
    
    const validSortBy = allowedColumns.includes(sortBy) ? sortBy : allowedColumns[0];
    const validSortOrder = sortOrder.toUpperCase() === 'ASC' ? 'ASC' : 'DESC';
    
    return { validSortBy, validSortOrder };
};

/**
 * Calculate pagination metadata
 * @param {number} total - Total number of records
 * @param {number} page - Current page
 * @param {number} limit - Records per page
 * @returns {Object} Pagination metadata
 */
const calculatePagination = (total, page, limit) => {
    const totalPages = limit > 0 ? Math.ceil(total / limit) : 1;
    
    return {
        total,
        page: parseInt(page),
        limit: parseInt(limit),
        pages: totalPages,
        hasNext: page < totalPages,
        hasPrev: page > 1
    };
};

/**
 * Generate unique filename
 * @param {string} originalName - Original filename
 * @param {string} extension - File extension (optional)
 * @returns {string} Unique filename
 */
const generateUniqueFilename = (originalName, extension = null) => {
    const timestamp = Date.now();
    const random = Math.round(Math.random() * 1e9);
    const ext = extension || originalName.split('.').pop();
    
    return `${timestamp}-${random}.${ext}`;
};

/**
 * Parse pagination parameters from query
 * @param {Object} query - Express request query object
 * @returns {Object} Parsed pagination parameters
 */
const parsePaginationParams = (query) => {
    const page = parseInt(query.page) || 1;
    // Default limit to 0 when not provided so APIs can return ALL rows
    // (BaseService treats falsy limit as "no pagination")
    const limit = query.limit !== undefined ? parseInt(query.limit) || 0 : 0;
    const search = query.q || query.search || '';
    const sortBy = query.sortBy || 'id';
    const sortOrder = query.sortOrder || 'DESC';

    return { page, limit, search, sortBy, sortOrder };
};

/**
 * Format date for database
 * @param {Date|string} date - Date to format
 * @returns {string} Formatted date string
 */
const formatDateForDB = (date) => {
    if (!date) return null;
    
    const d = new Date(date);
    if (isNaN(d.getTime())) return null;
    
    return d.toISOString().split('T')[0];
};

/**
 * Check if value is empty (null, undefined, empty string)
 * @param {*} value - Value to check
 * @returns {boolean} True if empty
 */
const isEmpty = (value) => {
    return value === null || value === undefined || value === '';
};

/**
 * Remove undefined and null values from object
 * @param {Object} obj - Object to clean
 * @returns {Object} Cleaned object
 */
const cleanObject = (obj) => {
    return Object.entries(obj).reduce((acc, [key, value]) => {
        if (value !== undefined && value !== null) {
            acc[key] = value;
        }
        return acc;
    }, {});
};

module.exports = {
    sanitizeLikePattern,
    buildSearchClause,
    validateSortParams,
    calculatePagination,
    generateUniqueFilename,
    parsePaginationParams,
    formatDateForDB,
    isEmpty,
    cleanObject
};
