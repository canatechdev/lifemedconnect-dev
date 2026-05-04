/**
 * TPA Webhook Helper
 * Simple webhook helper - one file, clean and straightforward
 */

const { TPAWebhookService } = require('../services/tpa');
const logger = require('./logger');
const db = require('./dbconnection');

/**
 * Get appointment data for webhook
 */
async function getAppointmentData(appointmentId) {
    const appointments = await db.query(`
        SELECT 
            a.id, a.case_number, a.application_number, a.client_id,
            a.customer_first_name, a.customer_last_name, a.gender, a.customer_mobile, a.customer_alt_mobile, 
            a.customer_service_no, a.customer_email, a.customer_address, a.state, a.city, a.pincode, a.country,
            a.customer_gps_latitude, a.customer_gps_longitude, a.customer_landmark,
            a.appointment_date, a.appointment_time, a.visit_type, a.customer_category,
            a.status, a.medical_status, a.qc_status,
            a.center_id, a.other_center_id,
            a.center_medical_status, a.home_medical_status,
            a.remarks, a.medical_remarks, a.cancellation_reason,
            a.pushback_remarks, a.reschedule_remark,
            a.aadhaar_number, a.pan_number,
            c.client_name, i.insurer_name, dc.center_name
        FROM appointments a
        LEFT JOIN clients c ON a.client_id = c.id
        LEFT JOIN insurers i ON a.insurer_id = i.id
        LEFT JOIN diagnostic_centers dc ON a.center_id = dc.id
        WHERE a.id = ? AND a.is_deleted = 0
    `, [appointmentId]);

    return appointments?.[0] || null;
}

/**
 * Build simple webhook payload
 */
function buildPayload(appointment, additionalData = {}) {
    // Debug logging
    logger.info('Building webhook payload', {
        appointmentId: appointment.id,
        hasAdditionalData: Object.keys(additionalData).length > 0,
        customerImagesCount: (additionalData.customer_images || []).length,
        documentsCount: (additionalData.documents || []).length
    });

    // Process customer images with URLs
    const customerImages = (additionalData.customer_images || []).map(img => ({
        image_label: img.image_label,
        image_url: `${process.env.BASE_URL || 'http://localhost:3000'}/${img.file_path}`
    }));

    // Process documents with URLs
    const documents = (additionalData.documents || []).map(doc => ({
        doc_type: doc.doc_type,
        doc_number: doc.doc_number,
        file_url: `${process.env.BASE_URL || 'http://localhost:3000'}/${doc.file_path}`
    }));

    logger.info('Processed webhook media', {
        processedImagesCount: customerImages.length,
        processedDocumentsCount: documents.length,
        imageUrls: customerImages.map(img => img.image_url),
        documentUrls: documents.map(doc => doc.file_url)
    });

    return {
        case_number: appointment.case_number,
        appointment_number: appointment.application_number,
        tpa_name: 'CD TPA',
        insurer_name: appointment.insurer_name || '',
        dc_name: appointment.center_name || '',
        customer_name: `${appointment.customer_first_name} ${appointment.customer_last_name}`.trim(),
        event_timestamp: new Date().toISOString(),
        data: {
            // Customer details
            customer_first_name: appointment.customer_first_name,
            customer_last_name: appointment.customer_last_name,
            gender: appointment.gender,
            customer_mobile: appointment.customer_mobile,
            customer_alt_mobile: appointment.customer_alt_mobile,
            customer_service_no: appointment.customer_service_no,
            customer_email: appointment.customer_email,
            customer_address: appointment.customer_address,
            state: appointment.state,
            city: appointment.city,
            pincode: appointment.pincode,
            country: appointment.country,
            customer_gps_latitude: appointment.customer_gps_latitude,
            customer_gps_longitude: appointment.customer_gps_longitude,
            customer_landmark: appointment.customer_landmark,
            customer_category: appointment.customer_category,
            aadhaar_number: appointment.aadhaar_number,
            pan_number: appointment.pan_number,
            // Appointment details
            status: appointment.status,
            medical_status: appointment.medical_status,
            qc_status: appointment.qc_status,
            appointment_date: appointment.appointment_date,
            appointment_time: appointment.appointment_time,
            visit_type: appointment.visit_type,
            remarks: appointment.remarks,
            medical_remarks: appointment.medical_remarks,
            // Simple media paths (not objects)
            images: customerImages.map(img => img.image_url),
            documents: documents.map(doc => doc.file_url),
            // PDF URL for QC completion only
            tpa_pdf_url: additionalData.tpa_pdf_url || null,
            // Include any additional data passed
            ...additionalData
        }
    };
}

/**
 * Generic webhook trigger
 */
async function triggerWebhook(appointmentId, eventType, additionalData = {}) {
    try {
        if (process.env.TPA_INTEGRATION_ENABLED !== 'true') {
            return;
        }

        // Validate and convert appointmentId
        const numericAppointmentId = parseInt(appointmentId, 10);
        if (!appointmentId || isNaN(numericAppointmentId) || numericAppointmentId <= 0) {
            logger.error('Invalid appointmentId for webhook', { appointmentId, type: typeof appointmentId });
            return;
        }

        if (!eventType || typeof eventType !== 'string' || eventType.trim().length === 0) {
            logger.error('Invalid eventType for webhook', { eventType, type: typeof eventType });
            return;
        }

        const appointment = await getAppointmentData(numericAppointmentId);
        if (!appointment) {
            logger.warn('Appointment not found for webhook', { appointmentId });
            return;
        }

        // Validate appointment has client_id
        if (!appointment.client_id) {
            logger.error('Appointment missing client_id', { appointmentId, caseNumber: appointment.case_number });
            return;
        }

        const payload = buildPayload(appointment, additionalData);
        await TPAWebhookService.triggerAppointmentEvent(eventType, appointment, payload.data);
        
        logger.info('TPA webhook triggered', {
            appointmentId: numericAppointmentId,
            eventType,
            case_number: appointment.case_number
        });

    } catch (error) {
        logger.error('Error triggering TPA webhook', {
            appointmentId: numericAppointmentId,
            eventType,
            error: error.message
        });
    }
}

/**
 * Simple webhook triggers for each action
 */
async function triggerAppointmentConfirmed(appointmentId) {
    await triggerWebhook(appointmentId, 'appointment_confirmed');
}

async function triggerAppointmentRescheduled(appointmentId) {
    await triggerWebhook(appointmentId, 'appointment_rescheduled');
}

async function triggerAppointmentCancelled(appointmentId) {
    await triggerWebhook(appointmentId, 'appointment_cancelled');
}

async function triggerMedicalStatusUpdate(appointmentId, medicalStatus, actorContext = null, additionalData = {}) {
    let eventType = null;
    
    // Determine event type based on medical status
    switch (medicalStatus) {
        case 'arrived':
            eventType = 'patient_arrived';
            break;
        case 'in_process':
            eventType = 'medical_in_progress';
            break;
        case 'partially_completed':
            eventType = 'medical_partially_completed';
            break;
        case 'completed':
            eventType = 'medical_completed';
            break;
    }
    
    if (eventType) {
        // Add actor context to additional data for "Both" visit types
        if (actorContext) {
            additionalData.actor_context = actorContext;
        }
        await triggerWebhook(appointmentId, eventType, additionalData);
    }
}

async function triggerQCCompleted(appointmentId, additionalData) {
    await triggerWebhook(appointmentId, 'qc_completed', additionalData);
}

module.exports = {
    // Simple triggers
    triggerAppointmentConfirmed,
    triggerAppointmentRescheduled,
    triggerAppointmentCancelled,
    triggerMedicalStatusUpdate,
    triggerQCCompleted,
    
    // Generic trigger for custom use
    triggerWebhook
};
