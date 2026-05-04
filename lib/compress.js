/**
 * Image compression utilities using Sharp
 */
const sharp = require('sharp');
const fs = require('fs');
const path = require('path');
const logger = require('./logger');

/**
 * Compress multiple image files with aggressive compression settings
 * @param {Array} files - Array of file objects with buffer property
 * @returns {Promise<Array>} Array of compressed file objects
 */
const compressImages = async (files) => {
  const compressedFiles = [];
  
  for (const file of files) {
    try {
      const originalSize = file.size;
      let sharpInstance = sharp(file.buffer);

      // Get image metadata
      const metadata = await sharpInstance.metadata();
      
      logger.debug(`Processing image: ${file.originalname}`, {
        size: `${(originalSize/1024/1024).toFixed(2)}MB`,
        dimensions: `${metadata.width}x${metadata.height}`
      });

      // Aggressive resizing - Max width 800px for most images
      const targetWidth = 800;
      if (metadata.width > targetWidth) {
        sharpInstance = sharpInstance.resize(targetWidth, null, {
          fit: 'inside',
          withoutEnlargement: true
        });
      }

      let compressedBuffer;
      let newExtension = '.jpg';
      
      // Apply compression based on file type
      if (file.mimetype === 'image/jpeg' || file.mimetype === 'image/jpg') {
        compressedBuffer = await sharpInstance
          .jpeg({ 
            quality: 40,
            mozjpeg: true,
            chromaSubsampling: '4:2:0',
            optimiseScans: true,
            trellisQuantisation: true,
            overshootDeringing: true,
            optimiseCoding: true
          })
          .toBuffer();
      }
      else if (file.mimetype === 'image/png') {
        // Convert PNG to JPEG for better compression
        compressedBuffer = await sharpInstance
          .jpeg({ 
            quality: 50,
            mozjpeg: true 
          })
          .toBuffer();
      }
      else if (file.mimetype === 'image/gif') {
        // Convert GIF to WebP
        compressedBuffer = await sharpInstance
          .webp({ 
            quality: 45,
            effort: 6
          })
          .toBuffer();
        newExtension = '.webp';
      }
      else {
        // Convert everything else to WebP
        compressedBuffer = await sharpInstance
          .webp({ 
            quality: 45,
            effort: 6,
            smartSubsample: true
          })
          .toBuffer();
        newExtension = '.webp';
      }

      const compressedSize = compressedBuffer.length;
      const reduction = ((originalSize - compressedSize) / originalSize * 100);
    
      logger.info(`Image compressed: ${file.originalname}`, {
        originalSize: `${(originalSize/1024).toFixed(2)}KB`,
        compressedSize: `${(compressedSize/1024).toFixed(2)}KB`,
        reduction: `${reduction.toFixed(1)}%`
      });

      // Save compressed file
      const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
      const filename = `${uniqueSuffix}${newExtension}`;
      const filePath = path.join('uploads/', filename);
      
      fs.writeFileSync(filePath, compressedBuffer);
      
      // Update file object
      file.path = filePath;
      file.size = compressedSize;
      compressedFiles.push(file);
      
    } catch (error) {
      logger.warn(`Compression failed for ${file.originalname}:`, error.message);
      compressedFiles.push(file);
    }
  }
  
  return compressedFiles;
};

module.exports = { compressImages };