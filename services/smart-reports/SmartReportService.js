/**
 * Smart Report Service
 * Handles integration with HealthVectors Smart Reports API
 * 
 * Flow:
 * 1. Push PDF report URLs to HealthVectors v2/labdata API
 * 2. Receive generated Smart Report (base64 PDF) via webhook callback
 * 3. Convert base64 to PDF file and store locally
 * 
 * Controlled by ENV: SMART_REPORT_ENABLED=true/false
 */

const axios = require('axios');
const fs = require('fs');
const path = require('path');
const db = require('../../lib/dbconnection');
const logger = require('../../lib/logger');
const { sanitizeFolderName } = require('../../lib/fileUpload');

// Base upload directory for smart reports
const SMART_REPORTS_BASE_DIR = path.join(__dirname, '../../uploads/smart-reports');

/**
 * Check if Smart Report feature is enabled
 */
function isEnabled() {
    return process.env.SMART_REPORT_ENABLED === 'true';
}

/**
 * Ensure the smart-reports upload directory exists (optionally with entity subfolder)
 * @param {string} entityFolder - Optional entity identifier (e.g. case_number)
 * @returns {string} The resolved upload directory path
 */
function ensureUploadDir(entityFolder = '') {
    const safeName = sanitizeFolderName(entityFolder);
    const dir = safeName
        ? path.join(SMART_REPORTS_BASE_DIR, safeName)
        : SMART_REPORTS_BASE_DIR;
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }
    return dir;
}

class SmartReportService {

    /**
     * Request Smart Report generation for an appointment
     * Pushes PDF URLs to HealthVectors API
     * 
     * @param {number} appointmentId
     * @returns {Promise<Object>}
     */
    async requestSmartReport(appointmentId) {
        if (!isEnabled()) {
            return {
                success: false,
                message: 'Smart Report feature is disabled',
                statusCode: 403
            };
        }

        const apiUrl = process.env.SMART_REPORT_API_URL;
        const apiKey = process.env.SMART_REPORT_API_KEY;

        // if (!apiUrl || !apiKey) {
        //     logger.error('Smart Report API URL or API Key not configured');
        //     return {
        //         success: false,
        //         message: 'Smart Report API is not configured',
        //         statusCode: 500
        //     };
        // }

        try {
            // Fetch appointment with patient and report data
            const appointments = await db.query(
                `SELECT a.*, 
                        c.client_name, c.client_code,
                        i.insurer_name,
                        dc.center_name,
                        t.full_name as technician_name
                 FROM appointments a
                 LEFT JOIN clients c ON a.client_id = c.id
                 LEFT JOIN insurers i ON a.insurer_id = i.id
                 LEFT JOIN diagnostic_centers dc ON a.center_id = dc.id
                 LEFT JOIN technicians t ON a.assigned_technician_id = t.id
                 WHERE a.id = ?`,
                [appointmentId]
            );

            if (!appointments || appointments.length === 0) {
                return { success: false, message: 'Appointment not found', statusCode: 404 };
            }

            const appointment = appointments[0];

            // Check if there's already a processing smart report for this appointment
            const existingReport = await db.query(
                `SELECT * FROM smart_reports WHERE appointment_id = ? AND status = 'processing'`,
                [appointmentId]
            );
            if (existingReport && existingReport.length > 0) {
                return { success: false, message: 'Smart Report is already being processed', statusCode: 400 };
            }

            // Validate age >= 15
            if (appointment.customer_age && appointment.customer_age < 15) {
                return {
                    success: false,
                    message: 'Smart Reports are not available for patients under 15 years of age',
                    statusCode: 400
                };
            }

            // Fetch categorized report PDFs for this appointment
            const reports = await db.query(
                `SELECT * FROM appointment_categorized_reports 
                 WHERE appointment_id = ? AND is_deleted = 0 
                 ORDER BY report_type, uploaded_at`,
                [appointmentId]
            );

            if (!reports || reports.length === 0) {
                return { success: false, message: 'No reports found for this appointment', statusCode: 400 };
            }

            // Build publicly accessible PDF URLs
            const baseUrl = process.env.BASE_URL || 'http://localhost:5050';
            const pdfUrls = reports
                .filter(r => r.file_path)
                .map(r => `${baseUrl}/${r.file_path}`);

            if (pdfUrls.length === 0) {
                return { success: false, message: 'No report PDFs available to process', statusCode: 400 };
            }

            // Build the callback URL using BASE_URL (same domain as our backend)
            const callbackUrl = `${baseUrl}/api/smart-reports/webhook/callback`;

            // Build request payload for HealthVectors API
            const payload = {
                PatientID: String(appointment.id),
                CaseNo: appointment.case_number || '',
                FirstName: appointment.customer_first_name || '',
                LastName: appointment.customer_last_name || '',
                Age: appointment.customer_age || null,
                Gender: appointment.customer_gender || '',
                Mobile: appointment.customer_mobile || '',
                Email: appointment.customer_email || '',
                OutsourcedLabReports: pdfUrls,
                Results: [],
                CallbackUrl: callbackUrl
            };

            // Insert new smart_reports record with pending status
            const insertResult = await db.query(
                `INSERT INTO smart_reports (appointment_id, status, requested_at) VALUES (?, 'pending', NOW())`,
                [appointmentId]
            );
            const smartReportId = insertResult.insertId;

            // Call HealthVectors API
            const response = await axios.post(
                `${apiUrl}/v2/labdata`,
                payload,
                {
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${apiKey}`
                    },
                    timeout: 30000
                }
            );

            // Extract request ID from response (if provided by HV)
            const requestId = response.data?.requestId || response.data?.id || String(appointmentId);

            // Update to processing status with request ID
            await db.query(
                `UPDATE smart_reports SET status = 'processing', request_id = ? WHERE id = ?`,
                [requestId, smartReportId]
            );

            logger.info('Smart Report requested successfully', {
                appointmentId,
                smartReportId,
                requestId,
                pdfCount: pdfUrls.length,
                caseNumber: appointment.case_number
            });

            return {
                success: true,
                message: 'Smart Report generation requested. You will be notified when ready.',
                requestId,
                status: 'processing'
            };

        } catch (error) {
            // Update status to failed if we have a record
            await db.query(
                `UPDATE smart_reports SET status = 'failed', error_message = ? 
                 WHERE appointment_id = ? AND status IN ('pending', 'processing')`,
                [error.message?.substring(0, 500), appointmentId]
            ).catch(err => logger.error('Failed to update smart report error status', err));

            logger.error('Error requesting Smart Report', {
                appointmentId,
                error: error.message,
                response: error.response?.data
            });

            return {
                success: false,
                message: error.response?.data?.message || 'Failed to request Smart Report generation',
                statusCode: error.response?.status || 500
            };
        }
    }

    /**
     * Process webhook callback from HealthVectors
     * Receives base64 PDF string and stores it locally
     * 
     * @param {Object} callbackData - Data from HealthVectors callback
     * @returns {Promise<Object>}
     */
    async processWebhookCallback(callbackData) {
        // Log raw callback data immediately for audit/debugging (excluding large base64)
        const logSafeData = { ...callbackData };
        if (logSafeData.smartReportBase64) logSafeData.smartReportBase64 = `[BASE64_LENGTH:${logSafeData.smartReportBase64.length}]`;
        if (logSafeData.base64) logSafeData.base64 = `[BASE64_LENGTH:${logSafeData.base64.length}]`;
        if (logSafeData.pdf_base64) logSafeData.pdf_base64 = `[BASE64_LENGTH:${logSafeData.pdf_base64.length}]`;
        logger.info('Smart Report webhook raw callback received', { callbackData: logSafeData });

        if (!isEnabled()) {
            logger.warn('Smart Report webhook received but feature is disabled');
            return { success: false, message: 'Feature disabled' };
        }

        try {
            const {
                PatientID,
                patientId,
                CaseNo,
                case_number,
                caseNo,
                smartReportBase64,
                base64,
                pdf_base64,
                status,
                error: errorMsg
            } = callbackData;

            // Resolve fields (HV may use different casing)
            const resolvedPatientId = PatientID || patientId;
            const resolvedCaseNo = CaseNo || caseNo || case_number;
            const resolvedBase64 = smartReportBase64 || base64 || pdf_base64;

            if (!resolvedPatientId && !resolvedCaseNo) {
                logger.warn('Smart Report callback missing patient/case identifier', { callbackData: Object.keys(callbackData) });
                return { success: false, message: 'Missing patient or case identifier' };
            }

            // Find the smart_reports record by appointment_id or request_id
            let smartReport;
            if (resolvedPatientId) {
                // Try to find by appointment_id first, then by request_id
                const rows = await db.query(
                    `SELECT sr.*, a.case_number 
                     FROM smart_reports sr 
                     JOIN appointments a ON sr.appointment_id = a.id
                     WHERE (sr.appointment_id = ? OR sr.request_id = ?) 
                       AND sr.status = 'processing'
                     ORDER BY sr.id DESC LIMIT 1`,
                    [resolvedPatientId, resolvedPatientId]
                );
                smartReport = rows?.[0];
            }
            if (!smartReport && resolvedCaseNo) {
                const rows = await db.query(
                    `SELECT sr.*, a.case_number 
                     FROM smart_reports sr 
                     JOIN appointments a ON sr.appointment_id = a.id
                     WHERE a.case_number = ? AND sr.status = 'processing'
                     ORDER BY sr.id DESC LIMIT 1`,
                    [resolvedCaseNo]
                );
                smartReport = rows?.[0];
            }

            if (!smartReport) {
                logger.warn('Smart Report callback - record not found', { resolvedPatientId, resolvedCaseNo });
                return { success: false, message: 'Smart report record not found' };
            }

            // If the callback reports an error
            if (status === 'error' || status === 'failed') {
                await db.query(
                    `UPDATE smart_reports SET status = 'failed', error_message = ? WHERE id = ?`,
                    [errorMsg || 'Smart Report generation failed', smartReport.id]
                );
                logger.warn('Smart Report generation failed via callback', { smartReportId: smartReport.id, error: errorMsg });
                return { success: true, message: 'Error status recorded' };
            }

            // Validate base64 data
            if (!resolvedBase64) {
                logger.warn('Smart Report callback missing base64 PDF data', { smartReportId: smartReport.id });
                await db.query(
                    `UPDATE smart_reports SET status = 'failed', error_message = 'No PDF data received in callback' WHERE id = ?`,
                    [smartReport.id]
                );
                return { success: false, message: 'No base64 PDF data received' };
            }

            // Log that we received valid data (for debugging/audit)
            logger.info('Smart Report base64 data received', {
                smartReportId: smartReport.id,
                appointmentId: smartReport.appointment_id,
                base64Length: resolvedBase64.length,
                base64Preview: resolvedBase64.substring(0, 50) + '...'
            });

            // Convert base64 to PDF and save (organized by case_number)
            const caseFolder = smartReport.case_number || '';
            const uploadDir = ensureUploadDir(caseFolder);

            const fileName = `smart_report_${smartReport.case_number || smartReport.appointment_id}_${Date.now()}.pdf`;
            const filePath = path.join(uploadDir, fileName);
            const safeCaseFolder = sanitizeFolderName(caseFolder);
            const relativePath = safeCaseFolder
                ? `uploads/smart-reports/${safeCaseFolder}/${fileName}`
                : `uploads/smart-reports/${fileName}`;

            // Decode base64 and write PDF with error handling
            let pdfBuffer;
            try {
                pdfBuffer = Buffer.from(resolvedBase64, 'base64');
                fs.writeFileSync(filePath, pdfBuffer);
                
                // Verify file was written correctly
                if (!fs.existsSync(filePath)) {
                    throw new Error('File was not created');
                }
                const stats = fs.statSync(filePath);
                if (stats.size === 0) {
                    throw new Error('File is empty');
                }
            } catch (fileError) {
                logger.error('Failed to save Smart Report PDF file', {
                    smartReportId: smartReport.id,
                    error: fileError.message,
                    filePath
                });
                await db.query(
                    `UPDATE smart_reports SET status = 'failed', error_message = ? WHERE id = ?`,
                    [`File save failed: ${fileError.message}`, smartReport.id]
                );
                return { success: false, message: 'Failed to save PDF file' };
            }

            // Update smart_reports record with completed status and file path
            await db.query(
                `UPDATE smart_reports SET status = 'completed', file_path = ?, completed_at = NOW(), error_message = NULL WHERE id = ?`,
                [relativePath, smartReport.id]
            );

            logger.info('Smart Report received and saved', {
                smartReportId: smartReport.id,
                appointmentId: smartReport.appointment_id,
                caseNumber: smartReport.case_number,
                filePath: relativePath,
                fileSizeKB: Math.round(pdfBuffer.length / 1024)
            });

            return {
                success: true,
                message: 'Smart Report saved successfully',
                appointmentId: smartReport.appointment_id,
                filePath: relativePath
            };

        } catch (error) {
            logger.error('Error processing Smart Report webhook callback', { error: error.message });
            throw error;
        }
    }

    /**
     * Get Smart Report status for an appointment
     * Returns the latest smart report record for the appointment
     * 
     * @param {number} appointmentId
     * @returns {Promise<Object>}
     */
    async getSmartReportStatus(appointmentId) {
        // First check if appointment exists
        const appointments = await db.query(
            'SELECT id FROM appointments WHERE id = ?',
            [appointmentId]
        );

        if (!appointments || appointments.length === 0) {
            return { success: false, message: 'Appointment not found', statusCode: 404 };
        }

        // Get the latest smart report for this appointment
        const rows = await db.query(
            `SELECT id, status, request_id, file_path, error_message, requested_at, completed_at
             FROM smart_reports 
             WHERE appointment_id = ? 
             ORDER BY id DESC LIMIT 1`,
            [appointmentId]
        );

        const baseUrl = process.env.BASE_URL || 'http://localhost:5050';

        if (!rows || rows.length === 0) {
            // No smart report record exists yet
            return {
                success: true,
                status: 'none',
                pdfUrl: null,
                requestId: null,
                requestedAt: null,
                completedAt: null,
                error: null
            };
        }

        const row = rows[0];

        return {
            success: true,
            status: row.status,
            pdfUrl: row.file_path ? `${baseUrl}/${row.file_path}` : null,
            requestId: row.request_id,
            requestedAt: row.requested_at,
            completedAt: row.completed_at,
            error: row.error_message
        };
    }
}

module.exports = new SmartReportService();
