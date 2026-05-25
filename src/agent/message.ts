import type { A2aMessage, A2aMessagePart } from './types.js';

const MAX_INLINE_DECODED_BYTES = 64 * 1024;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function safeJson(value: unknown) {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function decodeTextBytes(bytes: string, mimeType?: string) {
  const normalizedMime = String(mimeType || '').toLowerCase();
  const canDecode =
    normalizedMime.startsWith('text/') ||
    normalizedMime.includes('json') ||
    normalizedMime.includes('xml') ||
    normalizedMime.includes('yaml');
  if (!canDecode) return undefined;

  try {
    const buffer = Buffer.from(bytes, 'base64');
    if (buffer.byteLength > MAX_INLINE_DECODED_BYTES) {
      return `[decoded text omitted: ${buffer.byteLength} bytes exceeds ${MAX_INLINE_DECODED_BYTES}]`;
    }
    return buffer.toString('utf8');
  } catch {
    return undefined;
  }
}

function labeledBlock(label: string, value: unknown) {
  return `${label}:\n${typeof value === 'string' ? value : safeJson(value)}`;
}

function filePartToText(part: A2aMessagePart) {
  const file = isRecord(part.file) ? part.file : part;
  const name = typeof file.name === 'string' && file.name ? file.name : 'unnamed';
  const mimeType = typeof file.mimeType === 'string' && file.mimeType ? file.mimeType : 'application/octet-stream';
  const uri = typeof file.uri === 'string' && file.uri ? file.uri : typeof file.url === 'string' && file.url ? file.url : undefined;
  if (uri) {
    return `[file: ${name}; mimeType=${mimeType}; uri=${uri}]`;
  }

  const bytes = typeof file.bytes === 'string' ? file.bytes : undefined;
  if (!bytes) return `[file: ${name}; mimeType=${mimeType}]`;
  const decoded = decodeTextBytes(bytes, mimeType);
  if (decoded !== undefined) return `[file: ${name}; mimeType=${mimeType}]\n${decoded}`;
  return `[file: ${name}; mimeType=${mimeType}; base64Bytes=${bytes.length}]`;
}

function partToText(part: A2aMessagePart) {
  const kind = String(part.kind || part.type || '').toLowerCase();
  if (typeof part.text === 'string') return part.text.trim();
  if (kind === 'file' || part.file || part.bytes || part.uri || part.url) return filePartToText(part);
  if (kind === 'data' || part.data !== undefined) return labeledBlock('data', part.data);
  if (part.raw !== undefined) return labeledBlock('raw', part.raw);
  return '';
}

export function contentFromA2aMessage(message: A2aMessage | undefined) {
  if (typeof message?.content === 'string') return message.content.trim();
  const parts = Array.isArray(message?.parts) ? message.parts : [];
  return parts
    .map(partToText)
    .filter(Boolean)
    .join('\n\n')
    .trim();
}
