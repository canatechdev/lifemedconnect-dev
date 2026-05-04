/**
 * PDF Utility Functions
 * Common utilities for PDF generation across the application
 */

const path = require('path');
const fs = require('fs').promises;
const moment = require('moment');
const logger = require('./logger');

// Default layout constants (mm)
const HEADER_HEIGHT_MM = 34;
const FOOTER_HEIGHT_MM = 21;
const SIDE_MARGIN_MM = 10;

// Legacy compatibility: template presets and stubs
const PDF_TEMPLATES = { NONE: { headerDisplay: 'none', footerDisplay: 'none' } };

// Legacy-friendly helpers
function getPdfDimensions() {
    return { width: 595.28, height: 841.89, margin: { top: 36, right: 36, bottom: 36, left: 36 } };
}

function getHeaderFooterDimensions() {
    return {
        headerHeight: HEADER_HEIGHT_MM,
        footerHeight: FOOTER_HEIGHT_MM,
        headerImageHeight: HEADER_HEIGHT_MM,
        footerImageHeight: FOOTER_HEIGHT_MM,
        contentTopMargin: 0,
        contentBottomMargin: 0
    };
}

/**
 * Convert image file to base64 data URL for embedding in HTML/PDF
 * @param {string} relativePath - Relative path to the image
 * @param {string} baseDir - Base directory (defaults to project root)
 * @param {object} logger - Optional logger for error logging
 * @returns {Promise<string|null>} Base64 data URL or null if failed
 */
async function getLetterheadDataUrl(relativePath, baseDir = null, logger = null) {
    if (!relativePath) return null;
    try {
        const resolvedBaseDir = baseDir || path.resolve(__dirname, '../');
        const absolutePath = path.isAbsolute(relativePath)
            ? relativePath
            : path.join(resolvedBaseDir, relativePath);
        const fileBuffer = await fs.readFile(absolutePath);

        const ext = path.extname(absolutePath).toLowerCase();
        const mimeTypes = {
            '.png': 'image/png',
            '.jpg': 'image/jpeg',
            '.jpeg': 'image/jpeg',
            '.webp': 'image/webp',
            '.gif': 'image/gif',
            '.bmp': 'image/bmp',
            '.svg': 'image/svg+xml'
        };
        const mimeType = mimeTypes[ext] || 'application/octet-stream';
        return `data:${mimeType};base64,${fileBuffer.toString('base64')}`;
    } catch (error) {
        if (logger && typeof logger.warn === 'function') {
            logger.warn('Failed to load letterhead image', {
                relativePath,
                error: error.message
            });
        } else {
            console.warn('Failed to load letterhead image:', relativePath, error.message);
        }
        return null;
    }
}

// Helpers to build Puppeteer header/footer templates (inline styles only)
function buildHeaderTemplate(headerDataUrl, headerHeightMm = HEADER_HEIGHT_MM, customHeaderHtml = '') {
    const imgPart = headerDataUrl
        ? `<div style="width:100%;line-height:0;"><img src="${headerDataUrl}" style="width:100%;object-fit:fill;display:block;" /></div>`
        : '';
    const customPart = customHeaderHtml
        ? `<div style="width:100%;padding:0 10mm;">${customHeaderHtml}</div>`
        : '';
    if (!imgPart && !customPart) return '<div></div>';
    return `<div style="width:100%;font-family:'Segoe UI',Arial,sans-serif;">${imgPart}${customPart}</div>`;
}

function buildFooterTemplate(footerDataUrl, footerHeightMm = FOOTER_HEIGHT_MM) {
    if (!footerDataUrl) return '<div></div>';
    return `<div style="width:100%;height:${footerHeightMm}mm;margin:0;padding:0;overflow:hidden;line-height:0;">
        <img src="${footerDataUrl}" style="width:100%;height:100%;object-fit:fill;display:block;" />
    </div>`;
}

// Legacy names for callers expecting getHeaderTemplate/getFooterTemplate
const getHeaderTemplate = (dataUrl, heightMm) => buildHeaderTemplate(dataUrl, heightMm);
const getFooterTemplate = (dataUrl, heightMm) => buildFooterTemplate(dataUrl, heightMm);

// Legacy alias for backward compatibility (kept minimal)
const buildPdfTemplate = ({ content, title, customStyles }) => buildPdfHtml({ content, title, customStyles });

function getStandardMargins(headerHeightMm = HEADER_HEIGHT_MM, footerHeightMm = FOOTER_HEIGHT_MM, sideMarginMm = SIDE_MARGIN_MM) {
    return {
        top: `${headerHeightMm + 5}mm`,
        bottom: `${footerHeightMm + 5}mm`,
        left: `${sideMarginMm}mm`,
        right: `${sideMarginMm}mm`
    };
}

// Legacy no-op CSS generator (kept for API compatibility)
function generatePdfTemplateCSS() { return ''; }

/**
 * Safely convert value to trimmed string
 * @param {*} value - Value to convert
 * @returns {string} Trimmed string or empty string
 */
function safeText(value) {
    return value == null ? '' : String(value).trim();
}

/**
 * Format currency with INR prefix
 * @param {number|string} value - Amount to format
 * @param {string} prefix - Currency prefix (default: 'INR')
 * @returns {string} Formatted currency string
 */
function formatCurrency(value, prefix = 'INR') {
    const num = parseFloat(value) || 0;
    const formatted = new Intl.NumberFormat('en-IN', {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
    }).format(num);
    return `${prefix} ${formatted}`;
}

/**
 * Format date to DD/MM/YYYY
 * @param {string|Date} date - Date to format
 * @param {string} format - Moment format string (default: 'DD/MM/YYYY')
 * @returns {string} Formatted date
 */
function formatDate(date, format = 'DD/MM/YYYY') {
    return date ? moment(date).format(format) : '';
}

/**
 * Parse date from API format /Date(1754134730940+0530)/
 * @param {string} dateString - API date string
 * @returns {string|null} Formatted date DD-MMM-YYYY HH:MM or null
 */
function parseApiDate(dateString) {
    if (!dateString || typeof dateString !== 'string') return null;

    const match = dateString.match(/\/Date\((\d+)([\+\-]\d{4})?\)\//);
    if (!match) return null;

    const timestamp = parseInt(match[1]);
    const date = new Date(timestamp);

    const day = String(date.getDate()).padStart(2, '0');
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const year = date.getFullYear();
    let hours = date.getHours();
    const minutes = String(date.getMinutes()).padStart(2, '0');
    const ampm = hours >= 12 ? 'PM' : 'AM';
    hours = hours % 12 || 12;

    return `${day}/${month}/${year} ${hours}:${minutes} ${ampm}`;
}

/**
 * Unwrap mysql2/promise results
 * @param {*} result - MySQL query result
 * @returns {Array} Unwrapped rows array
 */
function unwrapRows(result) {
    return Array.isArray(result) && result.length === 2 && Array.isArray(result[0]) ? result[0] : result;
}

/**
 * Check if a result value is outside normal range
 * @param {string|number} result - The test result value
 * @param {string} normalRange - Range like "13.5-18.0"
 * @returns {boolean} True if abnormal
 */
function isAbnormal(result, normalRange) {
    if (!result || !normalRange) return false;

    const resultNum = parseFloat(result);
    if (isNaN(resultNum)) return false;

    const rangeMatch = normalRange.match(/(\d+\.?\d*)\s*-\s*(\d+\.?\d*)/);
    if (!rangeMatch) return false;

    const min = parseFloat(rangeMatch[1]);
    const max = parseFloat(rangeMatch[2]);

    return resultNum < min || resultNum > max;
}

/**
 * Build a simple content-only HTML document.
 * Header/Footer are handled by Puppeteer headerTemplate/footerTemplate.
 */
function buildPdfHtml({ content, title = 'Report', customStyles = '' }) {
    return `<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<title>${title}</title>
<style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    body {
        font-family: 'Segoe UI', Arial, sans-serif;
        font-size: 10pt;
        line-height: 1.4;
        color: #212529;
    }

    table { width: 100%; border-collapse: collapse; margin-bottom: 8pt; }
    th {
        padding: 6pt 8pt; text-align: left; font-size: 9pt; font-weight: 600;
        color: #495057; text-transform: uppercase; border-bottom: 1.5pt solid #dee2e6;
        background: #f8f9fa;
    }
    td {
        padding: 5pt 6pt; font-size: 9pt; border-bottom: 0.5pt solid #e9ecef;
        color: #212529; vertical-align: top;
    }

    .text-center { text-align: center; }
    .text-right { text-align: right; }
    .text-left { text-align: left; }
    .font-bold { font-weight: 600; }
    .text-sm { font-size: 8pt; }
    .text-xs { font-size: 7pt; }
    .mb-2 { margin-bottom: 8pt; }
    .mb-4 { margin-bottom: 16pt; }
    .mt-2 { margin-top: 8pt; }
    .mt-4 { margin-top: 16pt; }

    .page-break { page-break-after: always; }
    .page-break-before { page-break-before: always; }
    .page-break-inside { page-break-inside: avoid; }

    .badge { display: inline-block; padding: 2pt 6pt; border-radius: 3pt; font-size: 7pt; font-weight: 600; text-transform: uppercase; }
    .badge-success { background: #d4edda; color: #155724; }
    .badge-warning { background: #fff3cd; color: #856404; }
    .badge-info { background: #d1ecf1; color: #0c5460; }
    .badge-danger { background: #f8d7da; color: #721c24; }

    ${customStyles}
</style>
</head>
<body>
    ${content}
</body>
</html>`;
}

/**
 * Generate a PDF buffer from HTML using Puppeteer native header/footer.
 * @param {object} opts
 * @param {string} opts.html - Full HTML (from buildPdfHtml)
 * @param {string} [opts.path] - Optional output path
 * @param {string} [opts.headerDataUrl]
 * @param {string} [opts.footerDataUrl]
 * @param {number} [opts.headerHeightMm]
 * @param {number} [opts.footerHeightMm]
 * @returns {Promise<Buffer>}
 */
async function generatePdfBuffer(opts) {
    const puppeteer = require('puppeteer');
    const launchOptions = {
        headless: 'new',
        args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu'],
    };

    const preferredChromePath = process.env.CHROME_PATH || '/usr/bin/google-chrome';
    if (process.platform === 'win32') {
        // let Puppeteer manage Chromium on Windows development machines
        logger.info(`Windows dev environment detected, relying on bundled Chromium`);
    } else {
        launchOptions.executablePath = preferredChromePath;
    }

    const browser = await puppeteer.launch(launchOptions);
    try {
        const page = await browser.newPage();
        await page.setContent(opts.html, { waitUntil: 'networkidle0' });

        const headerHeightMm = opts.headerHeightMm || HEADER_HEIGHT_MM;
        const footerHeightMm = opts.footerHeightMm || FOOTER_HEIGHT_MM;

        const headerTemplate = buildHeaderTemplate(opts.headerDataUrl, headerHeightMm, opts.customHeaderHtml || '');
        const footerTemplate = buildFooterTemplate(opts.footerDataUrl, footerHeightMm);

        const pdfOpts = {
            format: 'A4',
            printBackground: true,
            displayHeaderFooter: true,
            headerTemplate,
            footerTemplate,
            margin: opts.margin || getStandardMargins(headerHeightMm, footerHeightMm, SIDE_MARGIN_MM)
        };
        if (opts.path) pdfOpts.path = opts.path;

        const raw = await page.pdf(pdfOpts);
        return Buffer.isBuffer(raw) ? raw : Buffer.from(raw);
    } finally {
        await browser.close();
    }
}

// ── Legacy alias for backward compatibility (kept minimal) ──
// (Defined once at the top; no duplicate here)

/**
 * Get image dimension recommendations for user guidance
 */
function getImageRecommendations() {
    return {
        header: {
            width: 693, height: 129, ratio: '5.5:1',
            formats: ['PNG', 'JPG'], maxFileSize: '5MB',
            description: 'Header: 693×129px (183mm × 34mm), 5.5:1 ratio'
        },
        footer: {
            width: 693, height: 80, ratio: '8.7:1',
            formats: ['PNG', 'JPG'], maxFileSize: '5MB',
            description: 'Footer: 693×80px (183mm × 21mm), ~8.7:1 ratio'
        }
    };
}

/**
 * Save PDF buffer to file
 * @param {Buffer} pdfBuffer - PDF content
 * @param {string} directory - Directory to save
 * @param {string} filename - Filename (optional, auto-generated if not provided)
 * @param {string} caseNumber - Case number for filename
 * @returns {Promise<string>} Relative path to saved file
 */
async function savePdfToFile(pdfBuffer, directory, filename = null, caseNumber = '') {
    await fs.mkdir(directory, { recursive: true });

    if (!filename) {
        const timestamp = Date.now();
        const sanitizedCaseNumber = (caseNumber || 'UNKNOWN').replace(/[^a-zA-Z0-9]/g, '_');
        filename = `pdf_${sanitizedCaseNumber}_${timestamp}.pdf`;
    }

    const filepath = path.join(directory, filename);
    await fs.writeFile(filepath, pdfBuffer);

    return filepath;
}

/**
 * Generate filename with case number and timestamp
 * @param {string} prefix - Prefix like 'master', 'invoice', 'pathology'
 * @param {string} caseNumber - Case number
 * @param {string} extension - File extension (default: 'pdf')
 * @returns {string} Generated filename
 */
function generateFilename(prefix, caseNumber, extension = 'pdf') {
    const timestamp = Date.now();
    const sanitizedCaseNumber = (caseNumber || 'UNKNOWN').replace(/[^a-zA-Z0-9]/g, '_');
    return `${prefix}_${sanitizedCaseNumber}_${timestamp}.${extension}`;
}

/**
 * Collect all image paths from documents, images, and medical files
 * @param {object} data - Object containing documents, images, medicalFiles arrays
 * @returns {string[]} Array of image paths
 */
function collectImagePaths(data) {
    const imgRegex = /\.(jpg|jpeg|png|gif|webp)$/i;
    const pdfRegex = /\.pdf$/i;
    const allPaths = [];

    const pushIfImageOrPdf = (filePath) => {
        if (filePath && (imgRegex.test(filePath) || pdfRegex.test(filePath))) {
            allPaths.push(filePath);
        }
    };

    (data?.documents || []).forEach(doc => pushIfImageOrPdf(doc.file_path));
    (data?.images || []).forEach(img => pushIfImageOrPdf(img.file_path));
    (data?.medicalFiles || []).forEach(file => pushIfImageOrPdf(file.file_path));

    return allPaths;
}

module.exports = {
    // Image utilities
    getLetterheadDataUrl,
    getImageRecommendations,

    // Formatting utilities
    formatCurrency,
    formatDate,
    parseApiDate,
    safeText,
    unwrapRows,

    // New PDF system (use these)
    buildPdfHtml,
    generatePdfBuffer,

    // Legacy aliases (backward compat — avoid in new code)
    PDF_TEMPLATES,
    getPdfDimensions,
    getHeaderFooterDimensions,
    buildPdfTemplate,
    generatePdfTemplateCSS,
    getHeaderTemplate,
    getFooterTemplate,
    getStandardMargins,

    // Medical/PDF utilities
    isAbnormal,
    savePdfToFile,
    generateFilename,
    collectImagePaths
};
