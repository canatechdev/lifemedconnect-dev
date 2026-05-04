const winston = require('winston');
const path = require('path');

// Create logs directory if it doesn't exist
const fs = require('fs');
const logsDir = path.join(__dirname, '../logs');
if (!fs.existsSync(logsDir)) {
    fs.mkdirSync(logsDir, { recursive: true });
}

// Custom format for appointment flow logging
const appointmentLogFormat = winston.format.combine(
    winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
    winston.format.errors({ stack: true }),
    winston.format.printf(({ timestamp, level, message, ...meta }) => {
        let log = `[${timestamp}] ${level.toUpperCase()}: ${message}`;
        
        // Add metadata if present
        if (Object.keys(meta).length > 0) {
            log += '\n' + JSON.stringify(meta, null, 2);
        }
        
        return log;
    })
);

// Create the logger
const appointmentLogger = winston.createLogger({
    level: 'debug',
    format: appointmentLogFormat,
    transports: [
        // Separate file for appointment flow logs
        new winston.transports.File({
            filename: path.join(logsDir, 'appointment-flow.log'),
            maxsize: 10485760, // 10MB
            maxFiles: 5,
            tailable: true
        }),
        // Separate file for errors
        new winston.transports.File({
            filename: path.join(logsDir, 'appointment-errors.log'),
            level: 'error',
            maxsize: 10485760,
            maxFiles: 5
        }),
        // Console output for development
        new winston.transports.Console({
            format: winston.format.combine(
                winston.format.colorize(),
                winston.format.simple()
            )
        })
    ]
});

// Helper functions for structured logging
const logHelpers = {
    // Log appointment operation start
    logOperationStart: (operation, appointmentId, data = {}) => {
        appointmentLogger.info(`=== ${operation} START ===`, {
            operation,
            appointmentId,
            timestamp: new Date().toISOString(),
            ...data
        });
    },

    // Log appointment operation end
    logOperationEnd: (operation, appointmentId, result = {}) => {
        appointmentLogger.info(`=== ${operation} END ===`, {
            operation,
            appointmentId,
            timestamp: new Date().toISOString(),
            ...result
        });
    },

    // Log DB state before/after
    logDBState: (stage, appointmentId, dbData) => {
        appointmentLogger.debug(`DB State [${stage}]`, {
            appointmentId,
            stage,
            dbData: {
                appointment: {
                    id: dbData.id,
                    visit_type: dbData.visit_type,
                    status: dbData.status,
                    medical_status: dbData.medical_status,
                    center_id: dbData.center_id,
                    other_center_id: dbData.other_center_id,
                    confirmed_at: dbData.confirmed_at,
                    center_confirmed_at: dbData.center_confirmed_at,
                    home_confirmed_at: dbData.home_confirmed_at,
                    arrived_at: dbData.arrived_at,
                    center_arrived_at: dbData.center_arrived_at,
                    home_arrived_at: dbData.home_arrived_at,
                    pending_report_types: dbData.pending_report_types
                }
            }
        });
    },

    // Log test updates for Both appointments
    logTestUpdates: (appointmentId, visitType, updates) => {
        appointmentLogger.debug('Test Status Updates', {
            appointmentId,
            visitType,
            updates: {
                centerTests: updates.centerTests || [],
                homeTests: updates.homeTests || [],
                affectedTestIds: updates.affectedTestIds || [],
                side: updates.side || null,
                affectedRows: updates.affectedRows || 0,
                newStatus: updates.newStatus,
                isCompleted: updates.isCompleted
            }
        });
    },

    // Log actor context
    logActorContext: (appointmentId, actorContext) => {
        appointmentLogger.debug('Actor Context', {
            appointmentId,
            actorContext: {
                centerId: actorContext.centerId,
                technicianId: actorContext.technicianId,
                type: actorContext.type,
                userId: actorContext.userId
            }
        });
    },

    // Log completion status calculation
    logCompletionStatus: (appointmentId, visitType, completionData) => {
        appointmentLogger.debug('Completion Status Calculation', {
            appointmentId,
            visitType,
            completionData: {
                centerComplete: completionData.centerComplete,
                homeComplete: completionData.homeComplete,
                centerPending: completionData.centerPending,
                homePending: completionData.homePending,
                overallStatus: completionData.overallStatus
            }
        });
    },

    // Log report type tracking for Both appointments
    logReportTypeTracking: (appointmentId, side, reportTypes) => {
        appointmentLogger.debug('Report Type Tracking', {
            appointmentId,
            side,
            reportTypes: {
                pending: reportTypes.pending || [],
                completed: reportTypes.completed || [],
                serialized: reportTypes.serialized
            }
        });
    },

    // Log validation errors
    logValidationError: (operation, appointmentId, errors) => {
        appointmentLogger.warn('Validation Error', {
            operation,
            appointmentId,
            errors
        });
    },

    // Log field mapping (to avoid confusion with legacy columns)
    logFieldMapping: (appointmentId, visitType, mapping) => {
        appointmentLogger.debug('Field Mapping', {
            appointmentId,
            visitType,
            mapping: {
                description: 'Active fields for this visit type',
                ...mapping
            }
        });
    },

    // Log Both appointment split logic
    logBothAppointmentSplit: (appointmentId, splitData) => {
        appointmentLogger.info('Both Appointment Split Logic', {
            appointmentId,
            splitData: {
                centerTests: splitData.centerTests?.length || 0,
                homeTests: splitData.homeTests?.length || 0,
                centerTestIds: splitData.centerTestIds || [],
                homeTestIds: splitData.homeTestIds || [],
                centerReportTypes: splitData.centerReportTypes || [],
                homeReportTypes: splitData.homeReportTypes || []
            }
        });
    }
};

module.exports = {
    appointmentLogger,
    ...logHelpers
};
