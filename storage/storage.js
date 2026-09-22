const fs = require("fs");
const path = require("path");
const { createReadStream } = require("fs");
const { DeleteObjectCommand, GetObjectCommand, HeadObjectCommand, PutObjectCommand, S3Client } = require("@aws-sdk/client-s3");

const DEFAULT_STORAGE_PROVIDER = String(
    process.env.STORAGE_PROVIDER || process.env.UPLOAD_STORAGE || "local"
).toLowerCase();

class LocalStorageAdapter {
    constructor({ rootDir, baseUrl = "/uploads", provider = DEFAULT_STORAGE_PROVIDER } = {}) {
        this.rootDir = path.resolve(rootDir || path.join(__dirname, "..", "uploads"));
        this.baseUrl = baseUrl;
        this.provider = String(provider || DEFAULT_STORAGE_PROVIDER).toLowerCase();

        fs.mkdirSync(this.rootDir, { recursive: true });
    }

    sanitizeFileName(originalName) {
        const ext = path.extname(String(originalName || "").trim()).toLowerCase();
        const safeBaseName = path
            .basename(String(originalName || "").trim() || "upload", ext)
            .replace(/[^a-zA-Z0-9_-]/g, "-")
            .replace(/-+/g, "-")
            .slice(0, 80) || "upload";

        return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}-${safeBaseName}${ext}`;
    }

    getUrl(fileName) {
        const safeName = String(fileName || "").trim();
        if (!safeName || safeName.includes("..") || safeName.includes("/")) {
            return null;
        }
        return `${this.baseUrl}/${encodeURIComponent(safeName)}`;
    }

    normalizeRelativePath(filePath) {
        if (!filePath) return null;

        const trimmed = String(filePath).replace(/\\/g, "/").trim();
        if (!trimmed || trimmed.includes("..")) return null;

        const cleanPath = trimmed.replace(/^\/+/, "");
        const resolved = path.resolve(this.rootDir, cleanPath.replace(/^uploads\//i, ""));
        if (!resolved.startsWith(this.rootDir)) return null;

        return resolved;
    }

    deleteFile(filePath) {
        const resolvedPath = this.normalizeRelativePath(filePath);
        if (!resolvedPath || !fs.existsSync(resolvedPath)) return false;
        fs.unlinkSync(resolvedPath);
        return true;
    }

    getDownloadResponse(filePath, res) {
        const resolvedPath = this.normalizeRelativePath(filePath);
        if (!resolvedPath || !fs.existsSync(resolvedPath)) {
            return false;
        }
        res.download(resolvedPath);
        return true;
    }

    async uploadFile(filePath, objectKey, contentType) {
        if (!fs.existsSync(filePath)) throw new Error("Upload source file does not exist");
        return { key: objectKey || path.basename(filePath), url: this.getUrl(objectKey || path.basename(filePath)) };
    }

    async deleteObject(objectKey) {
        return this.deleteFile(objectKey);
    }

    async exists(objectKey) {
        return Boolean(this.normalizeRelativePath(objectKey) && fs.existsSync(this.normalizeRelativePath(objectKey)));
    }
}

class S3StorageAdapter {
    constructor({ provider = "s3" } = {}) {
        this.provider = provider;
        this.bucket = String(process.env.S3_BUCKET || "").trim();
        this.region = String(process.env.S3_REGION || "").trim();
        this.endpoint = String(process.env.S3_ENDPOINT || "").trim() || undefined;
        this.client = new S3Client({
            region: this.region,
            endpoint: this.endpoint,
            forcePathStyle: process.env.S3_FORCE_PATH_STYLE === "true",
            credentials: process.env.S3_ACCESS_KEY_ID && process.env.S3_SECRET_ACCESS_KEY
                ? { accessKeyId: process.env.S3_ACCESS_KEY_ID, secretAccessKey: process.env.S3_SECRET_ACCESS_KEY }
                : undefined
        });
        if (!this.bucket || !this.region) {
            throw new Error("S3_BUCKET and S3_REGION are required for object storage");
        }
    }

    sanitizeFileName(originalName) {
        const ext = path.extname(String(originalName || "").trim()).toLowerCase();
        const safeBaseName = path.basename(String(originalName || "").trim() || "upload", ext)
            .replace(/[^a-zA-Z0-9_-]/g, "-").replace(/-+/g, "-").slice(0, 80) || "upload";
        return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}-${safeBaseName}${ext}`;
    }

    getUrl(objectKey) {
        const safeKey = String(objectKey || "").replace(/^\/+/, "");
        if (!safeKey || safeKey.includes("..")) return null;
        return `/api/files/${safeKey.split("/").map(encodeURIComponent).join("/")}`;
    }

    async uploadFile(filePath, objectKey, contentType) {
        const key = String(objectKey || path.basename(filePath)).replace(/^\/+/, "");
        await this.client.send(new PutObjectCommand({
            Bucket: this.bucket,
            Key: key,
            Body: createReadStream(filePath),
            ContentType: contentType || "application/octet-stream"
        }));
        return { key, url: this.getUrl(key) };
    }

    async deleteObject(objectKey) {
        const key = String(objectKey || "").replace(/^\/+/, "");
        if (!key || key.includes("..")) return false;
        await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }));
        return true;
    }

    async exists(objectKey) {
        const key = String(objectKey || "").replace(/^\/+/, "");
        if (!key || key.includes("..")) return false;
        try {
            await this.client.send(new HeadObjectCommand({ Bucket: this.bucket, Key: key }));
            return true;
        } catch (_error) {
            return false;
        }
    }

    async getDownloadResponse(objectKey, res) {
        const key = String(objectKey || "").replace(/^\/+/, "");
        if (!key || key.includes("..")) return false;
        const result = await this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: key }));
        if (result.ContentType) res.type(result.ContentType);
        if (result.ContentLength !== undefined) res.setHeader("Content-Length", String(result.ContentLength));
        result.Body.pipe(res);
        return true;
    }
}

function createStorageAdapter(options = {}) {
    const provider = String(
        options.provider || process.env.STORAGE_PROVIDER || process.env.UPLOAD_STORAGE || "local"
    ).toLowerCase();

    if (provider === "s3" || provider === "object-storage" || provider === "cloud") {
        return new S3StorageAdapter({ ...options, provider });
    }

    return new LocalStorageAdapter({ ...options, provider });
}

module.exports = {
    createStorageAdapter,
    LocalStorageAdapter,
    S3StorageAdapter
};
