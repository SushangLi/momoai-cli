import { loadConfig } from './config.js';

export class CliError extends Error {
  constructor(message: string, public status?: number) {
    super(message);
  }
}

export interface RequestOptions {
  auth?: boolean;
  authToken?: string;
  query?: Record<string, string | number | boolean | undefined>;
  body?: unknown;
  method?: string;
}

export class MomoClient {
  async request<T>(path: string, options: RequestOptions = {}): Promise<T> {
    const config = loadConfig();
    const url = new URL(path, `${config.apiUrl}/`);

    for (const [key, value] of Object.entries(options.query || {})) {
      if (value !== undefined) url.searchParams.set(key, String(value));
    }

    const headers: Record<string, string> = {
      Accept: 'application/json'
    };

    if (options.authToken) {
      headers.Authorization = `Bearer ${options.authToken}`;
    } else if (options.auth !== false) {
      const momoKey = config.account?.momoKey;
      if (!momoKey) {
        throw new CliError('Missing MOMO key. Run $register or set MOMOAI_KEY.');
      }
      headers.Authorization = `Bearer ${momoKey}`;
    }

    let body: BodyInit | undefined;
    if (options.body !== undefined) {
      headers['Content-Type'] = 'application/json';
      body = JSON.stringify(options.body);
    }

    const response = await fetch(url, {
      method: options.method || (body ? 'POST' : 'GET'),
      headers,
      body
    });

    const text = await response.text();
    let payload: any = {};
    if (text) {
      try {
        payload = JSON.parse(text);
      } catch {
        payload = { error: text };
      }
    }

    if (!response.ok || payload.success === false) {
      throw new CliError(payload.error || payload.message || `HTTP ${response.status}`, response.status);
    }

    return payload as T;
  }
}
