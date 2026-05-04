/**
 * User Entity Handler
 * Handles user-specific approval logic including password hashing
 */

const BaseEntityHandler = require('./BaseEntityHandler');
const logger = require('../../../lib/logger');

class UserHandler extends BaseEntityHandler {
    constructor() {
        super('user', 'users');
    }

    /**
     * Handle user update with password hashing
     * @param {Object} connection - Database connection
     * @param {number} entityId - User ID
     * @param {Object} newData - New data to apply
     * @param {Object} context - Additional context
     * @returns {Promise<void>}
     */
    async update(connection, entityId, newData, context = {}) {
        // Handle password updates
        if (Object.prototype.hasOwnProperty.call(newData, 'password')) {
            await this.updatePassword(connection, entityId, newData.password);
        }
    }

    /**
     * Update user password with hashing
     * @param {Object} connection - Database connection
     * @param {number} entityId - User ID
     * @param {string} password - Plain text password
     * @returns {Promise<void>}
     */
    async updatePassword(connection, entityId, password) {
        if (password && typeof password === 'string' && password.trim() !== '') {
            // Import hashPassword function
            const { hashPassword } = require('../../../lib/auth');
            const hashedPassword = await hashPassword(password);
            
            await connection.execute(
                'UPDATE users SET password_hash = ?, updated_at = NOW() WHERE id = ?',
                [hashedPassword, entityId]
            );

            logger.info('User password updated', { entityId });
        }
    }
}

module.exports = UserHandler;
