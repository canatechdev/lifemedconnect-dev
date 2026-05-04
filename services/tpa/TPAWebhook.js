/**
 * TPA Webhook Service
 * Handles sending webhooks to TPA systems with retry logic
 */

const axios = require('axios');
const db = require('../../lib/dbconnection');
const logger = require('../../lib/logger');

class TPAWebhookService {
    /**
     * Send webhook to TPA
     */
    static async sendWebhook(clientId, eventType, eventData) {
        try {
            // Check if TPA webhooks are enabled
            if (process.env.TPA_WEBHOOK_ENABLED !== 'true') {
                logger.info('TPA webhooks disabled, skipping', { eventType });
                return;
            }

            // Validate inputs
            if (!clientId || !eventType || !eventData) {
                logger.error('Invalid webhook parameters', { clientId, eventType, hasEventData: !!eventData });
                return;
            }

            // Validate clientId is a number
            if (typeof clientId !== 'number' || clientId <= 0) {
                logger.error('Invalid clientId format', { clientId, type: typeof clientId });
                return;
            }

            // Validate eventType
            if (typeof eventType !== 'string' || eventType.trim().length === 0) {
                logger.error('Invalid eventType format', { eventType, type: typeof eventType });
                return;
            }

            // Get TPA webhook configuration
            const tpaKeys = await db.query(
                `SELECT webhook_url, webhook_auth_method, webhook_auth_credentials
                 FROM tpa_api_keys
                 WHERE client_id = ? AND is_active = TRUE AND webhook_url IS NOT NULL`,
                [clientId]
            );

            if (tpaKeys.length === 0) {
                logger.info('No webhook configured for TPA', { clientId, eventType });
                return;
            }

            // Debug logging
            logger.info('TPA config query result', { 
                clientId, 
                eventType, 
                tpaKeysLength: tpaKeys.length,
                firstKey: tpaKeys[0] ? 'defined' : 'undefined'
            });

            const tpaConfig = tpaKeys[0];
            
            if (!tpaConfig) {
                logger.error('TPA config is undefined', { 
                    clientId, 
                    eventType, 
                    tpaKeys: JSON.stringify(tpaKeys)
                });
                return;
            }

            // Validate TPA config structure
            if (!tpaConfig.webhook_url || typeof tpaConfig.webhook_url !== 'string') {
                logger.error('Invalid webhook URL in TPA config', { 
                    clientId, 
                    eventType, 
                    webhookUrl: tpaConfig.webhook_url,
                    type: typeof tpaConfig.webhook_url
                });
                return;
            }

            if (!tpaConfig.webhook_auth_method || !['api_key', 'basic_auth', 'none'].includes(tpaConfig.webhook_auth_method)) {
                logger.error('Invalid auth method in TPA config', { 
                    clientId, 
                    eventType, 
                    authMethod: tpaConfig.webhook_auth_method
                });
                return;
            }

            // Validate webhook URL format
            try {
                new URL(tpaConfig.webhook_url);
            } catch (urlError) {
                logger.error('Invalid webhook URL format', { 
                    clientId, 
                    eventType, 
                    webhookUrl: tpaConfig.webhook_url,
                    error: urlError.message
                });
                return;
            }
            const payload = this.buildWebhookPayload(eventType, eventData);

            // Send webhook
            await this.deliverWebhook(clientId, tpaConfig, payload, eventType, eventData);

        } catch (error) {
            logger.error('Error sending webhook', {
                clientId,
                eventType,
                error: error.message
            });
        }
    }

    /**
     * Build webhook payload
     */
    static buildWebhookPayload(eventType, eventData) {
        return {
            event_type: eventType,
            timestamp: new Date().toISOString(),
            case_number: eventData.case_number,
            appointment_number: eventData.application_number,
            data: eventData.data || {}
        };
    }

    /**
     * Deliver webhook with retry logic
     */
    static async deliverWebhook(clientId, tpaConfig, payload, eventType, eventData) {
        const headers = {
            'Content-Type': 'application/json'
        };

        // Add authentication based on method
        if (tpaConfig.webhook_auth_method === 'api_key' && tpaConfig.webhook_auth_credentials) {
            headers['X-API-Key'] = tpaConfig.webhook_auth_credentials;
        } else if (tpaConfig.webhook_auth_method === 'basic_auth' && tpaConfig.webhook_auth_credentials) {
            headers['Authorization'] = `Basic ${tpaConfig.webhook_auth_credentials}`;
        }

        let logId = null;

        try {
            // Log webhook attempt
            const logResult = await db.query(
                `INSERT INTO tpa_webhook_logs 
                 (client_id, event_type, case_number, appointment_number, webhook_url, request_payload, status)
                 VALUES (?, ?, ?, ?, ?, ?, 'pending')`,
                [clientId, eventType, eventData.case_number, eventData.application_number, tpaConfig.webhook_url, JSON.stringify(payload)]
            );
            logId = logResult.insertId;

            // Send webhook
            const response = await axios.post(tpaConfig.webhook_url, payload, {
                headers,
                timeout: 10000
            });

            // Update log with success
            await db.query(
                `UPDATE tpa_webhook_logs 
                 SET status = 'success', response_status = ?, response_body = ?
                 WHERE id = ?`,
                [response.status, JSON.stringify(response.data), logId]
            );

            logger.info('Webhook delivered successfully', {
                clientId,
                eventType,
                status: response.status
            });

        } catch (error) {
            // Update log with failure
            if (logId) {
                await db.query(
                    `UPDATE tpa_webhook_logs 
                     SET status = 'failed', response_status = ?, response_body = ?, 
                         retry_count = retry_count + 1, next_retry_at = DATE_ADD(NOW(), INTERVAL 5 MINUTE)
                     WHERE id = ?`,
                    [error.response?.status || 0, error.message, logId]
                );
            }

            logger.error('Webhook delivery failed', {
                clientId,
                eventType,
                error: error.message,
                status: error.response?.status
            });

            // Schedule retry if less than 3 attempts
            await this.scheduleRetry(logId, clientId, tpaConfig, payload, eventType, eventData);
        }
    }

    /**
     * Schedule webhook retry
     */
    static async scheduleRetry(logId, clientId, tpaConfig, payload, eventType, eventData) {
        try {
            const logs = await db.query(
                `SELECT retry_count FROM tpa_webhook_logs WHERE id = ?`,
                [logId]
            );

            if (logs.length > 0 && logs[0].retry_count < 3) {
                // Retry after 5 minutes
                setTimeout(() => {
                    this.deliverWebhook(clientId, tpaConfig, payload, eventType, eventData);
                }, 5 * 60 * 1000);

                logger.info('Webhook retry scheduled', {
                    logId,
                    retryCount: logs[0].retry_count,
                    nextRetryIn: '5 minutes'
                });
            } else {
                logger.warn('Webhook max retries reached', { logId });
            }
        } catch (error) {
            logger.error('Error scheduling webhook retry', { error: error.message });
        }
    }

    /**
     * Trigger appointment event webhook based on status changes
     * @param {string} eventType - Event type
     * @param {object} appointmentData - Appointment data
     * @param {object} additionalData - Additional data (images, documents, etc.)
     */
    static async triggerAppointmentEvent(eventType, appointmentData, additionalData = {}) {
        const eventData = {
            case_number: appointmentData.case_number,
            application_number: appointmentData.application_number || '',
            data: {
                patient_name: appointmentData.customer_first_name + ' ' + (appointmentData.customer_last_name || ''),
                patient_phone: appointmentData.customer_mobile,
                patient_email: appointmentData.customer_email,
                appointment_date: appointmentData.appointment_date,
                appointment_time: appointmentData.appointment_time,
                status: appointmentData.status,
                medical_status: appointmentData.medical_status,
                qc_status: appointmentData.qc_status,
                visit_type: appointmentData.visit_type,
                customer_images: additionalData.customer_images || [],
                documents: additionalData.documents || [],
                tpa_pdf_url: additionalData.tpa_pdf_url || null,
                remarks: appointmentData.remarks || '',
                medical_remarks: appointmentData.medical_remarks || '',
                cancellation_reason: appointmentData.cancellation_reason || '',
                pushback_remarks: appointmentData.pushback_remarks || '',
                reschedule_remark: appointmentData.reschedule_remark || '',
                timestamp: new Date().toISOString()
            }
        };

        await this.sendWebhook(appointmentData.client_id, eventType, eventData);
    }

    /**
     * Trigger status change webhook - automatically determines event type
     * @param {object} appointmentData - Appointment data
     * @param {object} previousData - Previous appointment data for comparison
     * @param {object} additionalData - Additional data (images, documents, etc.)
     */
    static async triggerStatusChange(appointmentData, previousData = {}, additionalData = {}) {
        const events = [];

        // Check main status changes
        if (appointmentData.status !== previousData.status) {
            const statusEvent = this.getStatusEvent(appointmentData.status);
            if (statusEvent) events.push(statusEvent);
            
            // Special handling: pushback should also trigger cancelled event
            if (appointmentData.status === 'pushed_back') {
                events.push('appointment_cancelled');
            }
        }

        // Check medical status changes
        if (appointmentData.medical_status !== previousData.medical_status) {
            const medicalEvent = this.getMedicalStatusEvent(appointmentData.medical_status);
            if (medicalEvent) events.push(medicalEvent);
        }

        // Check QC status changes
        if (appointmentData.qc_status !== previousData.qc_status) {
            const qcEvent = this.getQCStatusEvent(appointmentData.qc_status);
            if (qcEvent) events.push(qcEvent);
        }

        // Trigger all relevant events
        for (const eventType of events) {
            await this.triggerAppointmentEvent(eventType, appointmentData, additionalData);
        }
    }

    /**
     * Get event type for main status
     */
    static getStatusEvent(status) {
        const statusEvents = {
            'scheduled': 'appointment_scheduled',
            'confirmed': 'appointment_confirmed',
            'pushed_back': 'appointment_rescheduled', // Also triggers cancelled event
            'checked_in': 'patient_checked_in',
            'medical_partially_completed': 'medical_partially_completed',
            'medical_completed': 'medical_completed',
            'completed': 'appointment_completed',
            'cancelled': 'appointment_cancelled'
        };
        return statusEvents[status] || null;
    }

    /**
     * Get event type for medical status
     */
    static getMedicalStatusEvent(medicalStatus) {
        const medicalEvents = {
            'scheduled': 'medical_scheduled',
            'arrived': 'patient_arrived',
            'in_process': 'medical_in_progress',
            'partially_completed': 'medical_partially_completed',
            'completed': 'medical_completed'
        };
        return medicalEvents[medicalStatus] || null;
    }

    /**
     * Get event type for QC status
     */
    static getQCStatusEvent(qcStatus) {
        const qcEvents = {
            'pending': 'qc_pending',
            'completed': 'qc_completed'
        };
        return qcEvents[qcStatus] || null;
    }
}

module.exports = TPAWebhookService;
