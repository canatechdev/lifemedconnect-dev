/**
 * Standardized API response utilities
 */

class ApiResponse {

    // ==================== STANDARD RESPONSES (for Web/Admin APIs) ====================


    /**
     * Success response
     * @param {Object} res - Express response object
     * @param {*} data - Response data
     * @param {String} message - Success message
     * @param {Number} statusCode - HTTP status code (default: 200)
     */
    static success(res, data = null, message = 'Success', statusCode = 200) {
        return res.status(statusCode).json({
            status: 'success',
            message,
            data
        });
    }

    /**
     * Error response
     * @param {Object} res - Express response object
     * @param {String} message - Error message
     * @param {Number} statusCode - HTTP status code (default: 500)
     * @param {*} errors - Additional error details
     */
    static error(res, message = 'Internal server error', statusCode = 500, errors = null) {
        const response = {
            status: 'error',
            message
        };

        if (errors) {
            response.errors = errors;
        }

        return res.status(statusCode).json(response);
    }

    /**
     * Validation error response
     * @param {Object} res - Express response object
     * @param {*} errors - Validation errors
     * @param {String} message - Error message
     */
    static validationError(res, errors, message = 'Validation failed') {
        return res.status(400).json({
            status: 'error',
            message,
            errors
        });
    }

    /**
     * Not found response
     * @param {Object} res - Express response object
     * @param {String} message - Not found message
     */
    static notFound(res, message = 'Resource not found') {
        return res.status(404).json({
            status: 'error',
            message
        });
    }

    /**
     * Unauthorized response
     * @param {Object} res - Express response object
     * @param {String} message - Unauthorized message
     */
    static unauthorized(res, message = 'Unauthorized access') {
        return res.status(401).json({
            status: 'error',
            message
        });
    }

    /**
     * Forbidden response
     * @param {Object} res - Express response object
     * @param {String} message - Forbidden message
     */
    static forbidden(res, message = 'Access forbidden') {
        return res.status(403).json({
            status: 'error',
            message
        });
    }

    /**
     * Conflict response
     * @param {Object} res - Express response object
     * @param {String} message - Conflict message
     */
    static conflict(res, message = 'Resource conflict') {
        return res.status(409).json({
            status: 'error',
            message
        });
    }

    /**
     * Paginated response
     * @param {Object} res - Express response object
     * @param {Array} data - Array of data
     * @param {Object} pagination - Pagination metadata
     * @param {String} message - Success message
     */
    static paginated(res, data, pagination, message = 'Success') {
        return res.status(200).json({
            status: 'success',
            message,
            data,
            pagination
        });
    }





    // ==================== MOBILE APP SPECIFIC RESPONSES (Technician App) ====================

    /**
     * Success response for mobile technician app
     * Matches the legacy format expected by the mobile client:
     * - "message" contains the actual payload object
     * - "data" contains the human-readable success message
     */
    static appSuccess(res, payload = {}, message = 'Success', statusCode = 200) {
        return res.status(statusCode).json({
            status: 'success',
            message: payload,
            data: message
        });
    }

    /**
     * Error response for mobile technician app (consistent with appSuccess format)
     */
    static appError(res, errorMessage = 'An error occurred', statusCode = 400, errors = null) {
        const payload = {
            success: false,
            error: errorMessage
        };
        if (errors) payload.errors = errors;

        return res.status(statusCode).json({
            status: 'error',
            message: errorMessage,
        });
    }



}

module.exports = ApiResponse;
