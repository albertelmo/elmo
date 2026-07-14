const fs = require('fs');
const path = require('path');
const multer = require('multer');
const { v4: uuidv4 } = require('uuid');

const UPLOADS_DIR = process.env.UPLOADS_DIR || path.join(__dirname, 'uploads');
const MAX_IMAGES = 20;
const MAX_FILE_SIZE = 10 * 1024 * 1024;
const ALLOWED_MIME_TYPES = new Set([
    'image/jpeg',
    'image/png',
    'image/webp',
    'image/gif'
]);

function ensureUploadsDir() {
    if (!fs.existsSync(UPLOADS_DIR)) {
        fs.mkdirSync(UPLOADS_DIR, { recursive: true });
    }
}

function getPostUploadDir(postId) {
    return path.join(UPLOADS_DIR, postId);
}

function toPublicUrl(postId, filename) {
    return `/uploads/${postId}/${filename}`;
}

function urlToFilePath(imageUrl) {
    if (!imageUrl || !imageUrl.startsWith('/uploads/')) {
        return null;
    }
    const relativePath = imageUrl.replace('/uploads/', '').split('/').join(path.sep);
    return path.join(UPLOADS_DIR, relativePath);
}

const upload = multer({
    storage: multer.memoryStorage(),
    limits: {
        fileSize: MAX_FILE_SIZE,
        files: MAX_IMAGES
    },
    fileFilter(req, file, cb) {
        if (ALLOWED_MIME_TYPES.has(file.mimetype)) {
            cb(null, true);
        } else {
            cb(new Error('JPG, PNG, WEBP, GIF 이미지만 업로드할 수 있습니다.'));
        }
    }
});

const postImagesUpload = upload.array('images', MAX_IMAGES);

function savePostImages(postId, files) {
    ensureUploadsDir();
    const postDir = getPostUploadDir(postId);
    if (!fs.existsSync(postDir)) {
        fs.mkdirSync(postDir, { recursive: true });
    }

    const urls = [];
    for (const file of files) {
        const ext = path.extname(file.originalname).toLowerCase() || '.jpg';
        const filename = `${uuidv4()}${ext}`;
        const filePath = path.join(postDir, filename);
        fs.writeFileSync(filePath, file.buffer);
        urls.push(toPublicUrl(postId, filename));
    }
    return urls;
}

function deleteImageFiles(imageUrls) {
    for (const imageUrl of imageUrls) {
        const filePath = urlToFilePath(imageUrl);
        if (filePath && fs.existsSync(filePath)) {
            fs.unlinkSync(filePath);
        }
    }
}

function deletePostImageDir(postId) {
    const postDir = getPostUploadDir(postId);
    if (fs.existsSync(postDir)) {
        fs.rmSync(postDir, { recursive: true, force: true });
    }
}

function cleanupRemovedImages(previousUrls, nextUrls) {
    const nextSet = new Set(nextUrls);
    const removed = previousUrls.filter(url => !nextSet.has(url));
    deleteImageFiles(removed);
}

module.exports = {
    UPLOADS_DIR,
    MAX_IMAGES,
    postImagesUpload,
    savePostImages,
    deleteImageFiles,
    deletePostImageDir,
    cleanupRemovedImages,
    ensureUploadsDir
};
