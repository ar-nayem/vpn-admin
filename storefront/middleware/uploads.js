const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const multer = require('multer');

const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

function detectImage(buffer, mimeType) {
  if (!Buffer.isBuffer(buffer) || buffer.length > MAX_IMAGE_BYTES) throw new TypeError('image is too large');
  let detected = null;
  if (buffer.length >= 16
    && buffer.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex'))
    && buffer.subarray(-8).equals(Buffer.from('49454e44ae426082', 'hex'))) {
    detected = { mimeType: 'image/png', extension: '.png' };
  } else if (buffer.length >= 4 && buffer[0] === 0xff && buffer[1] === 0xd8
    && buffer[buffer.length - 2] === 0xff && buffer[buffer.length - 1] === 0xd9) {
    detected = { mimeType: 'image/jpeg', extension: '.jpg' };
  } else if (buffer.length >= 12 && buffer.subarray(0, 4).toString('ascii') === 'RIFF'
    && buffer.subarray(8, 12).toString('ascii') === 'WEBP'
    && buffer.readUInt32LE(4) === buffer.length - 8) {
    detected = { mimeType: 'image/webp', extension: '.webp' };
  }
  if (!detected) throw new TypeError('file is not a supported image');
  if (detected.mimeType !== String(mimeType || '').toLowerCase()) throw new TypeError('image type does not match its content');
  return detected;
}

async function storePrivateImage(file, { storageDir, randomUUID = crypto.randomUUID } = {}) {
  if (!storageDir) throw new TypeError('private image storage directory is required');
  const type = detectImage(file && file.buffer, file && file.mimetype);
  await fs.promises.mkdir(storageDir, { recursive: true, mode: 0o700 });
  const filename = `${randomUUID()}${type.extension}`;
  const finalPath = path.join(storageDir, filename);
  const temporaryPath = path.join(storageDir, `.${filename}.tmp`);
  try {
    const handle = await fs.promises.open(temporaryPath, 'wx', 0o600);
    try {
      await handle.writeFile(file.buffer);
      await handle.sync();
    } finally { await handle.close(); }
    await fs.promises.rename(temporaryPath, finalPath);
  } catch (error) {
    await fs.promises.rm(temporaryPath, { force: true });
    throw error;
  }
  return { filename, path: finalPath, mimeType: type.mimeType, size: file.buffer.length };
}

function createPrivateImageStore(options) {
  return {
    store(file) { return storePrivateImage(file, options); },
    remove(filename) {
      if (path.basename(filename) !== filename) throw new TypeError('invalid stored filename');
      return fs.promises.rm(path.join(options.storageDir, filename), { force: true });
    },
  };
}

function createImageUpload(fieldName = 'proof') {
  return multer({ storage: multer.memoryStorage(), limits: { fileSize: MAX_IMAGE_BYTES, files: 1 } }).single(fieldName);
}

module.exports = { MAX_IMAGE_BYTES, detectImage, storePrivateImage, createPrivateImageStore, createImageUpload };
