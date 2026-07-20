const crypto = require('crypto');
const fs = require('fs');
const fsp = fs.promises;
const os = require('os');
const path = require('path');
const { pipeline } = require('stream/promises');
const {
    S3Client,
    PutObjectCommand,
    GetObjectCommand,
} = require('@aws-sdk/client-s3');

const LOCAL_ROOT = path.resolve(
    process.env.OBJECT_STORAGE_LOCAL_ROOT || path.join(__dirname, '../../../../uploads/objects'),
);

function safeFileName(value) {
    return String(value || 'source.ili')
        .replace(/[^a-zA-Z0-9._-]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 120) || 'source.ili';
}

function createS3Client() {
    const endpoint = process.env.S3_ENDPOINT || process.env.MINIO_ENDPOINT;
    const config = {
        region: process.env.S3_REGION || 'us-east-1',
        endpoint,
        forcePathStyle: String(process.env.S3_FORCE_PATH_STYLE || 'true') === 'true',
    };
    const accessKeyId = process.env.S3_ACCESS_KEY || process.env.MINIO_ACCESS_KEY;
    const secretAccessKey = process.env.S3_SECRET_KEY || process.env.MINIO_SECRET_KEY;
    if (accessKeyId && secretAccessKey) config.credentials = { accessKeyId, secretAccessKey };
    return new S3Client(config);
}

function storageDriver() {
    return String(process.env.OBJECT_STORAGE_DRIVER || (process.env.S3_BUCKET ? 's3' : 'local')).toLowerCase();
}

async function sha256File(filePath) {
    const digest = crypto.createHash('sha256');
    const source = fs.createReadStream(filePath);
    for await (const chunk of source) digest.update(chunk);
    return digest.digest('hex');
}

async function putFile(filePath, { organizationId, sourceName, contentType }) {
    const sourceSha256 = await sha256File(filePath);
    const key = `ili/${Number(organizationId)}/${sourceSha256}-${safeFileName(sourceName)}`;
    const size = (await fsp.stat(filePath)).size;

    if (storageDriver() === 's3') {
        if (!process.env.S3_BUCKET) throw new Error('S3_BUCKET is required when OBJECT_STORAGE_DRIVER=s3');
        await createS3Client().send(new PutObjectCommand({
            Bucket: process.env.S3_BUCKET,
            Key: key,
            Body: fs.createReadStream(filePath),
            ContentLength: size,
            ContentType: contentType || 'application/octet-stream',
            Metadata: { sourceSha256, immutable: 'true' },
        }));
        return { key, sourceSha256, size, driver: 's3' };
    }

    const destination = path.join(LOCAL_ROOT, key);
    await fsp.mkdir(path.dirname(destination), { recursive: true });
    try {
        await fsp.access(destination, fs.constants.F_OK);
    } catch {
        await fsp.copyFile(filePath, destination);
    }
    return { key, sourceSha256, size, driver: 'local', path: destination };
}

async function materializeFile(objectKey, destinationPath) {
    if (storageDriver() !== 's3') {
        const sourcePath = path.join(LOCAL_ROOT, objectKey);
        await fsp.access(sourcePath, fs.constants.R_OK);
        return sourcePath;
    }

    if (!process.env.S3_BUCKET) throw new Error('S3_BUCKET is required when OBJECT_STORAGE_DRIVER=s3');
    const response = await createS3Client().send(new GetObjectCommand({
        Bucket: process.env.S3_BUCKET,
        Key: objectKey,
    }));
    await fsp.mkdir(path.dirname(destinationPath), { recursive: true });
    await pipeline(response.Body, fs.createWriteStream(destinationPath));
    return destinationPath;
}

async function createWorkerTempPath(jobId, sourceName) {
    const directory = await fsp.mkdtemp(path.join(os.tmpdir(), 'synapse-ingest-'));
    return path.join(directory, `${String(jobId)}-${safeFileName(sourceName)}`);
}

module.exports = {
    createWorkerTempPath,
    materializeFile,
    putFile,
    safeFileName,
    sha256File,
    storageDriver,
};
