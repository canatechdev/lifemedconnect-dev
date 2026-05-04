/**
 * App Auth Routes (Technician-focused)
 * No CSRF, long-lived JWT (7d), OTP-based password reset
 */

const express = require('express');
const router = express.Router();
const ApiResponse = require('../../lib/response');
const logger = require('../../lib/logger');
const authService = require('../../services/app/authService');
const { verifyToken, verifyTokenOptional } = require('../../lib/auth');

// Login (technician)
router.post('/auth/login', async (req, res) => {
    try {
        const { username, password } = req.body;
        if (!username || !password) {
            return ApiResponse.appError(res, 'Username and password are required', 400);
        }

        const result = await authService.login({ username, password });
        if (!result.success) {
            return ApiResponse.appError(res, result.message || 'Login failed', 401);
        }

        return ApiResponse.appSuccess(res, 'Login successful', result);
    } catch (error) {
        logger.error('App login error', { error: error.message });
        return ApiResponse.appError(res, 'Internal server error', 500);
    }
});



// Request OTP (generic; for now used for password reset)
router.post('/auth/request-otp', verifyTokenOptional, async (req, res) => {
    try {
        const { username } = req.body;
        const userId = req.user?.id;
        if (!userId && !username) {
            return ApiResponse.appError(res, 'Username is required when not authenticated', 400);
        }

        const ipAddress = req.ip || req.connection.remoteAddress;
        const result = await authService.requestOtp({ username, userId, ipAddress });
        if (!result.success) {
            return ApiResponse.appError(res, result.message || 'Request failed', 400);
        }

        return ApiResponse.appSuccess(res, result.message || 'OTP sent to registered email', {
            masked_email: result.masked_email,
            ...(result.otp_dev && { otp_dev: result.otp_dev }) // only in development
        });
    } catch (error) {
        logger.error('App forgot-password error', { error: error.message });
        return ApiResponse.appError(res, 'Internal server error', 500);
    }
});

// Verify OTP + reset password
router.post('/auth/reset-password', async (req, res) => {
    try {
        const { username, otp, new_password } = req.body;
        const userId = req.user?.id;
        if ((!userId && !username) || !otp || !new_password) {
            return ApiResponse.appError(res, 'Username (if not authenticated), OTP, and new password are required', 400);
        }

        const result = await authService.resetPasswordWithOtp({ username, userId, otp, newPassword: new_password });
        if (!result.success) {
            return ApiResponse.appError(res, result.message || 'Reset failed', 400);
        }

        return ApiResponse.appSuccess(res, { success: true }, 'Password reset successful');
    } catch (error) {
        logger.error('App reset-password error', { error: error.message });
        return ApiResponse.appError(res, 'Internal server error', 500);
    }
});


// Change password (requires token)
router.post('/auth/change-password', verifyToken, async (req, res) => {
    try {
        const { old_password, new_password } = req.body;
        if (!old_password || !new_password) {
            return ApiResponse.appError(res, 'Old and new passwords are required', 400);
        }

        const result = await authService.changePassword({
            userId: req.user.id,
            oldPassword: old_password,
            newPassword: new_password
        });

        if (!result.success) {
            return ApiResponse.appError(res, result.message || 'Change password failed', 400);
        }

        return ApiResponse.appSuccess(res, 'Password changed successfully');
    } catch (error) {
        logger.error('App change-password error', { error: error.message });
        return ApiResponse.appError(res, 'Internal server error', 500);
    }
});


module.exports = router;
