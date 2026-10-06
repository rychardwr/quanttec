import { createHmac, timingSafeEqual } from 'node:crypto';

const SIGNATURE_PREFIX = 'sha256=';

/**
 * Verifies Meta's X-Hub-Signature-256 header: HMAC-SHA256 of the raw request
 * body, keyed with the app secret. Must run on the exact bytes received.
 */
export function isValidMetaSignature(rawBody: Buffer, signatureHeader: string | null, appSecret: string): boolean {
  if (!signatureHeader?.startsWith(SIGNATURE_PREFIX)) {
    return false;
  }
  const received = Buffer.from(signatureHeader.slice(SIGNATURE_PREFIX.length), 'hex');
  const expected = createHmac('sha256', appSecret).update(rawBody).digest();
  return received.length === expected.length && timingSafeEqual(received, expected);
}
