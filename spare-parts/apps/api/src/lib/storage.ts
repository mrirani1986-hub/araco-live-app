import fs from 'node:fs/promises';
import { createReadStream, existsSync } from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import sharp from 'sharp';
import { env } from '../env.js';
import { badRequest } from './errors.js';

/**
 * Storage abstraction. Only the local driver is implemented; an S3-compatible
 * driver can implement the same interface (keys are already relative paths).
 */
export interface StorageDriver {
  put(key: string, data: Buffer): Promise<void>;
  get(key: string): Promise<Buffer>;
  exists(key: string): Promise<boolean>;
  remove(key: string): Promise<void>;
  stream(key: string): NodeJS.ReadableStream;
  absolute(key: string): string;
}

class LocalDriver implements StorageDriver {
  constructor(private root: string) {}
  private resolve(key: string) {
    const p = path.resolve(this.root, key);
    if (!p.startsWith(this.root + path.sep)) throw badRequest('Invalid storage key');
    return p;
  }
  absolute(key: string) { return this.resolve(key); }
  async put(key: string, data: Buffer) {
    const p = this.resolve(key);
    await fs.mkdir(path.dirname(p), { recursive: true });
    await fs.writeFile(p, data);
  }
  get(key: string) { return fs.readFile(this.resolve(key)); }
  async exists(key: string) { return existsSync(this.resolve(key)); }
  async remove(key: string) { await fs.rm(this.resolve(key), { force: true }); }
  stream(key: string) { return createReadStream(this.resolve(key)); }
}

export const storage: StorageDriver = new LocalDriver(env.storageDir);

export const STORAGE_DIRS = ['images', 'imports', 'exports', 'backup'] as const;
export async function ensureStorageDirs() {
  for (const d of STORAGE_DIRS) await fs.mkdir(path.join(env.storageDir, d), { recursive: true });
}

const ALLOWED = new Map([['jpeg', 'image/jpeg'], ['png', 'image/png'], ['webp', 'image/webp']]);
export const sha256 = (b: Buffer) => crypto.createHash('sha256').update(b).digest('hex');

/** Validates an image by content (not by extension), stores original + a webp thumbnail. */
export interface StoredImage { key: string; thumbKey: string; mime: string; width: number | null; height: number | null; bytes: number; sha256: string; originalKey: string | null }

export async function storeImage(data: Buffer, folder: 'parts' | 'drawings' | 'company', transform?: { rotate?: number; flipH?: boolean; flipV?: boolean }): Promise<StoredImage> {
  if (transform && (transform.rotate || transform.flipH || transform.flipV)) {
    // Keep the original bytes untouched and store an oriented copy for display.
    const original = await storeImage(data, folder);
    let img = sharp(data);
    if (transform.flipH) img = img.flop();
    if (transform.flipV) img = img.flip();
    if (transform.rotate) img = img.rotate(transform.rotate);
    const oriented = await storeImage(await img.png().toBuffer(), folder);
    return { ...oriented, originalKey: original.key, sha256: original.sha256, bytes: original.bytes };
  }
  let meta: Awaited<ReturnType<ReturnType<typeof sharp>['metadata']>>;
  try {
    meta = await sharp(data).metadata();
  } catch {
    throw badRequest('File is not a valid image');
  }
  const mime = ALLOWED.get(meta.format ?? '');
  if (!mime) throw badRequest('Only JPG, JPEG, PNG and WEBP images are allowed');
  const hash = sha256(data);
  const ext = meta.format === 'jpeg' ? 'jpg' : meta.format!;
  const key = `images/${folder}/${hash}.${ext}`;
  const thumbKey = `images/thumbs/${hash}.webp`;
  if (!(await storage.exists(key))) await storage.put(key, data);
  if (!(await storage.exists(thumbKey))) {
    const thumb = await sharp(data).rotate().resize(480, 480, { fit: 'inside', withoutEnlargement: true }).webp({ quality: 82 }).toBuffer();
    await storage.put(thumbKey, thumb);
  }
  return { key, thumbKey, mime, width: meta.width ?? null, height: meta.height ?? null, bytes: data.length, sha256: hash, originalKey: null };
}
