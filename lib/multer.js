// lib/multer.js  → FINAL BULLETPROOF VERSION

const multer = require('multer');
const path = require('path');

const memoryStorage = multer.memoryStorage();

/**
 * Universal uploader – handles EVERYTHING in memory
 * Works with .single(), .array(), .fields(), .any()
 */
const upload = multer({
    storage: memoryStorage,
    limits: { fileSize: 15 * 1024 * 1024 }, // 15MB – covers Excel + images + PDFs
    fileFilter: (req, file, cb) => {
        const allowedTypes = [
            // Images (include older pjpeg / jpe variants)
            'image/jpeg', 'image/jpg', 'image/pjpeg', 'image/jpe', 'image/png', 'image/gif', 'image/webp',
            // PDF
            'application/pdf',
            // Excel & CSV
            'application/vnd.ms-excel',
            'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
            'text/csv'
        ];

        // Some mobile clients send application/octet-stream; fallback to extension check
        const allowedExtensions = ['.jpg', '.jpeg', '.jpe', '.png', '.gif', '.webp', '.pdf', '.xls', '.xlsx', '.csv'];
        const ext = (path.extname(file.originalname) || '').toLowerCase();

        if (allowedTypes.includes(file.mimetype)) {
            cb(null, true);
        } else if (file.mimetype === 'application/octet-stream' && allowedExtensions.includes(ext)) {
            cb(null, true);
        } else {
            cb(new Error(`Invalid file type: ${file.mimetype}. Allowed: images, PDF, Excel, CSV`));
        }
    }
});

// ──────────────────────────────────────────────────
// EXPORT THE RAW INSTANCE + CONVENIENT SHORTCUTS
// ──────────────────────────────────────────────────
module.exports = {
    upload,                    // ← raw instance (can call .single(), .any(), etc.)
    
    // Direct shortcuts – use these in routes
    any: upload.any(),
    single: (fieldName) => upload.single(fieldName),
    array: (fieldName, maxCount) => upload.array(fieldName, maxCount),
    fields: (fieldConfig) => upload.fields(fieldConfig),

    // Legacy names (for zero code changes in some places)
    mixedUpload: upload,
    imageUpload: upload,
    pdfUpload: upload,
    excelUpload: upload
};