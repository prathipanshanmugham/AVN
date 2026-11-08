const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFile, execFileSync } = require('child_process');
const multer = require('multer');
const sharp = require('sharp');
const config = require('./config');
const { bad } = require('./util');

const MEDIA_DIR = path.join(config.uploadDir, 'media');
const DOCS_DIR = path.join(config.uploadDir, 'docs');
const TMP_DIR = path.join(config.uploadDir, 'tmp');
fs.mkdirSync(TMP_DIR, { recursive: true });

const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
const VIDEO_TYPES = ['video/mp4', 'video/quicktime', 'video/webm'];
const DOC_TYPES = ['application/pdf', 'image/jpeg', 'image/png', 'image/webp',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'];

const randomName = (ext) => crypto.randomBytes(12).toString('hex') + ext;

const tmpStorage = multer.diskStorage({
  destination: TMP_DIR,
  filename: (req, file, cb) => cb(null, randomName('.upload')),
});

const mediaUpload = multer({
  storage: tmpStorage,
  limits: { fileSize: 250 * 1024 * 1024, files: 1 },
  fileFilter: (req, file, cb) => {
    if (IMAGE_TYPES.includes(file.mimetype) || VIDEO_TYPES.includes(file.mimetype)) return cb(null, true);
    cb(bad('Upload a JPG, PNG, WebP image or an MP4 / MOV / WebM video'));
  },
});

const docUpload = multer({
  storage: multer.diskStorage({
    destination: DOCS_DIR,
    filename: (req, file, cb) => cb(null, randomName(path.extname(file.originalname).toLowerCase().replace(/[^.a-z0-9]/g, '').slice(0, 6))),
  }),
  limits: { fileSize: 25 * 1024 * 1024, files: 1 },
  fileFilter: (req, file, cb) => {
    if (DOC_TYPES.includes(file.mimetype)) return cb(null, true);
    cb(bad('Upload a PDF, image, Word or Excel file'));
  },
});

const LOGO_TYPES = IMAGE_TYPES.concat(['image/svg+xml']);
const logoUpload = multer({
  storage: tmpStorage,
  limits: { fileSize: 5 * 1024 * 1024, files: 1 },
  fileFilter: (req, file, cb) => {
    if (LOGO_TYPES.includes(file.mimetype)) return cb(null, true);
    cb(bad('Upload the logo as PNG, SVG, JPG or WebP'));
  },
});

/**
 * Brand logos: SVGs are rasterised (never served as SVG), empty borders trimmed,
 * scaled to fit 640×160 and saved as WebP with transparency.
 */
async function processLogo(tmpPath, mimetype) {
  const storedName = randomName('.webp');
  const out = path.join(MEDIA_DIR, storedName);
  try {
    const input = mimetype === 'image/svg+xml' ? sharp(tmpPath, { density: 300 }) : sharp(tmpPath);
    let buf = await input.rotate().png().toBuffer();
    try { buf = await sharp(buf).trim({ threshold: 12 }).toBuffer(); } catch (e) { /* nothing to trim */ }
    await sharp(buf).resize({ width: 640, height: 160, fit: 'inside', withoutEnlargement: mimetype !== 'image/svg+xml' })
      .webp({ quality: 90, alphaQuality: 100 }).toFile(out);
  } catch (e) {
    throw bad('Could not read that image. Try a PNG or JPG.');
  } finally {
    fs.unlink(tmpPath, () => {});
  }
  return { storedName, size: fs.statSync(out).size };
}

let ffmpegAvailable = null;
function hasFfmpeg() {
  if (ffmpegAvailable === null) {
    try { execFileSync('ffmpeg', ['-version'], { stdio: 'ignore' }); ffmpegAvailable = true; } catch (e) { ffmpegAvailable = false; }
  }
  return ffmpegAvailable;
}

/** Resize to max 1920px and save as WebP. Returns { storedName, size }. */
async function processImage(tmpPath) {
  const storedName = randomName('.webp');
  const out = path.join(MEDIA_DIR, storedName);
  await sharp(tmpPath).rotate().resize({ width: 1920, height: 1920, fit: 'inside', withoutEnlargement: true }).webp({ quality: 78 }).toFile(out);
  fs.unlink(tmpPath, () => {});
  return { storedName, size: fs.statSync(out).size };
}

/**
 * Blog cover: a WebP for the page (max 1600px wide) and a 1200×630 JPG for WhatsApp / Facebook / Google previews.
 */
async function processCover(tmpPath) {
  const storedName = randomName('.webp');
  const ogName = randomName('.jpg');
  try {
    const src = sharp(tmpPath).rotate();
    await src.clone().resize({ width: 1600, height: 1600, fit: 'inside', withoutEnlargement: true }).webp({ quality: 80 }).toFile(path.join(MEDIA_DIR, storedName));
    await src.clone().resize(1200, 630, { fit: 'cover', position: sharp.strategy.attention }).jpeg({ quality: 82, mozjpeg: true }).toFile(path.join(MEDIA_DIR, ogName));
  } catch (e) {
    removeFile(MEDIA_DIR, storedName);
    removeFile(MEDIA_DIR, ogName);
    throw bad('Could not read that image. Try a JPG or PNG.');
  } finally {
    fs.unlink(tmpPath, () => {});
  }
  return { storedName, ogName };
}

/**
 * Videos: with ffmpeg, compress to a muted 720p H.264 MP4 plus a WebP poster (in the background).
 * Without ffmpeg the original file is kept as-is.
 */
function processVideo(tmpPath, originalName, onDone) {
  const ext = (path.extname(originalName).toLowerCase() || '.mp4').replace(/[^.a-z0-9]/g, '');
  if (!hasFfmpeg()) {
    const storedName = randomName(ext === '.mov' ? '.mov' : ext);
    fs.renameSync(tmpPath, path.join(MEDIA_DIR, storedName));
    onDone(null, { storedName, posterName: null, size: fs.statSync(path.join(MEDIA_DIR, storedName)).size });
    return { pending: false };
  }
  const storedName = randomName('.mp4');
  const posterName = storedName.replace('.mp4', '-poster.webp');
  const out = path.join(MEDIA_DIR, storedName);
  const posterTmp = path.join(TMP_DIR, randomName('.png'));
  execFile('ffmpeg', ['-y', '-loglevel', 'error', '-i', tmpPath, '-t', '60', '-an',
    '-vf', "scale='min(1280,iw)':-2", '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '28',
    '-pix_fmt', 'yuv420p', '-movflags', '+faststart', out], { timeout: 15 * 60 * 1000 }, (err) => {
    if (err) { fs.unlink(tmpPath, () => {}); return onDone(err); }
    execFile('ffmpeg', ['-y', '-loglevel', 'error', '-i', out, '-frames:v', '1', posterTmp], async (err2) => {
      fs.unlink(tmpPath, () => {});
      let poster = null;
      if (!err2) {
        try {
          await sharp(posterTmp).resize({ width: 1280, withoutEnlargement: true }).webp({ quality: 70 }).toFile(path.join(MEDIA_DIR, posterName));
          poster = posterName;
        } catch (e) { /* poster is optional */ }
        fs.unlink(posterTmp, () => {});
      }
      onDone(null, { storedName, posterName: poster, size: fs.statSync(out).size });
    });
  });
  return { pending: true, storedName };
}

function removeFile(dir, name) {
  if (!name || name.includes('/') || name.includes('..')) return;
  fs.unlink(path.join(dir, name), () => {});
}

const imageUpload = multer({
  storage: tmpStorage,
  limits: { fileSize: 20 * 1024 * 1024, files: 1 },
  fileFilter: (req, file, cb) => {
    if (IMAGE_TYPES.includes(file.mimetype)) return cb(null, true);
    cb(bad('Upload a JPG, PNG or WebP image'));
  },
});

module.exports = { MEDIA_DIR, DOCS_DIR, IMAGE_TYPES, VIDEO_TYPES, mediaUpload, docUpload, logoUpload, imageUpload, processImage, processLogo, processCover, processVideo, removeFile, hasFfmpeg };
