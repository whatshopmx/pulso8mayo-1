/**
 * Cloudflare R2 Storage Client
 * 
 * Provides S3-compatible interface for Cloudflare R2 storage
 * Used for document and media storage in Pulso platform
 */

import { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand, HeadObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl as getS3SignedUrl } from '@aws-sdk/s3-request-presigner';

const R2_ACCESS_KEY_ID = process.env.R2_ACCESS_KEY_ID || '';
const R2_SECRET_ACCESS_KEY = process.env.R2_SECRET_ACCESS_KEY || '';
const R2_ACCOUNT_ID = process.env.R2_ACCOUNT_ID || '';

const R2_CONFIGURED = !!(R2_ACCESS_KEY_ID && R2_SECRET_ACCESS_KEY && R2_ACCOUNT_ID);

if (process.env.NODE_ENV === 'production' && !R2_CONFIGURED) {
  console.warn('[R2] WARNING: Missing required R2 credentials in production. Set R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, and R2_ACCOUNT_ID. R2 storage will be disabled.');
}

if (!R2_ACCESS_KEY_ID || !R2_SECRET_ACCESS_KEY) {
  console.warn('[R2] Credentials not configured - R2 storage will be disabled');
}

const BUCKET_NAME = process.env.R2_BUCKET_NAME || 'pulso-documents';

function getR2Client(): S3Client | null {
  if (!R2_CONFIGURED) {
    return null;
  }
  return new S3Client({
    region: 'auto',
    endpoint: `https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    credentials: {
        accessKeyId: R2_ACCESS_KEY_ID,
        secretAccessKey: R2_SECRET_ACCESS_KEY,
    },
  });
}

/**
 * Check if R2 is available
 */
export function isR2Configured(): boolean {
  return R2_CONFIGURED;
}

/**
 * Upload file to R2 storage
 *
 * Devuelve la KEY del objeto (identificador durable), NO una URL pública.
 * La exposición al usuario se hace vía `generatePresignedUrl` en los endpoints
 * de lectura con guardia de sesión/tenancy — ver lib/storage/scoped-evidence.ts.
 */
export async function uploadToR2(
    file: Buffer,
    key: string,
    contentType: string,
    metadata?: Record<string, string>
): Promise<string> {
    const client = getR2Client();
    if (!client) {
        throw new Error('R2 storage not configured');
    }

    try {
        const command = new PutObjectCommand({
            Bucket: BUCKET_NAME,
            Key: key,
            Body: file,
            ContentType: contentType,
            Metadata: metadata,
        });

        await client.send(command);

        return key;
    } catch (error) {
        console.error('[R2] Upload error:', error);
        throw new Error('Failed to upload file to storage');
    }
}

/**
 * Generate presigned URL for private documents
 */
export async function generatePresignedUrl(
    key: string,
    expiresIn: number = 3600
): Promise<string> {
    const client = getR2Client();
    if (!client) {
        throw new Error('R2 storage not configured');
    }

    try {
        const command = new GetObjectCommand({
            Bucket: BUCKET_NAME,
            Key: key,
        });

        const signedUrl = await getS3SignedUrl(client, command, { expiresIn });
        return signedUrl;
    } catch (error) {
        console.error('[R2] Signed URL error:', error);
        throw new Error('Failed to generate signed URL');
    }
}

/**
 * Get file from R2
 */
export async function getFromR2(key: string): Promise<Buffer | null> {
    const client = getR2Client();
    if (!client) {
        throw new Error('R2 storage not configured');
    }

    try {
        const command = new GetObjectCommand({
            Bucket: BUCKET_NAME,
            Key: key,
        });

        const response = await client.send(command);
        const body = response.Body;

        if (!body) {
            return null;
        }

        // Convert to buffer
        const chunks: Uint8Array[] = [];
        for await (const chunk of body as AsyncIterable<Uint8Array>) {
            chunks.push(chunk);
        }

        return Buffer.concat(chunks);
    } catch (error) {
        console.error('[R2] Get error:', error);
        return null;
    }
}

/**
 * Delete file from R2
 */
export async function deleteFromR2(key: string): Promise<void> {
    const client = getR2Client();
    if (!client) {
        throw new Error('R2 storage not configured');
    }

    try {
        const command = new DeleteObjectCommand({
            Bucket: BUCKET_NAME,
            Key: key,
        });

        await client.send(command);
    } catch (error) {
        console.error('[R2] Delete error:', error);
        throw new Error('Failed to delete file from storage');
    }
}

/**
 * Check if file exists in R2
 */
export async function fileExistsInR2(key: string): Promise<boolean> {
    const client = getR2Client();
    if (!client) {
        return false;
    }

    try {
        const command = new HeadObjectCommand({
            Bucket: BUCKET_NAME,
            Key: key,
        });

        await client.send(command);
        return true;
    } catch (error) {
        return false;
    }
}

/**
 * Generate unique file key
 */
export function generateFileKey(
    companyId: string,
    userId: string,
    documentType: string,
    fileName: string
): string {
    const timestamp = Date.now();
    const sanitizedFileName = fileName.replace(/[^a-zA-Z0-9.-]/g, '_');
    return `companies/${companyId}/users/${userId}/${documentType}/${timestamp}_${sanitizedFileName}`;
}