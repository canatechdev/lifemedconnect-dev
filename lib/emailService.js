/**
 * Email Service - Reusable email sending functionality
 * Supports SMTP configuration and various email templates
 */

const nodemailer = require('nodemailer');
const logger = require('./logger');

class EmailService {
    constructor() {
        this.transporter = null;
        this.isEnabled = this.checkIfEnabled();
        this.initializeTransporter();
    }

    checkIfEnabled() {
        const flag = (process.env.EMAIL_ENABLED ?? 'true').toString().toLowerCase();
        return flag === 'true' || flag === '1';
    }

    initializeTransporter() {
        if (!this.isEnabled) {
            logger.info('Email service is disabled (EMAIL_ENABLED=false)');
            return;
        }

        const { SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASSWORD } = process.env;
        
        if (!SMTP_HOST || !SMTP_PORT || !SMTP_USER || !SMTP_PASSWORD) {
            logger.warn('SMTP configuration incomplete. Email service will not function.');
            return;
        }

        try {
            const port = Number(SMTP_PORT);
            this.transporter = nodemailer.createTransport({
                host: SMTP_HOST,
                port: port,
                secure: port === 465, // true for 465, false for other ports
                auth: {
                    user: SMTP_USER,
                    pass: SMTP_PASSWORD
                },
                tls: {
                    rejectUnauthorized: false
                }
            });

            logger.info('Email service initialized successfully', {
                host: SMTP_HOST,
                port: port,
                secure: port === 465
            });
        } catch (error) {
            logger.error('Failed to initialize email service', { error: error.message });
        }
    }

    async sendEmail({ to, subject, text, html }) {
        if (!this.isEnabled) {
            logger.info('Email sending skipped (EMAIL_ENABLED=false)', { to, subject });
            return { success: false, message: 'Email service is disabled' };
        }

        if (!this.transporter) {
            logger.error('Email transporter not initialized', { to, subject });
            return { success: false, message: 'Email service not configured' };
        }

        const from = process.env.SMTP_FROM || process.env.SMTP_USER;
        const fromName = process.env.SMTP_FROM_NAME || 'LifeMed Connect';
        
        const mailOptions = {
            from: `"${fromName}" <${from}>`,
            to,
            subject,
            text,
            html: html || text,
            headers: {
                'X-Priority': '1',
                'X-MSMail-Priority': 'High',
                'Importance': 'high',
                'X-Mailer': 'LifeMed Connect Mailer',
                'Reply-To': from,
                'Return-Path': from
            }
        };

        try {
            const info = await this.transporter.sendMail(mailOptions);
            logger.info('Email sent successfully', { 
                to, 
                subject, 
                messageId: info.messageId 
            });
            return { success: true, messageId: info.messageId };
        } catch (error) {
            logger.error('Failed to send email', { 
                to, 
                subject, 
                error: error.message 
            });
            return { success: false, message: error.message };
        }
    }

    generateOtpEmailHtml(otp, expiryMinutes) {
        const baseUrl = process.env.BASE_URL || 'http://localhost:5050';
        const logoUrl = `${baseUrl}/img/logo/logo-light-streamline.png`;
        
        return `
<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <style>
        * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
        }
        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
            line-height: 1.6;
            color: #1a1a1a;
            background-color: #f9fafb;
            padding: 20px;
        }
        .email-wrapper {
            max-width: 600px;
            margin: 0 auto;
            background-color: #ffffff;
            border: 1px solid #e5e7eb;
        }
        .header {
            background-color: #089bab;
            padding: 32px 40px;
            text-align: center;
        }
        .logo {
            max-width: 160px;
            height: auto;
            margin-bottom: 16px;
        }
        .header-title {
            color: #ffffff;
            font-size: 20px;
            font-weight: 600;
            margin: 0;
            letter-spacing: -0.3px;
        }
        .content {
            padding: 40px;
        }
        .message {
            font-size: 15px;
            color: #374151;
            margin-bottom: 32px;
            line-height: 1.6;
        }
        .otp-container {
            background-color: #f9fafb;
            border: 2px solid #089bab;
            padding: 24px;
            text-align: center;
            margin: 32px 0;
        }
        .otp-label {
            color: #6b7280;
            font-size: 12px;
            font-weight: 500;
            text-transform: uppercase;
            letter-spacing: 0.5px;
            margin-bottom: 12px;
        }
        .otp-code {
            color: #033e45;
            font-size: 40px;
            font-weight: 600;
            letter-spacing: 8px;
            font-family: 'SF Mono', 'Monaco', 'Inconsolata', 'Roboto Mono', 'Consolas', 'Courier New', monospace;
            margin: 12px 0;
        }
        .expiry-info {
            color: #6b7280;
            font-size: 13px;
            margin-top: 12px;
        }
        .info-text {
            font-size: 14px;
            color: #6b7280;
            margin: 24px 0;
            line-height: 1.6;
        }
        .security-note {
            font-size: 13px;
            color: #9ca3af;
            margin-top: 24px;
            padding-top: 24px;
            border-top: 1px solid #e5e7eb;
        }
        .footer {
            background-color: #f9fafb;
            padding: 24px 40px;
            text-align: center;
            border-top: 1px solid #e5e7eb;
        }
        .footer-brand {
            color: #089bab;
            font-size: 15px;
            font-weight: 600;
            margin-bottom: 8px;
        }
        .footer-text {
            color: #9ca3af;
            font-size: 12px;
            margin: 4px 0;
        }
    </style>
</head>
<body>
    <div class="email-wrapper">
        <div class="header">
            <img src="cid:logo" alt="LifeMed Connect" class="logo">
            <h1 class="header-title">Password Reset Request</h1>
        </div>
        
        <div class="content">
            <p class="message">
                We received a request to reset your password. Please use the verification code below to complete the process.
            </p>
            
            <div class="otp-container">
                <div class="otp-label">Verification Code</div>
                <div class="otp-code">${otp}</div>
                <div class="expiry-info">Valid for ${expiryMinutes} minutes</div>
            </div>
            
            <p class="info-text">
                If you didn't request this password reset, please ignore this email or contact support.
            </p>
            
            <p class="security-note">
                Never share this code with anyone. Our team will never ask for your verification code.
            </p>
        </div>
        
        <div class="footer">
            <div class="footer-brand">LifeMed Connect</div>
            <p class="footer-text">Healthcare Management System</p>
            <p class="footer-text">© ${new Date().getFullYear()} LifeMed Connect. All rights reserved.</p>
        </div>
    </div>
</body>
</html>`;
    }

    async sendOtpEmail(to, otp, expiryMinutes = 10) {
        const subject = 'Password Reset OTP - LifeMed Connect';
        const text = `Your OTP code is ${otp}. It expires in ${expiryMinutes} minutes. If you didn't request this, please ignore this email.`;
        const html = this.generateOtpEmailHtml(otp, expiryMinutes);

        // Add logo as attachment to make it visible in email clients
        const path = require('path');
        const fs = require('fs');
        const logoPath = path.resolve(__dirname, '..', 'public', 'img', 'logo', 'logo-light-streamline.png');
        const attachments = [];
        
        if (fs.existsSync(logoPath)) {
            attachments.push({
                filename: 'logo.png',
                path: logoPath,
                contentType: 'image/png',
                cid: 'logo'
            });
        }

        return await this.sendEmailWithAttachment({ to, subject, text, html, attachments });
    }

    async sendEmailWithAttachment({ to, subject, text, html, attachments, cc = null }) {
        if (!this.isEnabled) {
            logger.info('Email sending skipped (EMAIL_ENABLED=false)', { to, subject });
            return { success: false, message: 'Email service is disabled' };
        }

        if (!this.transporter) {
            logger.error('Email transporter not initialized', { to, subject });
            return { success: false, message: 'Email service not configured' };
        }

        const from = process.env.SMTP_FROM || process.env.SMTP_USER;
        const fromName = process.env.SMTP_FROM_NAME || 'LifeMed Connect';
        
        const mailOptions = {
            from: `"${fromName}" <${from}>`,
            to,
            subject,
            text,
            html: html || text,
            attachments,
            cc: cc && cc.length > 0 ? cc : undefined,
            headers: {
                'X-Priority': '1',
                'X-MSMail-Priority': 'High',
                'Importance': 'high',
                'X-Mailer': 'LifeMed Connect Mailer',
                'Reply-To': from,
                'Return-Path': from
            }
        };

        try {
            const info = await this.transporter.sendMail(mailOptions);
            logger.info('Email with attachment sent successfully', { 
                to, 
                subject, 
                messageId: info.messageId,
                attachmentCount: attachments?.length || 0
            });
            return { success: true, messageId: info.messageId };
        } catch (error) {
            logger.error('Failed to send email with attachment', { 
                to, 
                subject, 
                error: error.message 
            });
            return { success: false, message: error.message };
        }
    }

    generateAppointmentCompletionEmailHtml(appointmentData) {
        const baseUrl = process.env.BASE_URL || 'http://localhost:5050';
        const logoUrl = `${baseUrl}/img/logo/logo-light-streamline.png`;
        
        const formatDate = (dateStr) => {
            if (!dateStr) return '-';
            const date = new Date(dateStr);
            return date.toLocaleDateString('en-IN', { 
                day: '2-digit', 
                month: 'short', 
                year: 'numeric',
                hour: '2-digit',
                minute: '2-digit'
            });
        };

        return `
<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
            line-height: 1.6;
            color: #1a1a1a;
            background-color: #f9fafb;
            padding: 20px;
        }
        .email-wrapper {
            max-width: 600px;
            margin: 0 auto;
            background-color: #ffffff;
            border: 1px solid #e5e7eb;
        }
        .header {
            background-color: #089bab;
            padding: 24px 40px;
            text-align: center;
        }
        .logo {
            max-width: 140px;
            height: auto;
            margin-bottom: 12px;
        }
        .header-title {
            color: #ffffff;
            font-size: 18px;
            font-weight: 600;
            margin: 0;
        }
        .content {
            padding: 32px 40px;
        }
        .message {
            font-size: 15px;
            color: #374151;
            margin-bottom: 24px;
        }
        .details-table {
            width: 100%;
            border-collapse: collapse;
            margin: 24px 0;
        }
        .details-table th {
            background-color: #f9fafb;
            text-align: left;
            padding: 10px 12px;
            font-size: 11px;
            font-weight: 600;
            color: #6b7280;
            text-transform: uppercase;
            letter-spacing: 0.5px;
            border-bottom: 1px solid #e5e7eb;
        }
        .details-table td {
            padding: 10px 12px;
            font-size: 14px;
            color: #1a1a1a;
            border-bottom: 1px solid #e5e7eb;
        }
        .section-title {
            font-size: 14px;
            font-weight: 600;
            color: #033e45;
            margin: 24px 0 12px 0;
            padding-bottom: 8px;
            border-bottom: 2px solid #089bab;
        }
        .info-row {
            display: flex;
            margin-bottom: 8px;
        }
        .info-label {
            font-size: 13px;
            color: #6b7280;
            width: 140px;
            flex-shrink: 0;
        }
        .info-value {
            font-size: 13px;
            color: #1a1a1a;
            font-weight: 500;
        }
        .attachment-note {
            background-color: #f0fdf4;
            border: 1px solid #bbf7d0;
            padding: 12px 16px;
            margin: 24px 0;
            font-size: 13px;
            color: #166534;
        }
        .footer {
            background-color: #f9fafb;
            padding: 20px 40px;
            text-align: center;
            border-top: 1px solid #e5e7eb;
        }
        .footer-brand {
            color: #089bab;
            font-size: 14px;
            font-weight: 600;
            margin-bottom: 4px;
        }
        .footer-text {
            color: #9ca3af;
            font-size: 11px;
            margin: 2px 0;
        }
    </style>
</head>
<body>
    <div class="email-wrapper">
        <div class="header">
            <img src="cid:logo" alt="LifeMed Connect" class="logo">
            <h1 class="header-title">Appointment Completed</h1>
        </div>
        
        <div class="content">
            <p class="message">
                The following appointment has been completed and verified. Please find the detailed report attached.
            </p>

            <div class="section-title">Customer Details</div>
            <table class="details-table">
                <tr>
                    <th>Name</th>
                    <td>${appointmentData.customer_first_name || ''} ${appointmentData.customer_last_name || ''}</td>
                </tr>
                <tr>
                    <th>Email</th>
                    <td>${appointmentData.customer_email || '-'}</td>
                </tr>
                <tr>
                    <th>Mobile</th>
                    <td>${appointmentData.customer_mobile || '-'}</td>
                </tr>
            </table>

            <div class="section-title">Appointment Details</div>
            <table class="details-table">
                <tr>
                    <th>Application No</th>
                    <td>${appointmentData.application_number || `-`}</td>
                </tr>
                <tr>
                    <th>Case No</th>
                    <td>${appointmentData.case_number || '-'}</td>
                </tr>
                <tr>
                    <th>Visit Type</th>
                    <td>${appointmentData.visit_type || '-'}</td>
                </tr>
                <tr>
                    <th>Completion Time</th>
                    <td>${formatDate(appointmentData.qc_completed_at || appointmentData.updated_at)}</td>
                </tr>
            </table>

            <div class="section-title">Service Details</div>
            <table class="details-table">
                <tr>
                    <th>Client</th>
                    <td>${appointmentData.client_name || '-'}</td>
                </tr>
                <tr>
                    <th>Insurer</th>
                    <td>${appointmentData.insurer_name || '-'}</td>
                </tr>
                ${appointmentData.center_name ? `
                <tr>
                    <th>Center</th>
                    <td>${appointmentData.center_name}</td>
                </tr>
                ` : ''}
                ${appointmentData.technician_name ? `
                <tr>
                    <th>Technician</th>
                    <td>${appointmentData.technician_name}</td>
                </tr>
                ` : ''}
            </table>

            <div class="attachment-note">
                The complete appointment report (PDF) is attached to this email.
            </div>
        </div>
        
        <div class="footer">
            <div class="footer-brand">LifeMed Connect</div>
            <p class="footer-text">Healthcare Management System</p>
            <p class="footer-text">This is an automated notification. Please do not reply.</p>
        </div>
    </div>
</body>
</html>`;
    }

    async sendAppointmentCompletionEmail(to, appointmentData, pdfPath, cc = null) {
        const appointmentNumber = appointmentData.application_number || `Application`;
        const subject = `Appointment Completed - ${appointmentNumber}`;
        const text = `Appointment ${appointmentNumber} has been completed. Please find the report attached.`;
        const html = this.generateAppointmentCompletionEmailHtml(appointmentData);

        const attachments = [];
        
        // Add logo as attachment to make it visible in email clients
        const path = require('path');
        const fs = require('fs');
        const logoPath = path.resolve(__dirname, '..', 'public', 'img', 'logo', 'logo-light-streamline.png');
        if (fs.existsSync(logoPath)) {
            attachments.push({
                filename: 'logo.png',
                path: logoPath,
                contentType: 'image/png',
                cid: 'logo'
            });
        }
        
        if (pdfPath) {
            const absolutePath = path.resolve(__dirname, '..', pdfPath);
            
            if (fs.existsSync(absolutePath)) {
                attachments.push({
                    filename: `Report_${appointmentData.application_number || `Appointment-${appointmentData.id}`}.pdf`,
                    path: absolutePath,
                    contentType: 'application/pdf'
                });
            }
        }

        return await this.sendEmailWithAttachment({ to, subject, text, html, attachments, cc });
    }
}

// Export singleton instance
const emailService = new EmailService();
module.exports = emailService;
