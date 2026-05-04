/**
 * Application constants
 */

// User roles
const ROLES = {
    ADMIN: 1,
    TPA: 2,
    CENTER: 3,
    CUSTOM: 4
};

// HTTP status codes
const HTTP_STATUS = {
    OK: 200,
    CREATED: 201,
    BAD_REQUEST: 400,
    UNAUTHORIZED: 401,
    FORBIDDEN: 403,
    NOT_FOUND: 404,
    CONFLICT: 409,
    INTERNAL_SERVER_ERROR: 500
};

// Response status
const RESPONSE_STATUS = {
    SUCCESS: 'success',
    ERROR: 'error'
};

// File upload limits
const FILE_LIMITS = {
    IMAGE_MAX_SIZE: 5 * 1024 * 1024, // 5MB
    PDF_MAX_SIZE: 10 * 1024 * 1024, // 10MB
    EXCEL_MAX_SIZE: 5 * 1024 * 1024 // 5MB
};

// Allowed file types
const ALLOWED_FILE_TYPES = {
    IMAGES: ['image/jpeg', 'image/jpg', 'image/png', 'image/gif', 'image/webp'],
    DOCUMENTS: ['application/pdf'],
    EXCEL: ['.xls', '.xlsx', '.csv']
};

// Pagination defaults
const PAGINATION = {
    DEFAULT_PAGE: 1,
    DEFAULT_LIMIT: 10,
    MAX_LIMIT: 100
};

// Date formats
const DATE_FORMATS = {
    DATABASE: 'YYYY-MM-DD',
    DATETIME: 'YYYY-MM-DD HH:mm:ss',
    DISPLAY: 'DD/MM/YYYY'
};

module.exports = {
    ROLES,
    HTTP_STATUS,
    RESPONSE_STATUS,
    FILE_LIMITS,
    ALLOWED_FILE_TYPES,
    PAGINATION,
    DATE_FORMATS
};
