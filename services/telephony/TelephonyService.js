/**
 * Telephony Service
 * Handles integration with SparkTG Cloud Telephony System
 * Supports manual calling, call logging, and webhook processing
 */

const axios = require('axios');
const logger = require('../../lib/logger');
const { query } = require('../../lib/dbconnection');

class TelephonyService {
    constructor() {
        this.baseURL = process.env.TELEPHONY_BASE_URL || 'https://telephonycloud.co.in/api/v1';
        this.username = process.env.TELEPHONY_USERNAME;
        this.password = process.env.TELEPHONY_PASSWORD;
        this.defaultServiceId = process.env.TELEPHONY_SERVICE_ID;
        this.defaultApiToken = process.env.TELEPHONY_API_TOKEN;
    }

    /**
     * Get telephony configuration for a diagnostic center
     */
    async getCenterTelephonyConfig(centerId) {
        try {
            const sql = `
                SELECT 
                    id,
                    center_name,
                    telephony_enabled,
                    telephony_agent_number,
                    telephony_service_id,
                    telephony_config,
                    contact_number
                FROM diagnostic_centers
                WHERE id = ? AND is_deleted = 0
            `;
            
            const [center] = await query(sql, [centerId]);
            
            if (!center) {
                throw new Error('Diagnostic center not found');
            }

            // If telephony_enabled is false but env credentials exist, allow call with warning
            if (!center.telephony_enabled && (!this.username || !this.password)) {
                throw new Error('Telephony is not enabled for this center');
            }

            return {
                centerId: center.id,
                centerName: center.center_name,
                agentNumber: center.telephony_agent_number || center.contact_number,
                serviceId: center.telephony_service_id || this.defaultServiceId,
                config: center.telephony_config ? JSON.parse(center.telephony_config) : {}
            };
        } catch (error) {
            logger.error('Error getting center telephony config:', error);
            throw error;
        }
    }

    /**
     * Make an outbound call to agent's MOBILE phone
     * @param {Object} params - Call parameters
     * @param {number} params.appointmentId - Appointment ID
     * @param {number} params.centerId - Diagnostic center ID
     * @param {string} params.customerNumber - Customer phone number
     * @param {number} params.userId - User initiating the call
     * @param {string} params.notes - Optional notes
     * @param {string} params.userTelephonyUsername - User's telephony username (optional, falls back to env)
     * @param {string} params.userTelephonyPassword - User's telephony password (optional, falls back to env)
     */
    async makeCallMobile({ appointmentId, centerId, customerNumber, userId, notes = null, userTelephonyUsername = null, userTelephonyPassword = null }) {
        // Initialize variables at function level for error handling access
        let apiParams = {};
        let attemptId = null;
        
        try {
            // Get center telephony configuration
            const centerConfig = await this.getCenterTelephonyConfig(centerId);

            // Validate customer number
            if (!customerNumber || customerNumber.length < 10) {
                throw new Error('Invalid customer phone number');
            }

            // Clean phone number (remove spaces, dashes, etc.)
            let cleanNumber = customerNumber.replace(/[^\d]/g, '');
            // Add country code if not present and number is 10 digits
            if (cleanNumber.length === 10 && !cleanNumber.startsWith('91')) {
                cleanNumber = '91' + cleanNumber;
            }

            // Create call attempt record (store agent_number for webhook matching)
            const attemptSql = `
                INSERT INTO call_attempts (
                    appointment_id,
                    center_id,
                    customer_number,
                    agent_number,
                    attempt_type,
                    attempt_status,
                    attempted_by,
                    attempted_at,
                    notes
                ) VALUES (?, ?, ?, ?, 'manual', 'initiated', ?, NOW(), ?)
            `;

            // Normalize agent number for storage (digits only)
            const agentNumberStored = centerConfig.agentNumber
                ? centerConfig.agentNumber.replace(/[^0-9]/g, '')
                : null;

            const attemptResult = await query(attemptSql, [
                appointmentId,
                centerId,
                cleanNumber,
                agentNumberStored,
                userId,
                notes
            ]);

            const attemptId = attemptResult.insertId;

            // Prepare API request for MOBILE calling
            // Include agent-number to route call to agent's mobile phone
            let agentNumber = centerConfig.agentNumber;
            
            // If no agent number configured or it's a problematic number, use telephony username as fallback
            if (!agentNumber || agentNumber === '9989898989' || agentNumber === '9325066870') {
                agentNumber = userTelephonyUsername || this.username;
                logger.info('Using telephony username as agent number fallback', {
                    originalAgentNumber: centerConfig.agentNumber,
                    fallbackAgentNumber: agentNumber,
                    reason: agentNumber === '9989898989' ? 'dev problematic number' : 
                            agentNumber === '9325066870' ? 'prod problematic number' : 'no agent number'
                });
            }
            
            // Clean agent number and add country code without + prefix
            if (agentNumber) {
                agentNumber = agentNumber.replace(/[^\d]/g, ''); // Remove non-digits
                if (agentNumber.length === 10 && !agentNumber.startsWith('91')) {
                    agentNumber = '91' + agentNumber;
                }
            }
            
            // Assign apiParams with processed values
            apiParams = {
                number: cleanNumber,
                'agent-number': agentNumber, // Route to mobile without + prefix
                recording: true, // Enable call recording
                'agent-dial-first': false // Dial customer first
            };
            
            // Include service-id only if provided
            if (centerConfig.serviceId) {
                apiParams['service-id'] = centerConfig.serviceId;
            }

            logger.info('Initiating MOBILE call via SparkTG API', {
                appointmentId,
                centerId,
                customerNumber: cleanNumber,
                agentNumber: centerConfig.agentNumber,
                attemptId,
                callType: 'mobile',
                apiParams: apiParams,
                baseURL: this.baseURL
            });

            // Make API call to SparkTG
            // Build auth header using Basic Auth (username:password)
            // Prioritize user credentials over env variables
            const username = userTelephonyUsername || this.username;
            const password = userTelephonyPassword || this.password;
            
            const headers = {};
            if (username && password) {
                const basic = Buffer.from(`${username}:${password}`).toString('base64');
                headers.Authorization = `Basic ${basic}`;
                logger.info('Using telephony credentials', { 
                    source: userTelephonyUsername ? 'user' : 'env',
                    username: username 
                });
            } else {
                throw new Error('Telephony credentials not configured');
            }

            logger.debug('[TELEPHONY] Making HTTP request to SparkTG', {
                url: `${this.baseURL}/calls`,
                method: 'POST',
                params: apiParams,
                hasAuth: !!headers.Authorization
            });

            const response = await axios.post(
                `${this.baseURL}/calls`,
                null,
                {
                    params: apiParams,
                    headers
                }
            );

            logger.info('SparkTG API response', {
                status: response.status,
                data: response.data,
                attemptId
            });

            // Update call attempt status
            await query(
                `UPDATE call_attempts 
                 SET attempt_status = 'in_progress' 
                 WHERE id = ?`,
                [attemptId]
            );

            // Update appointment last call attempt
            await query(
                `UPDATE appointments 
                 SET last_call_attempt_at = NOW(),
                     total_call_attempts = total_call_attempts + 1
                 WHERE id = ?`,
                [appointmentId]
            );

            // Extract call ID from response and save as ongoing call
            const callId = response.data?.callid || response.data?.call_id || response.data?.id;
            
            logger.info('Checking for call ID in SparkTG response', {
                callId,
                responseData: response.data
            });
            
            if (callId) {
                try {
                    // Update call_attempts with call_id
                    await query(
                        'UPDATE call_attempts SET call_id = ? WHERE id = ?',
                        [callId, attemptId]
                    );
                    
                    // Save to ongoing_calls table
                    await query(
                        `INSERT INTO ongoing_calls (
                            call_id, appointment_id, center_id, 
                            agent_number, customer_number, call_type,
                            created_by, created_at
                        ) VALUES (?, ?, ?, ?, ?, ?, ?, NOW())
                        ON DUPLICATE KEY UPDATE updated_at = NOW()`,
                        [
                            callId,
                            appointmentId,
                            centerId,
                            agentNumber || null,
                            customerNumber,
                            'outgoing',
                            userId
                        ]
                    );
                    
                    logger.info('Call ID saved successfully', { 
                        callId, 
                        attemptId,
                        appointmentId,
                        agentNumber,
                        customerNumber
                    });
                } catch (dbError) {
                    logger.error('Failed to save call ID', {
                        error: dbError.message,
                        callId,
                        appointmentId,
                        attemptId
                    });
                }
            } else {
                logger.warn('No call ID found in SparkTG response', {
                    response: response.data
                });
            }

            logger.info('Call initiated successfully', {
                appointmentId,
                attemptId,
                callId,
                response: response.data
            });

            return {
                success: true,
                attemptId,
                callId,
                message: 'Call initiated successfully',
                data: response.data
            };

        } catch (error) {
            logger.error('Error making call:', {
                appointmentId,
                centerId,
                error: error.message,
                stack: error.stack,
                axiosError: error.response ? {
                    status: error.response.status,
                    statusText: error.response.statusText,
                    data: error.response.data,
                    headers: error.response.headers
                } : 'No axios response',
                apiParams: apiParams,
                baseURL: this.baseURL
            });

            // Update attempt status to failed if we have attemptId
            if (attemptId) {
                await query(
                    `UPDATE call_attempts 
                     SET attempt_status = 'failed', 
                         error_message = ? 
                     WHERE id = ?`,
                    [error.message, attemptId]
                ).catch(err => logger.error('Failed to update attempt status:', err));
            }

            throw {
                success: false,
                message: 'Failed to initiate call',
                error: error.message,
                isAuthError: error.response?.status === 401
            };
        }
    }

    /**
     * Make an outbound call to agent's BROWSER/WebRTC (via WireGuard)
     * @param {Object} params - Call parameters
     * @param {number} params.appointmentId - Appointment ID
     * @param {number} params.centerId - Diagnostic center ID
     * @param {string} params.customerNumber - Customer phone number
     * @param {number} params.userId - User initiating the call
     * @param {string} params.notes - Optional notes
     * @param {string} params.userTelephonyUsername - User's telephony username (optional, falls back to env)
     * @param {string} params.userTelephonyPassword - User's telephony password (optional, falls back to env)
     */
    async makeCallBrowser({ appointmentId, centerId, customerNumber, userId, notes = null, userTelephonyUsername = null, userTelephonyPassword = null }) {
        logger.info('[TELEPHONY] BROWSER CALL INITIATED', { 
            appointmentId, 
            centerId, 
            customerNumber, 
            userId, 
            notes,
            timestamp: new Date().toISOString(),
            flow: 'makeCallBrowser'
        });

        try {
            // Get center telephony configuration
            logger.debug('[TELEPHONY] Fetching center configuration', { centerId });
            const centerConfig = await this.getCenterTelephonyConfig(centerId);
            logger.debug('[TELEPHONY] Center config retrieved', { 
                hasConfig: !!centerConfig,
                serviceId: centerConfig?.service_id,
                hasCredentials: !!(centerConfig?.username || centerConfig?.api_token)
            });

            // Validate customer number
            if (!customerNumber || customerNumber.length < 10) {
                throw new Error('Invalid customer phone number');
            }

            // Clean phone number (remove spaces, dashes, etc.)
            const cleanNumber = customerNumber.replace(/[^\d]/g, '');

            // Create call attempt record
            const attemptSql = `
                INSERT INTO call_attempts (
                    appointment_id,
                    center_id,
                    customer_number,
                    attempt_type,
                    attempt_status,
                    attempted_by,
                    attempted_at,
                    notes
                ) VALUES (?, ?, ?, 'manual', 'initiated', ?, NOW(), ?)
            `;

            const attemptResult = await query(attemptSql, [
                appointmentId,
                centerId,
                cleanNumber,
                userId,
                notes
            ]);

            const attemptId = attemptResult.insertId;
            logger.info('[TELEPHONY] Call attempt created', { attemptId });

            // Prepare API request for BROWSER/WebRTC calling
            // Do NOT include agent-number to force WebRTC routing
            const apiParams = {
                number: cleanNumber,
                param1: `appointment_${appointmentId}`, // Track appointment in webhook
                recording: true, // Enable call recording
                'agent-dial-first': false // Dial customer first
            };

            // Include service-id only if provided
            if (centerConfig.serviceId) {
                apiParams['service-id'] = centerConfig.serviceId;
            }

            logger.info('[TELEPHONY] Calling SparkTG API', {
                appointmentId,
                centerId,
                customerNumber: cleanNumber,
                attemptId,
                callType: 'browser',
                apiParams,
                baseURL: this.baseURL
            });

            // Make API call to SparkTG
            // Build auth header using Basic Auth (username:password)
            // Prioritize user credentials over env variables
            const username = userTelephonyUsername || this.username;
            const password = userTelephonyPassword || this.password;
            
            const headers = {};
            if (username && password) {
                const basic = Buffer.from(`${username}:${password}`).toString('base64');
                headers.Authorization = `Basic ${basic}`;
                logger.info('Using telephony credentials', { 
                    source: userTelephonyUsername ? 'user' : 'env',
                    username: username 
                });
            } else {
                throw new Error('Telephony credentials not configured');
            }

            logger.debug('[TELEPHONY] Making HTTP request to SparkTG', {
                url: `${this.baseURL}/calls`,
                method: 'POST',
                params: apiParams,
                hasAuth: !!headers.Authorization
            });

            const response = await axios.post(
                `${this.baseURL}/calls`,
                null,
                {
                    params: apiParams,
                    headers
                }
            );

            logger.info('[TELEPHONY] SparkTG API response received', {
                status: response.status,
                statusText: response.statusText,
                data: response.data,
                attemptId
            });

            // Update call attempt status
            await query(
                `UPDATE call_attempts 
                 SET attempt_status = 'in_progress' 
                 WHERE id = ?`,
                [attemptId]
            );
            logger.debug('[TELEPHONY] Call attempt status updated to in_progress', { attemptId });

            // Update appointment last call attempt
            await query(
                `UPDATE appointments 
                 SET last_call_attempt_at = NOW(),
                     total_call_attempts = total_call_attempts + 1
                 WHERE id = ?`,
                [appointmentId]
            );
            logger.debug('[TELEPHONY] Appointment call attempt updated', { appointmentId });

            // Extract call ID from response and save as ongoing call
            const callId = response.data?.callid || response.data?.call_id || response.data?.id;
            
            logger.info('[TELEPHONY] Processing call ID from response', {
                callId,
                responseData: response.data,
                attemptId
            });
            
            if (callId) {
                try {
                    // Update call_attempts with call_id
                    await query(
                        'UPDATE call_attempts SET call_id = ? WHERE id = ?',
                        [callId, attemptId]
                    );
                    
                    // Save to ongoing_calls table
                    logger.debug('[TELEPHONY] Inserting into ongoing_calls', { callId, appointmentId });
                    await query(
                        `INSERT INTO ongoing_calls (
                            call_id, appointment_id, center_id, 
                            agent_number, customer_number, call_type,
                            created_by, created_at
                        ) VALUES (?, ?, ?, ?, ?, ?, ?, NOW())
                        ON DUPLICATE KEY UPDATE updated_at = NOW()`,
                        [
                            callId,
                            appointmentId,
                            centerId,
                            null, // Browser calls don't have agent number
                            customerNumber,
                            'outgoing',
                            userId
                        ]
                    );
                    
                    logger.info('[TELEPHONY] Call ID saved to ongoing_calls', { 
                        callId, 
                        attemptId,
                        appointmentId,
                        customerNumber,
                        callType: 'browser'
                    });
                } catch (dbError) {
                    logger.error('[TELEPHONY] Failed to save call ID to ongoing_calls', {
                        error: dbError.message,
                        stack: dbError.stack,
                        callId,
                        appointmentId,
                        attemptId,
                        userId
                    });
                }
            } else {
                logger.warn('No call ID found in browser call response', {
                    response: response.data
                });
            }

            logger.info('[TELEPHONY] BROWSER CALL SUCCESS', {
                appointmentId,
                attemptId,
                callId,
                customerNumber,
                response: response.data,
                timestamp: new Date().toISOString()
            });

            return {
                success: true,
                attemptId,
                callId,
                message: 'Call initiated successfully',
                data: response.data
            };

        } catch (error) {
            // Handle authentication errors specifically
            let errorMessage = 'Failed to initiate call';
            let errorDetails = error.message;
            
            if (error.response?.status === 401) {
                errorMessage = 'Telephony authentication failed - Invalid credentials';
                errorDetails = error.response?.data || 'Bad credentials';
                
                logger.error('[TELEPHONY] AUTHENTICATION ERROR', {
                    appointmentId,
                    centerId,
                    customerNumber,
                    userId,
                    credentialSource: userTelephonyUsername ? 'user' : 'environment',
                    username: userTelephonyUsername || this.username,
                    error: error.message,
                    response: error.response?.data,
                    status: error.response?.status,
                    timestamp: new Date().toISOString(),
                    flow: 'makeCallBrowser'
                });
            } else {
                logger.error('[TELEPHONY] BROWSER CALL FAILED', {
                    appointmentId,
                    centerId,
                    customerNumber,
                    userId,
                    error: error.message,
                    stack: error.stack,
                    response: error.response?.data,
                    status: error.response?.status,
                    timestamp: new Date().toISOString(),
                    flow: 'makeCallBrowser'
                });
            }

            // Update attempt status to failed if we have attemptId
            if (error.attemptId) {
                await query(
                    `UPDATE call_attempts 
                     SET attempt_status = 'failed' 
                     WHERE id = ?`,
                    [error.attemptId]
                ).catch(err => logger.error('Failed to update attempt status:', err));
            }

            throw {
                success: false,
                message: errorMessage,
                error: errorDetails,
                isAuthError: error.response?.status === 401
            };
        }
    }

    /**
     * Process webhook data from telephony system
     * Can be called multiple times for the same call (ongoing updates)
     */
    async processCallWebhook(webhookData) {
        try {
            logger.info('Processing call webhook', { callId: webhookData.callid });

            // Get appointment and center IDs from call_attempts table
            let appointmentId = null;
            let centerId = null;

            // First try to find by call_id if we have any attempts with that call_id
            const [attemptByCallId] = await query(
                'SELECT appointment_id, center_id FROM call_attempts WHERE call_id = ? LIMIT 1',
                [webhookData.callid]
            );
            
            if (attemptByCallId) {
                appointmentId = attemptByCallId.appointment_id;
                centerId = attemptByCallId.center_id;
                logger.info('Found attempt by call_id', { callId: webhookData.callid, appointmentId, centerId });
            } else {
                // Fallback: recent attempt by appointment (order by created_at) — no agent_number dependency
                const [recentAttempt] = await query(
                    `SELECT ca.appointment_id, ca.center_id
                     FROM call_attempts ca
                     WHERE ca.attempt_status IN ('initiated', 'in_progress')
                     ORDER BY ca.created_at DESC
                     LIMIT 1`
                );

                if (recentAttempt) {
                    appointmentId = recentAttempt.appointment_id;
                    centerId = recentAttempt.center_id;
                    logger.info('Found recent attempt (fallback)', { appointmentId, centerId });
                }
            }

            // Check if call log already exists
            const [existingCall] = await query(
                'SELECT id FROM call_logs WHERE call_id = ?',
                [webhookData.callid]
            );

            let callLogId;
            const disposition = webhookData.disposition || 'missed';
            const hasEndTime = webhookData['end-time'] && webhookData['end-time'] !== '';

            if (existingCall) {
                // Update existing call log
                // If call is answered and no end_time, it's an ongoing call
                // If call has end_time or disposition is not answered, it's completed
                const updateSql = `
                    UPDATE call_logs SET
                        disposition = ?,
                        call_duration = ?,
                        recording_url = ?,
                        end_time = ?,
                        received_by = ?,
                        transferred_to = ?,
                        handle_time = ?,
                        hold_time = ?,
                        hangup_by = ?,
                        metadata = ?,
                        updated_at = NOW()
                    WHERE call_id = ?
                `;

                const updateValues = [
                    disposition,
                    parseInt(webhookData['call-duration']) || 0,
                    webhookData['recording-url'] || null,
                    hasEndTime ? new Date(webhookData['end-time']) : null,
                    webhookData['received-by'] || null,
                    webhookData['transfered-to'] || null,
                    webhookData['handle-time'] ? parseInt(webhookData['handle-time']) : null,
                    webhookData['hold-time'] ? parseInt(webhookData['hold-time']) : null,
                    webhookData['hangup-by'] || null,
                    JSON.stringify(webhookData),
                    webhookData.callid
                ];

                await query(updateSql, updateValues);
                callLogId = existingCall.id;
            } else {
                // Insert new call log
                // If disposition is 'answered' and no end_time, it's an ongoing call
                const safe = (v) => v ?? null;

                const callLogSql = `
                    INSERT INTO call_logs (
                        call_id,
                        appointment_id,
                        center_id,
                        call_type,
                        disposition,
                        call_duration,
                        agent_number,
                        customer_number,
                        virtual_number,
                        recording_url,
                        start_time,
                        end_time,
                        received_by,
                        transferred_to,
                        handle_time,
                        hold_time,
                        hangup_by,
                        service_id,
                        skill_id,
                        ivr_inputs,
                        custom_param,
                        metadata
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                `;

                const callLogValues = [
                    safe(webhookData.callid),
                    safe(appointmentId),
                    safe(centerId),
                    safe(webhookData['call-type'] || 'outgoing'),
                    safe(disposition),
                    parseInt(webhookData['call-duration']) || 0,
                    safe(webhookData['agent-number']),
                    safe(webhookData['customer-number']),
                    safe(webhookData['virtual-number']),
                    safe(webhookData['recording-url']),
                    webhookData['start-time'] ? new Date(webhookData['start-time']) : null,
                    hasEndTime ? new Date(webhookData['end-time']) : null,
                    safe(webhookData['received-by']),
                    safe(webhookData['transfered-to']),
                    webhookData['handle-time'] ? parseInt(webhookData['handle-time']) : null,
                    webhookData['hold-time'] ? parseInt(webhookData['hold-time']) : null,
                    safe(webhookData['hangup-by']),
                    safe(webhookData['service-id']),
                    safe(webhookData['skill-id']),
                    safe(webhookData.ivr),
                    safe(webhookData.param1),
                    JSON.stringify(webhookData)
                ];

                const result = await query(callLogSql, callLogValues);
                callLogId = result.insertId;
            }

            // Update call attempt if exists
            if (appointmentId) {
                const attemptStatus = (disposition === 'answered' && !hasEndTime) ? 'in_progress' : 'completed';
                await query(
                    `UPDATE call_attempts 
                     SET attempt_status = ?,
                         call_log_id = ?
                     WHERE appointment_id = ? 
                     AND (attempt_status = 'pending' OR attempt_status = 'in_progress')
                     ORDER BY attempted_at DESC
                     LIMIT 1`,
                    [attemptStatus, callLogId, appointmentId]
                );
            }

            // Remove from ongoing_calls table if call has ended
            if (hasEndTime || disposition !== 'answered') {
                await query(
                    'DELETE FROM ongoing_calls WHERE call_id = ?',
                    [webhookData.callid]
                );
                logger.info('Call removed from ongoing_calls', { callId: webhookData.callid });
            }

            logger.info('Call webhook processed successfully', {
                callId: webhookData.callid,
                callLogId,
                appointmentId,
                isOngoing: !hasEndTime && disposition === 'answered'
            });

            return {
                success: true,
                callLogId,
                message: 'Call webhook processed successfully'
            };

        } catch (error) {
            logger.error('Error processing call webhook:', {
                error: error.message,
                webhookData
            });
            throw error;
        }
    }

    /**
     * Get call history for an appointment
     */
    async getCallHistory(appointmentId) {
        try {
            const sql = `
                SELECT 
                    cl.*,
                    dc.center_name,
                    u.full_name as attempted_by_name
                FROM call_logs cl
                LEFT JOIN diagnostic_centers dc ON cl.center_id = dc.id
                LEFT JOIN call_attempts ca ON cl.id = ca.call_log_id
                LEFT JOIN users u ON ca.attempted_by = u.id
                WHERE cl.appointment_id = ?
                ORDER BY cl.created_at DESC
            `;

            const callLogs = await query(sql, [appointmentId]);

            return {
                success: true,
                data: callLogs
            };

        } catch (error) {
            logger.error('Error getting call history:', error);
            throw error;
        }
    }

    /**
     * Get call attempts for an appointment
     */
    async getCallAttempts(appointmentId) {
        try {
            const sql = `
                SELECT 
                    ca.*,
                    dc.center_name,
                    u.full_name as attempted_by_name,
                    cl.disposition,
                    cl.call_duration,
                    cl.recording_url
                FROM call_attempts ca
                LEFT JOIN diagnostic_centers dc ON ca.center_id = dc.id
                LEFT JOIN users u ON ca.attempted_by = u.id
                LEFT JOIN call_logs cl ON ca.call_log_id = cl.id
                WHERE ca.appointment_id = ?
                ORDER BY ca.created_at DESC
            `;

            const attempts = await query(sql, [appointmentId]);

            return {
                success: true,
                data: attempts
            };

        } catch (error) {
            logger.error('Error getting call attempts:', error);
            throw error;
        }
    }

    /**
     * Validate if center can make calls for this appointment
     */
    async validateCallPermission(appointmentId, centerId) {
        try {
            const sql = `
                SELECT 
                    id,
                    visit_type,
                    center_id,
                    other_center_id,
                    medical_status,
                    center_medical_status,
                    home_medical_status
                FROM appointments
                WHERE id = ? AND is_deleted = 0
            `;

            const [appointment] = await query(sql, [appointmentId]);

            if (!appointment) {
                return {
                    success: true,
                    allowed: false,
                    reason: 'Appointment not found'
                };
            }

            // Check if center is authorized
            const visitType = appointment.visit_type?.toLowerCase();
            let isAuthorized = false;

            if (visitType === 'center_visit' || visitType === 'center') {
                isAuthorized = appointment.center_id === centerId;
            } else if (visitType === 'home_visit' || visitType === 'home') {
                // For home visit, center_id stores the home visit center
                isAuthorized = appointment.center_id === centerId;
            } else if (visitType === 'both') {
                // For both type: center_id = center visit, other_center_id = home visit
                isAuthorized = appointment.center_id === centerId || appointment.other_center_id === centerId;
            }

            if (!isAuthorized) {
                return {
                    success: true,
                    allowed: false,
                    reason: 'Center not authorized for this appointment'
                };
            }

            // Check if appointment is in valid status for calling (side-specific)
            const validStatuses = ['pending', 'scheduled', 'rescheduled', 'confirmed'];
            // Fall back to overall appointment.status if medical status is empty/none
            let status = (appointment.medical_status || appointment.status || '').toLowerCase();

            // logger.info('validateCallPermission: status inputs', {
            //     appointmentId,
            //     centerId,
            //     visitType,
            //     medical_status: appointment.medical_status,
            //     center_medical_status: appointment.center_medical_status,
            //     home_medical_status: appointment.home_medical_status,
            //     overall_status: appointment.status
            // });

            if (visitType === 'both') {
                if (appointment.center_id === centerId) {
                    status = appointment.center_medical_status?.toLowerCase() || status;
                } else if (appointment.other_center_id === centerId) {
                    status = appointment.home_medical_status?.toLowerCase() || status;
                }
            } else if (visitType === 'home_visit' || visitType === 'home') {
                status = appointment.home_medical_status?.toLowerCase() || status;
            } else if (visitType === 'center_visit' || visitType === 'center') {
                status = appointment.center_medical_status?.toLowerCase() || status;
            }

            // Map 'none' or empty to overall appointment.status
            if (!status || status === 'none') {
                status = appointment.status?.toLowerCase() || '';
            }

            // Treat explicit 'unknown' as empty to allow calling
            if (status === 'unknown') {
                status = '';
            }

            logger.info('validateCallPermission: resolved status', { appointmentId, centerId, visitType, status });

            // Only block when a status exists and is not in allowed list
            if (status && !validStatuses.includes(status)) {
                return {
                    success: true,
                    allowed: false,
                    reason: `Cannot make calls for appointments with status: ${status}`
                };
            }

            return {
                success: true,
                allowed: true,
                reason: 'Center authorized'
            };

        } catch (error) {
            logger.error('Error validating call permission:', error);
            throw error;
        }
    }

    /**
     * Spy on an ongoing call
     * @param {Object} params - Spy parameters
     * @param {string} params.callId - Call ID to spy on
     * @param {string} params.agentNumber - Agent number (optional)
     */
    async spyOnCall({ callId, agentNumber }) {
        logger.info('[TELEPHONY] SPY ON CALL INITIATED', { 
            callId, 
            agentNumber, 
            timestamp: new Date().toISOString(),
            flow: 'spyOnCall'
        });

        try {
            logger.info('Initiating spy on call', { callId, agentNumber });

            // Prepare API request according to SparkTG documentation
            // Format: xnid, country-code, type, number
            const formData = new URLSearchParams();
            formData.append('xnid', callId);
            formData.append('type', 'spy');
            
            if (agentNumber) {
                // Extract country code and number
                let cleanNumber = agentNumber.replace(/\+/g, '');
                let countryCode = '91';
                let number = cleanNumber;
                
                if (cleanNumber.startsWith('91') && cleanNumber.length > 10) {
                    countryCode = '91';
                    number = cleanNumber.substring(2);
                } else if (cleanNumber.length === 10) {
                    number = cleanNumber;
                }
                
                formData.append('country-code', countryCode);
                formData.append('number', number);
            }

            // Build auth header using Basic Auth (username:password)
            const headers = {
                'Content-Type': 'application/x-www-form-urlencoded'
            };
            
            if (this.username && this.password) {
                const basic = Buffer.from(`${this.username}:${this.password}`).toString('base64');
                headers.Authorization = `Basic ${basic}`;
            } else {
                throw new Error('Telephony credentials not configured');
            }

            // Make API call to SparkTG
            const response = await axios.post(
                `${this.baseURL}/whishper-spy`,
                formData.toString(),
                { headers }
            );

            logger.info('Spy initiated successfully', {
                callId,
                response: response.data
            });

            return response.data;

        } catch (error) {
            logger.error('Error initiating spy:', {
                message: error.message,
                status: error.response?.status,
                statusText: error.response?.statusText,
                data: error.response?.data
            });
            throw new Error(error.response?.data?.message || error.message || 'Failed to initiate spy');
        }
    }

    /**
     * Whisper during an ongoing call
     * @param {Object} params - Whisper parameters
     * @param {string} params.callId - Call ID to whisper on
     * @param {string} params.agentNumber - Agent number (optional)
     */
    /**
     * Hangup/End an ongoing call
     * @param {Object} params - Hangup parameters
     * @param {string} params.callId - Call ID to hangup
     */
    async hangupCall({ callId }) {
        logger.info('Initiating hangup on call', { callId });

        // Always clean up local state first
        await query('DELETE FROM ongoing_calls WHERE call_id = ?', [callId]).catch(e =>
            logger.warn('Could not delete from ongoing_calls', { callId, error: e.message })
        );
        await query(
            `UPDATE call_attempts SET attempt_status = 'completed' WHERE call_id = ?`,
            [callId]
        ).catch(e => logger.warn('Could not update call_attempts', { callId, error: e.message }));

        // Try SparkTG API to end call - multiple endpoint attempts
        const headers = {};
        if (this.username && this.password) {
            const basic = Buffer.from(`${this.username}:${this.password}`).toString('base64');
            headers.Authorization = `Basic ${basic}`;
        }

        let apiSuccess = false;
        const endpoints = [
            { method: 'post', url: `${this.baseURL}/calls/${callId}/hangup` },
            { method: 'delete', url: `${this.baseURL}/calls/${callId}` },
            { method: 'post', url: `${this.baseURL}/hangup`, data: { xnid: callId } },
        ];

        for (const ep of endpoints) {
            try {
                await axios({ method: ep.method, url: ep.url, data: ep.data, headers });
                apiSuccess = true;
                logger.info('SparkTG hangup API succeeded', { callId, endpoint: ep.url });
                break;
            } catch (err) {
                logger.warn('SparkTG hangup attempt failed', {
                    callId, endpoint: ep.url,
                    status: err.response?.status, msg: err.message
                });
            }
        }

        if (!apiSuccess) {
            logger.warn('All SparkTG hangup attempts failed - local state cleaned up anyway', { callId });
        }

        return {
            success: true,
            message: 'Call ended',
            apiHangupSuccess: apiSuccess
        };
    }

    async whisperToCall({ callId, agentNumber }) {
        try {
            logger.info('Initiating whisper on call', { callId, agentNumber });

            // Prepare API request according to SparkTG documentation
            // Format: xnid, country-code, type, number
            const formData = new URLSearchParams();
            formData.append('xnid', callId);
            formData.append('type', 'whisper');
            
            if (agentNumber) {
                // Extract country code and number
                let cleanNumber = agentNumber.replace(/\+/g, '');
                let countryCode = '91';
                let number = cleanNumber;
                
                if (cleanNumber.startsWith('91') && cleanNumber.length > 10) {
                    countryCode = '91';
                    number = cleanNumber.substring(2);
                } else if (cleanNumber.length === 10) {
                    number = cleanNumber;
                }
                
                formData.append('country-code', countryCode);
                formData.append('number', number);
            }

            // Build auth header using Basic Auth (username:password)
            const headers = {
                'Content-Type': 'application/x-www-form-urlencoded'
            };
            
            if (this.username && this.password) {
                const basic = Buffer.from(`${this.username}:${this.password}`).toString('base64');
                headers.Authorization = `Basic ${basic}`;
            } else {
                throw new Error('Telephony credentials not configured');
            }

            // Make API call to SparkTG
            const response = await axios.post(
                `${this.baseURL}/whishper-spy`,
                formData.toString(),
                { headers }
            );

            logger.info('Whisper initiated successfully', {
                callId,
                response: response.data
            });

            return response.data;

        } catch (error) {
            logger.error('Error initiating whisper:', {
                message: error.message,
                status: error.response?.status,
                statusText: error.response?.statusText,
                data: error.response?.data
            });
            throw new Error(error.response?.data?.message || error.message || 'Failed to initiate whisper');
        }
    }
}

module.exports = new TelephonyService();
