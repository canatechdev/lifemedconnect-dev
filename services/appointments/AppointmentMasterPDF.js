const puppeteer = require('puppeteer');
const path = require('path');
const fs = require('fs').promises;
const { PDFDocument } = require('pdf-lib');
const db = require('../../lib/dbconnection');
const logger = require('../../lib/logger');
const { safeText, unwrapRows, getLetterheadDataUrl, parseApiDate, isAbnormal, generateFilename, collectImagePaths, buildPdfHtml, generatePdfBuffer, getStandardMargins } = require('../../lib/pdfUtils');
const { sanitizeFolderName } = require('../../lib/fileUpload');

class AppointmentMasterPDFService {
    /**
     * Generate comprehensive master PDF for completed appointment
     */
    async generateMasterPDF(appointmentId) {
        try {
            const appointmentData = await this.fetchAppointmentData(appointmentId);
            if (!appointmentData) {
                throw new Error('Appointment not found');
            }

            const { html, headerDataUrl, footerDataUrl } = await this.generateHTML(appointmentData);
            const masterPdfBuffer = await this.generatePDFFromHTML(html, headerDataUrl, footerDataUrl);

            // Append full-page versions of all images (documents/images/medicalFiles) before merging PDFs
            const imagePaths = collectImagePaths(appointmentData);
            const withImagesBuffer = await this.appendImagesToPdf(masterPdfBuffer, imagePaths);
            
            // Merge uploaded PDFs if any
            const finalPdfBuffer = await this.mergeUploadedPDFs(withImagesBuffer, appointmentData.reports || []);
            
            const savedPath = await this.savePDF(finalPdfBuffer, appointmentData.case_number);
            const baseUrl = process.env.BASE_URL || 'http://localhost:5050';
            const pdfUrl = `${baseUrl}/${savedPath}`;

            return {
                success: true,
                pdfPath: savedPath,
                pdfUrl,
                message: 'Master PDF generated successfully'
            };
        } catch (error) {
            console.error('Error generating master PDF:', error);
            throw error;
        }
    }

    /**
     * Fetch all appointment related data
     */
    async fetchAppointmentData(appointmentId) {
        const appointments = await db.query(
            `SELECT a.*, 
                    c.client_name, c.client_code,
                    i.insurer_name, i.insurer_code,
                    dc.center_name, dc.address as center_address, 
                    dc.city as center_city, dc.state as center_state,
                    dc.letterhead_path as center_logo, dc.footer_path as center_footer, dc.contact_number as center_contact,
                    t.full_name as technician_name, t.technician_code, t.mobile as technician_mobile
             FROM appointments a
             LEFT JOIN clients c ON a.client_id = c.id
             LEFT JOIN insurers i ON a.insurer_id = i.id
             LEFT JOIN diagnostic_centers dc ON a.center_id = dc.id
             LEFT JOIN technicians t ON a.assigned_technician_id = t.id
             WHERE a.id = ?`,
            [appointmentId]
        );

        if (!appointments || appointments.length === 0) {
            return null;
        }

        const appointment = appointments[0];

        const tests = await db.query(
            `SELECT at.*, 
                    t.test_name, t.description as test_description, t.report_type as test_report_type,
                    tc.category_name, tc.description as category_description, tc.report_type as category_report_type
             FROM appointment_tests at
             LEFT JOIN tests t ON at.test_id = t.id
             LEFT JOIN test_categories tc ON at.category_id = tc.id
             WHERE at.appointment_id = ?
             ORDER BY at.rate_type, at.item_name`,
            [appointmentId]
        );

        const documents = await db.query(
            `SELECT * FROM appointment_documents WHERE appointment_id = ? AND is_deleted = 0 ORDER BY uploaded_at`,
            [appointmentId]
        );

        const images = await db.query(
            `SELECT * FROM appointment_customer_images WHERE appointment_id = ? AND is_deleted = 0 ORDER BY uploaded_at`,
            [appointmentId]
        );

        const medicalFiles = await db.query(
            `SELECT * FROM appointment_medical_files WHERE appointment_id = ? AND is_deleted = 0 ORDER BY uploaded_at`,
            [appointmentId]
        );

        const reports = await db.query(
            `SELECT * FROM appointment_categorized_reports WHERE appointment_id = ? AND is_deleted = 0 ORDER BY report_type, uploaded_at`,
            [appointmentId]
        );

        const pathologyRecords = await db.query(
            `SELECT * FROM appointment_pathology_data WHERE appointment_id = ? ORDER BY created_at DESC LIMIT 1`,
            [appointmentId]
        );

        let pathologyData = null;
        if (pathologyRecords.length > 0) {
            const record = pathologyRecords[0];
            pathologyData = {
                ...record,
                data: record.data_json ? JSON.parse(record.data_json) : null
            };
        }

        return {
            ...appointment,
            tests,
            documents,
            images,
            medicalFiles,
            reports,
            pathologyData
        };
    }

    parseDateFromAPI(dateString) {
        return parseApiDate(dateString);
    }

    isAbnormal(result, normalRange) {
        return isAbnormal(result, normalRange);
    }

    async appendImagesToPdf(masterPdfBuffer, imagePaths) {
        if (!imagePaths || imagePaths.length === 0) return masterPdfBuffer;

        const masterPdf = await PDFDocument.load(masterPdfBuffer);
        const baseDir = path.resolve(__dirname, '../../');

        for (const relPath of imagePaths) {
            try {
                const absPath = path.isAbsolute(relPath) ? relPath : path.join(baseDir, relPath);
                const bytes = await fs.readFile(absPath);
                const ext = path.extname(absPath).toLowerCase();
                let embedded;
                if (ext === '.pdf') {
                    // Merge PDF directly
                    const pdfBytes = await fs.readFile(absPath);
                    const imagePdf = await PDFDocument.load(pdfBytes);
                    const pages = await masterPdf.copyPages(imagePdf, imagePdf.getPageIndices());
                    pages.forEach(page => masterPdf.addPage(page));
                    continue; // Skip the rest for PDFs as they're already merged
                } else if (ext === '.png') {
                    embedded = await masterPdf.embedPng(bytes);
                } else {
                    embedded = await masterPdf.embedJpg(bytes);
                }
                const { width, height } = embedded.scale(1);
                const page = masterPdf.addPage([595.28, 841.89]); // A4 in points
                const margin = 36;
                const maxWidth = page.getWidth() - margin * 2;
                const maxHeight = page.getHeight() - margin * 2;
                const scale = Math.min(maxWidth / width, maxHeight / height, 1);
                const scaledWidth = width * scale;
                const scaledHeight = height * scale;
                const x = (page.getWidth() - scaledWidth) / 2;
                const y = (page.getHeight() - scaledHeight) / 2;
                page.drawImage(embedded, { x, y, width: scaledWidth, height: scaledHeight });
            } catch (err) {
                console.error('Failed to append image to PDF:', relPath, err.message);
                continue;
            }
        }

        return await masterPdf.save();
    }

    groupPathologyData(data) {
        const grouped = {};
        data.forEach(item => {
            const dept = item.SubDeptName || 'Other';
            const test = item.TestName || 'Unknown Test';
            if (!grouped[dept]) {
                grouped[dept] = {};
            }
            if (!grouped[dept][test]) {
                grouped[dept][test] = [];
            }
            grouped[dept][test].push(item);
        });
        return grouped;
    }

    async generateHTML(data) {
        const baseUrl = process.env.BASE_URL || 'http://localhost:5050';
        const baseDir = path.resolve(__dirname, '../../');
        
        // Convert header/footer to data URLs for reliable embedding
        const headerDataUrl = data.center_logo ? await getLetterheadDataUrl(data.center_logo, baseDir) : null;
        const footerDataUrl = data.center_footer ? await getLetterheadDataUrl(data.center_footer, baseDir) : null;
        
        // Generate content sections
        const content = this.generateMasterContent(data, baseUrl);
        
        const html = buildPdfHtml({
            content,
            title: `Master Report - ${data.case_number}`,
            customStyles: this.getMasterStyles()
        });
        
        return { html, headerDataUrl, footerDataUrl };
    }

    /**
     * Generate master report content HTML
     */
    generateMasterContent(data, baseUrl) {
        const appointmentInfoSection = this.generateAppointmentInfoSection(data);
        const testsSection = this.generateTestsSection(data.tests);
        const documentsSection = this.generateDocumentsSection(data.documents, baseUrl);
        const imagesSection = this.generateImagesSection(data.images, baseUrl);
        const medicalFilesSection = this.generateMedicalFilesSection(data.medicalFiles, baseUrl);
        const reportsSection = this.generateReportsSection(data.reports, baseUrl);
        const pathologySection = this.generatePathologySection(data.pathologyData, data.reports, data);

        return `
            <div class="master-report-title">
                <h1>Comprehensive Medical Report</h1>
            </div>
            ${appointmentInfoSection}
            ${testsSection}
            ${documentsSection}
            ${imagesSection}
            ${medicalFilesSection}
            ${reportsSection}
            ${pathologySection}
            <div class="master-note">
                <p><strong>Confidential Medical Report</strong></p>
                <p>Case: ${data.case_number} | Generated: ${new Date().toLocaleString('en-IN')}</p>
                <p>This is a computer-generated document.</p>
            </div>
        `;
    }

    /**
     * Get master report specific styles
     */
    getMasterStyles() {
        // Import pathology styles to ensure exact same styling as standalone PDF
        const { getPathologyStyles } = require('./AppointmentPathology');
        const pathologyStyles = getPathologyStyles();
        
        return `
            .master-report-title {
                text-align: center;
                margin: 0 0 12pt 0;
                padding: 8pt 12pt;
                background: linear-gradient(135deg, #1f4b99 0%, #143266 100%);
                color: white;
                border-radius: 0;
            }
            
            .master-report-title h1 {
                font-size: 16pt;
                font-weight: 600;
                text-transform: uppercase;
                letter-spacing: 1px;
                margin: 0;
            }
            
            /* Include exact pathology styles from standalone PDF */
            ${pathologyStyles}
            
            .section {
                margin-bottom: 12pt;
                page-break-inside: avoid;
            }
            
            .section-header {
                font-size: 11pt;
                font-weight: 700;
                color: #143266;
                padding: 8pt 10pt;
                background: #e7f0fa;
                text-transform: uppercase;
                letter-spacing: 0.5px;
                border-left: 3px solid #143266;
                border-radius: 0;
                margin-bottom: 8pt;
            }
            
            .info-grid {
                display: grid;
                grid-template-columns: repeat(3, 1fr);
                gap: 8pt;
            }
            
            .info-item {
                padding: 6pt;
                background: #f8f9fa;
                border-radius: 0;
                border: 0.5pt solid #e9ecef;
            }
            
            .info-label {
                font-size: 8pt;
                font-weight: 700;
                color: #6c757d;
                text-transform: uppercase;
                letter-spacing: 0.3px;
                margin-bottom: 2pt;
            }
            
            .info-value {
                font-size: 10pt;
                font-weight: 600;
                color: #212529;
            }
            
            .badge {
                display: inline-block;
                padding: 2pt 6pt;
                border-radius: 0;
                font-size: 7pt;
                font-weight: 700;
                text-transform: uppercase;
            }
            
            .badge-success { background: #d4edda; color: #155724; }
            .badge-warning { background: #fff3cd; color: #856404; }
            .badge-info { background: #d1ecf1; color: #0c5460; }
            
            table {
                width: 100%;
                border-collapse: collapse;
                margin-bottom: 8pt;
            }
            th {
                padding: 6pt 8pt;
                text-align: left;
                font-size: 9pt;
                font-weight: 600;
                text-transform: uppercase;
                letter-spacing: 0.5px;
                background: #f8f9fa;
                border-bottom: 0.5pt solid #dee2e6;
            }
            td {
                padding: 6pt 8pt;
                font-size: 9pt;
                border-bottom: 0.5pt solid #f1f3f5;
                vertical-align: top;
            }
            
            .text-right { text-align: right; }
            .text-center { text-align: center; }
            
            .image-grid {
                display: grid;
                grid-template-columns: repeat(3, 1fr);
                gap: 8pt;
                margin-bottom: 8pt;
            }
            
            .image-card {
                border: 1pt solid #dee2e6;
                padding: 5pt;
                text-align: center;
                page-break-inside: avoid;
                border-radius: 0;
            }
            
            .image-card img {
                max-width: 100%;
                max-height: 150pt;
                object-fit: contain;
                margin-bottom: 4pt;
            }
            
            .image-label {
                font-size: 8pt;
                color: #495057;
                font-weight: 600;
            }
            
            .image-meta {
                font-size: 6pt;
                color: #6c757d;
            }
            
            .doc-image-large {
                max-width: 100%;
                max-height: 200pt;
                border: 0.5pt solid #dee2e6;
                margin: 4pt 0;
            }
            
            .report-list {
                display: flex;
                flex-direction: column;
                gap: 6pt;
            }
            
            .report-entry {
                padding: 6pt 8pt;
                border: 0.5pt solid #dee2e6;
                background: #f8f9fa;
                border-radius: 0;
            }
            
            .report-entry strong { color: #1f4b99; }
            
            .department { margin-bottom: 8pt; }
            
            .department-header {
                background: #e7f0fa;
                color: #1f4b99;
                padding: 5pt 8pt;
                font-size: 9pt;
                font-weight: 700;
                text-transform: uppercase;
                border-left: 2pt solid #1f4b99;
                border-radius: 0;
            }
            
            .pathology-test-section {
                margin-bottom: 6pt;
                border: 0.5pt solid #dee2e6;
                border-radius: 0;
            }
            
            .pathology-test-header {
                background: #f8f9fa;
                padding: 4pt 8pt;
                font-weight: 600;
                font-size: 8pt;
                color: #495057;
                border-bottom: 0.5pt solid #dee2e6;
                border-radius: 0;
            }
            
            .abnormal { background: #fff5f5 !important; }
            .abnormal td { color: #dc2626; font-weight: 700; }
            
            .abnormal-marker {
                display: inline-block;
                background: #dc2626;
                color: white;
                padding: 1pt 3pt;
                border-radius: 0;
                font-size: 6pt;
                font-weight: 700;
                margin-left: 3pt;
            }
            
            .pathology-note {
                padding: 8pt 10pt;
                background: #e7f0fa;
                border-left: 3pt solid #1f4b99;
                border-radius: 0;
                font-size: 8pt;
                color: #495057;
            }
            
            .master-note {
                margin-top: 12pt;
                padding: 10pt;
                background: #f8f9fa;
                border: 0.5pt solid #e9ecef;
                border-radius: 0;
                color: #495057;
                font-size: 9pt;
            }
        `;
    }

    generateAppointmentInfoSection(data) {
        const formatDate = (date) => {
            if (!date) return 'N/A';
            const d = new Date(date);
            return `${String(d.getDate()).padStart(2, '0')}-${String(d.getMonth() + 1).padStart(2, '0')}-${d.getFullYear()}`;
        };
        return `<div class="section"><div class="section-header">Patient & Appointment Information</div><div class="info-grid"><div class="info-item"><div class="info-label">Case Number</div><div class="info-value">${data.case_number || 'N/A'}</div></div><div class="info-item"><div class="info-label">Application Number</div><div class="info-value">${data.application_number || 'N/A'}</div></div><div class="info-item"><div class="info-label">Status</div><div class="info-value"><span class="badge ${data.qc_status === 'completed' ? 'badge-success' : 'badge-warning'}">${data.qc_status || data.status || 'N/A'}</span></div></div><div class="info-item"><div class="info-label">Patient Name</div><div class="info-value">${data.customer_first_name || ''} ${data.customer_last_name || ''}</div></div><div class="info-item"><div class="info-label">Gender</div><div class="info-value">${data.gender || 'N/A'}</div></div><div class="info-item"><div class="info-label">Date of Birth</div><div class="info-value">${data.date_of_birth ? formatDate(data.date_of_birth) : 'N/A'}</div></div><div class="info-item"><div class="info-label">Mobile</div><div class="info-value">${data.customer_mobile || 'N/A'}</div></div><div class="info-item"><div class="info-label">Email</div><div class="info-value">${data.customer_email || 'N/A'}</div></div><div class="info-item"><div class="info-label">Confirmed Date</div><div class="info-value">${data.confirmed_date ? formatDate(data.confirmed_date) : 'N/A'}</div></div><div class="info-item"><div class="info-label">Visit Type</div><div class="info-value">${data.visit_type || 'N/A'}</div></div><div class="info-item"><div class="info-label">Customer Category</div><div class="info-value">${data.customer_category || 'N/A'}</div></div><div class="info-item"><div class="info-label">Cost Type</div><div class="info-value">${data.cost_type || 'N/A'}</div></div><div class="info-item"><div class="info-label">Amount</div><div class="info-value">${data.amount ? '₹' + parseFloat(data.amount).toFixed(2) : 'N/A'}</div></div><div class="info-item"><div class="info-label">Address</div><div class="info-value">${data.customer_address || 'N/A'}</div></div><div class="info-item"><div class="info-label">City/State</div><div class="info-value">${data.city || 'N/A'}, ${data.state || 'N/A'}</div></div><div class="info-item"><div class="info-label">Pincode</div><div class="info-value">${data.pincode || 'N/A'}</div></div><div class="info-item"><div class="info-label">Client</div><div class="info-value">${data.client_name || 'N/A'} </div></div><div class="info-item"><div class="info-label">Insurer</div><div class="info-value">${data.insurer_name || 'N/A'}</div></div><div class="info-item"><div class="info-label">Center</div><div class="info-value">${data.center_name || 'N/A'}</div></div><div class="info-item"><div class="info-label">Technician</div><div class="info-value">${data.technician_name || 'N/A'}</div></div>${data.remarks ? `<div class="info-item" style="grid-column: span 3;"><div class="info-label">Remarks</div><div class="info-value">${data.remarks}</div></div>` : ''}${data.medical_remarks ? `<div class="info-item" style="grid-column: span 3;"><div class="info-label">Medical Remarks</div><div class="info-value">${data.medical_remarks}</div></div>` : ''}</div></div>`;
    }

    generateTestsSection(tests) {
        if (!tests || tests.length === 0) return '';
        const testItems = tests.filter(t => t.rate_type === 'test');
        const categoryItems = tests.filter(t => t.rate_type === 'category');
        let html = `<div class="section"><div class="section-header">Tests & Categories (${tests.length} items)</div>`;
        if (testItems.length > 0) {
            html += `<table><thead><tr><th style="width: 30%;">Test Name</th><th style="width: 40%;">Description</th><th style="width: 15%;">Report Type</th><th style="width: 15%;">Rate (₹)</th></tr></thead><tbody>`;
            testItems.forEach(test => {
                html += `<tr><td><strong>${test.item_name || test.test_name || 'N/A'}</strong></td><td>${test.test_description || 'N/A'}</td><td><span class="badge badge-info">${test.test_report_type || 'N/A'}</span></td><td style="text-align: right; font-weight: 600; color: #28a745;">${test.rate ? parseFloat(test.rate).toFixed(2) : '0.00'}</td></tr>`;
            });
            html += `</tbody></table>`;
        }
        if (categoryItems.length > 0) {
            html += `<div style="margin-top: 10px;"><div style="font-weight: 600; font-size: 10pt; margin-bottom: 5px; color: #004999;">Categories</div><table><thead><tr><th style="width: 30%;">Category Name</th><th style="width: 40%;">Description</th><th style="width: 15%;">Report Types</th><th style="width: 15%;">Rate (₹)</th></tr></thead><tbody>`;
            categoryItems.forEach(cat => {
                const reportTypes = cat.category_report_type ? (Array.isArray(cat.category_report_type) ? cat.category_report_type.join(', ') : cat.category_report_type) : 'N/A';
                html += `<tr><td><strong>${cat.item_name || cat.category_name || 'N/A'}</strong></td><td>${cat.category_description || 'N/A'}</td><td><span class="badge badge-info">${reportTypes}</span></td><td style="text-align: right; font-weight: 600; color: #28a745;">${cat.rate ? parseFloat(cat.rate).toFixed(2) : '0.00'}</td></tr>`;
            });
            html += `</tbody></table></div>`;
        }
        html += `</div>`;
        return html;
    }

    generateDocumentsSection(documents, baseUrl) {
        if (!documents || documents.length === 0) return '';
        let html = `<div class="section"><div class="section-header">Customer Documents (${documents.length} documents)</div><div class="image-grid">`;
        documents.forEach(doc => {
            const filePath = doc.file_path || '';
            const fileName = doc.file_name || 'Document';
            const docType = doc.doc_type || 'Document';
            const docNumber = doc.doc_number || '';
            const isImage = /\.(jpg|jpeg|png|gif|webp)$/i.test(filePath);
            const fullImageUrl = isImage && filePath ? `${baseUrl}${filePath.startsWith('/') ? '' : '/'}${filePath}` : '';
            if (isImage) {
                html += `<div class="image-card"><img src="${fullImageUrl}" alt="${fileName}" class="doc-image-large" /><div class="image-label">${docType} ${docNumber ? `- ${docNumber}` : ''}</div><div class="image-meta">${fileName}</div></div>`;
            } else {
                html += `<div class="image-card" style="padding: 20px; background: #f8f9fa;"><div style="font-size: 24pt; color: #dc2626; margin-bottom: 10px;">📄 PDF</div><div class="image-label">${docType} ${docNumber ? `- ${docNumber}` : ''}</div><div class="image-meta">${fileName}</div><div style="font-size: 8pt; color: #6c757d; margin-top: 5px;">PDF file attached separately</div></div>`;
            }
        });
        html += `</div></div>`;
        return html;
    }

    generateImagesSection(images, baseUrl) {
        if (!images || images.length === 0) return '';
        let html = `<div class="section"><div class="section-header">Customer Images (${images.length} images)</div><div class="image-grid">`;
        images.forEach(img => {
            const filePath = img.file_path || '';
            const label = img.image_label || 'Image';
            const fileName = img.file_name || '';
            const fullImageUrl = filePath ? `${baseUrl}${filePath.startsWith('/') ? '' : '/'}${filePath}` : '';
            html += `<div class="image-card"><img src="${fullImageUrl}" alt="${label}" /><div class="image-label">${label}</div><div class="image-meta">${fileName}</div></div>`;
        });
        html += `</div></div>`;
        return html;
    }

    generateMedicalFilesSection(files, baseUrl) {
        if (!files || files.length === 0) return '';
        let html = `<div class="section"><div class="section-header">Medical Files (${files.length} files)</div><div class="image-grid">`;
        files.forEach(file => {
            const filePath = file.file_path || '';
            const fileName = file.file_name || 'Medical File';
            const isImage = /\.(jpg|jpeg|png|gif|webp)$/i.test(filePath);
            const fullImageUrl = isImage && filePath ? `${baseUrl}${filePath.startsWith('/') ? '' : '/'}${filePath}` : '';
            if (isImage) {
                html += `<div class="image-card"><img src="${fullImageUrl}" alt="${fileName}" /><div class="image-label">Medical Image</div><div class="image-meta">${fileName}</div></div>`;
            } else {
                html += `<div class="image-card" style="padding: 15px; background: #f8f9fa;"><div style="font-size: 20pt; color: #0066cc; margin-bottom: 8px;">📄</div><div class="image-label">Medical Document</div><div class="image-meta">${fileName}</div></div>`;
            }
        });
        html += `</div></div>`;
        return html;
    }

    generateReportsSection(reports, baseUrl) {
        if (!reports || reports.length === 0) return '';
        const reportsByType = {};
        reports.forEach(report => {
            const type = report.report_type || 'Other';
            if (!reportsByType[type]) reportsByType[type] = [];
            reportsByType[type].push(report);
        });
        let html = `<div class="section"><div class="section-header">Uploaded Reports (${reports.length} files)</div>`;
        Object.keys(reportsByType).forEach(type => {
            html += `<div style="margin-bottom: 10px;"><div style="font-weight: 600; font-size: 10pt; color: #1f4b99; margin-bottom: 5px; text-transform: capitalize;">${type} Reports (${reportsByType[type].length})</div><div class="report-list">`;
            reportsByType[type].forEach(report => {
                const date = report.uploaded_at ? new Date(report.uploaded_at).toLocaleDateString('en-IN') : '';
                const isPdf = report.file_path && /\.pdf$/i.test(report.file_path);
                html += `<div class="report-entry">
                    <div><strong>${report.file_name || 'Report'}</strong>${date ? ` <span style="color:#6c757d; font-size:8pt;">(${date})</span>` : ''}</div>
                    ${isPdf ? '<div style="font-size: 8pt; color: #28a745; margin-top: 3px;">✓ PDF pages merged into this report</div>' : ''}
                </div>`;
            });
            html += `</div></div>`;
        });
        html += `</div>`;
        return html;
    }

    generatePathologySection(pathologyData, reports = [], appointmentData = null) {
        if (!pathologyData || !pathologyData.data || !Array.isArray(pathologyData.data) || pathologyData.data.length === 0) {
            return '';
        }
        
        // Import the pathology content generator to use exact same logic as standalone PDF
        const { generatePathologyContent } = require('./AppointmentPathology');
        
        // Use exact same appointment data structure as standalone pathology PDF
        const appointmentInfo = {
            customer_first_name: appointmentData?.customer_first_name || '',
            customer_last_name: appointmentData?.customer_last_name || '',
            case_number: appointmentData?.case_number || ''
        };
        
        // Generate pathology content using exact same function as standalone PDF
        const { content, patientInfoHeaderHtml } = generatePathologyContent(pathologyData.data, appointmentInfo);
        
        // Return the exact same pathology content as standalone PDF - no modifications
        return content;
    }

    async generatePDFFromHTML(htmlContent, headerDataUrl, footerDataUrl) {
        const headerHeightMm = 38;
        const footerHeightMm = 24;

        return generatePdfBuffer({
            html: htmlContent,
            headerDataUrl,
            footerDataUrl,
            headerHeightMm,
            footerHeightMm,
            margin: getStandardMargins(headerHeightMm, footerHeightMm)
        });
    }

    async mergeUploadedPDFs(masterPdfBuffer, reports) {
        // Filter only PDF reports
        const pdfReports = reports.filter(r => r.file_path && /\.pdf$/i.test(r.file_path));
        
        if (pdfReports.length === 0) {
            return masterPdfBuffer;
        }
        
        const masterPdf = await PDFDocument.load(masterPdfBuffer);
        
        for (const report of pdfReports) {
            try {
                const pdfPath = path.join(__dirname, '../../', report.file_path);
                const existingPdfBytes = await fs.readFile(pdfPath);
                const pdfDoc = await PDFDocument.load(existingPdfBytes);
                const pages = await masterPdf.copyPages(pdfDoc, pdfDoc.getPageIndices());
                pages.forEach(page => masterPdf.addPage(page));
            } catch (error) {
                console.error(`Error merging PDF ${report.file_name}:`, error);
                // Continue with other PDFs if one fails
            }
        }
        
        return await masterPdf.save();
    }

    async savePDF(pdfBuffer, caseNumber) {
        // Organize by case_number subfolder
        const safeCaseFolder = sanitizeFolderName(caseNumber);
        const uploadsDir = safeCaseFolder
            ? path.join(__dirname, '../../uploads/appointment_master_pdfs', safeCaseFolder)
            : path.join(__dirname, '../../uploads/appointment_master_pdfs');
        await fs.mkdir(uploadsDir, { recursive: true });
        const timestamp = Date.now();
        const sanitizedCaseNumber = (caseNumber || 'UNKNOWN').replace(/[^a-zA-Z0-9]/g, '_');
        const filename = `master_${sanitizedCaseNumber}_${timestamp}.pdf`;
        const filepath = path.join(uploadsDir, filename);
        await fs.writeFile(filepath, pdfBuffer);
        return safeCaseFolder
            ? `uploads/appointment_master_pdfs/${safeCaseFolder}/${filename}`
            : `uploads/appointment_master_pdfs/${filename}`;
    }
}

const appointmentMasterPDFService = new AppointmentMasterPDFService();
appointmentMasterPDFService.generateMasterPDF = appointmentMasterPDFService.generateMasterPDF.bind(appointmentMasterPDFService);
appointmentMasterPDFService.fetchAppointmentData = appointmentMasterPDFService.fetchAppointmentData.bind(appointmentMasterPDFService);
appointmentMasterPDFService.generateHTML = appointmentMasterPDFService.generateHTML.bind(appointmentMasterPDFService);
appointmentMasterPDFService.generatePDFFromHTML = appointmentMasterPDFService.generatePDFFromHTML.bind(appointmentMasterPDFService);
appointmentMasterPDFService.savePDF = appointmentMasterPDFService.savePDF.bind(appointmentMasterPDFService);

module.exports = appointmentMasterPDFService;
