export type BirdSmsConfig = {
  accessKey: string;
  workspaceId: string;
  channelId: string;
};

export type BirdSmsAccepted = {
  messageId: string | null;
  status: string | null;
};

export type BirdSmsFailureKind =
  | 'authentication'
  | 'recipient'
  | 'rate_limit'
  | 'server'
  | 'network'
  | 'configuration';

export class BirdSmsError extends Error {
  constructor(
    public readonly kind: BirdSmsFailureKind,
    public readonly statusCode: number | null,
    message: string,
    public readonly diagnostics: BirdSmsErrorDiagnostics | null = null,
  ) {
    super(message);
    this.name = 'BirdSmsError';
  }
}

export type BirdSmsErrorDiagnostics = {
  status: number | null;
  responseContentType: string | null;
  birdCode: string | null;
  birdMessage: string | null;
  birdDetails: unknown;
  birdReference: string | null;
  birdRequestId: string | null;
  rawBodySnippet: string | null;
  workspaceId: string;
  channelId: string;
  destination: string;
};

export type BirdSmsClient = {
  sendVerificationSms(input: {
    phone: string;
    code: string;
  }): Promise<BirdSmsAccepted>;
};

type Fetcher = typeof fetch;

const BAHRAIN_E164_RE = /^\+973\d{8}$/;

export function normalizeBahrainPhone(value: string): string {
  const digitsOrPlus = value.trim().replace(/[^\d+]/g, '');
  const canonical = digitsOrPlus.startsWith('+')
    ? digitsOrPlus
    : digitsOrPlus.startsWith('973')
      ? `+${digitsOrPlus}`
      : `+973${digitsOrPlus}`;

  if (!BAHRAIN_E164_RE.test(canonical)) {
    throw new BirdSmsError('recipient', 400, 'Invalid Bahrain phone number.');
  }

  return canonical;
}

export function createBirdSmsUrl(config: Pick<BirdSmsConfig, 'workspaceId' | 'channelId'>) {
  return `https://api.bird.com/workspaces/${encodeURIComponent(
    config.workspaceId,
  )}/channels/${encodeURIComponent(config.channelId)}/messages`;
}

export function createBirdSmsPayload(input: {
  canonicalPhone: string;
  messageText: string;
}) {
  return {
    receiver: {
      contacts: [
        {
          identifierValue: input.canonicalPhone,
        },
      ],
    },
    body: {
      type: 'text',
      text: {
        text: input.messageText,
      },
    },
  };
}

export function createBirdSmsClient({
  config,
  fetcher = fetch,
  timeoutMs = 4500,
}: {
  config: BirdSmsConfig;
  fetcher?: Fetcher;
  timeoutMs?: number;
}): BirdSmsClient {
  return {
    async sendVerificationSms({ phone, code }) {
      const canonicalPhone = normalizeBahrainPhone(phone);
      const url = createBirdSmsUrl(config);
      const messageText = `Your Jareb verification code is ${code}`;
      const body = createBirdSmsPayload({ canonicalPhone, messageText });
      const serializedBody = JSON.stringify(body);
      const headers = {
        Authorization: `AccessKey ${config.accessKey}`,
        'Content-Type': 'application/json',
      };

      let response: Response;
      try {
        console.info('Bird SMS request diagnostics', {
          bodyShape: {
            'body.text.text': body.body.text.text.trim() ? 'present' : 'missing',
            'body.type': body.body.type,
            'receiver.contacts[0].identifierValue': body.receiver.contacts[0]
              ?.identifierValue
              ? 'present'
              : 'missing',
          },
          contentType: headers['Content-Type'],
          destination: maskBahrainPhone(canonicalPhone),
          hasAuthorization: headers.Authorization.trim().length > 'AccessKey '.length,
          method: 'POST',
          serializedJsonLength: serializedBody.length,
          url,
        });
        response = await fetcher(url, {
          body: serializedBody,
          headers,
          method: 'POST',
          signal: AbortSignal.timeout(timeoutMs),
        });
      } catch {
        throw new BirdSmsError('network', null, 'Bird SMS request failed.');
      }

      const responseBodyForDiagnostics = await response.clone().text().catch(() => '');
      console.info('Bird SMS response diagnostics', {
        rawBodyLength: responseBodyForDiagnostics.length,
        rawBodySnippet:
          responseBodyForDiagnostics.length > 0
            ? sanitizeDiagnosticString(responseBodyForDiagnostics.slice(0, 500))
            : null,
        responseContentType: response.headers.get('content-type'),
        status: response.status,
      });

      if (response.status === 202) {
        const payload = await parseJsonObject(response);
        return {
          messageId: readString(payload, 'id') ?? readString(payload, 'messageId'),
          status: readString(payload, 'status'),
        };
      }

      const diagnostics = await readBirdErrorDiagnostics({
        channelId: config.channelId,
        destination: canonicalPhone,
        response,
        workspaceId: config.workspaceId,
      });
      throw toBirdSmsError(response.status, diagnostics);
    },
  };
}

function toBirdSmsError(
  statusCode: number,
  diagnostics: BirdSmsErrorDiagnostics,
): BirdSmsError {
  if (statusCode === 401 || statusCode === 403) {
    return new BirdSmsError(
      'authentication',
      statusCode,
      'Bird SMS authentication failed.',
      diagnostics,
    );
  }

  if (statusCode === 429) {
    return new BirdSmsError(
      'rate_limit',
      statusCode,
      'Bird SMS rate limit reached.',
      diagnostics,
    );
  }

  if (statusCode >= 400 && statusCode < 500) {
    return new BirdSmsError(
      'recipient',
      statusCode,
      'Bird SMS recipient request failed.',
      diagnostics,
    );
  }

  if (statusCode >= 500) {
    return new BirdSmsError(
      'server',
      statusCode,
      'Bird SMS service failed.',
      diagnostics,
    );
  }

  return new BirdSmsError(
    'configuration',
    statusCode,
    'Unexpected Bird SMS response.',
    diagnostics,
  );
}

async function parseJsonObject(response: Response): Promise<Record<string, unknown>> {
  try {
    const payload = await response.json();
    return payload && typeof payload === 'object' && !Array.isArray(payload)
      ? (payload as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

function readString(payload: Record<string, unknown>, key: string): string | null {
  const value = payload[key];
  return typeof value === 'string' && value.trim() ? value : null;
}

async function readBirdErrorDiagnostics({
  channelId,
  destination,
  response,
  workspaceId,
}: {
  channelId: string;
  destination: string;
  response: Response;
  workspaceId: string;
}): Promise<BirdSmsErrorDiagnostics> {
  const rawBody = await response.text().catch(() => '');
  const parsedBody = parseJsonText(rawBody);

  return {
    status: response.status,
    responseContentType: response.headers.get('content-type'),
    birdCode: pickString(parsedBody, ['code', 'error.code', 'errors.0.code']),
    birdMessage: sanitizeDiagnosticString(
      pickString(parsedBody, ['message', 'error.message', 'errors.0.message']) ??
        (rawBody.trim().startsWith('{') ? null : rawBody),
    ),
    birdDetails: sanitizeDiagnosticValue(
      pickValue(parsedBody, [
        'details',
        'detail',
        'error.details',
        'error.detail',
        'errors.0.details',
        'errors.0.detail',
      ]),
    ),
    birdReference: sanitizeDiagnosticString(
      pickString(parsedBody, ['reference', 'error.reference', 'errors.0.reference']),
    ),
    birdRequestId:
      response.headers.get('x-request-id') ??
      response.headers.get('x-bird-request-id') ??
      pickString(parsedBody, ['request_id', 'requestId', 'error.request_id']),
    rawBodySnippet: sanitizeDiagnosticString(rawBody.slice(0, 500)),
    channelId,
    destination: maskBahrainPhone(destination),
    workspaceId,
  };
}

function parseJsonText(value: string): unknown {
  if (!value.trim()) return null;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function pickString(source: unknown, paths: string[]): string | null {
  for (const path of paths) {
    const value = pickValue(source, path);
    if (typeof value === 'string' && value.trim()) {
      return value;
    }
  }
  return null;
}

function pickValue(source: unknown, paths: string[] | string): unknown {
  const pathList = Array.isArray(paths) ? paths : [paths];

  for (const path of pathList) {
    const value = path.split('.').reduce<unknown>((current, segment) => {
      if (current == null) return undefined;
      if (Array.isArray(current)) {
        const index = Number(segment);
        return Number.isInteger(index) ? current[index] : undefined;
      }
      if (typeof current === 'object') {
        return (current as Record<string, unknown>)[segment];
      }
      return undefined;
    }, source);

    if (value !== undefined && value !== null) {
      return value;
    }
  }

  return null;
}

function sanitizeDiagnosticValue(value: unknown): unknown {
  if (value == null) return null;

  if (typeof value === 'string') {
    return sanitizeDiagnosticString(value);
  }

  if (typeof value === 'number' || typeof value === 'boolean') {
    return value;
  }

  if (Array.isArray(value)) {
    return value.map(sanitizeDiagnosticValue);
  }

  if (typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, nestedValue]) => [
        key,
        sanitizeDiagnosticValue(nestedValue),
      ]),
    );
  }

  return null;
}

function sanitizeDiagnosticString(value: string | null): string | null {
  if (!value) return null;
  return value
    .replace(/\+973(\d{4})(\d{4})/g, '+973****$2')
    .replace(/\b\d{6}\b/g, '[redacted-code]')
    .replace(/AccessKey\s+\S+/gi, 'AccessKey [redacted]');
}

function maskBahrainPhone(value: string) {
  return value.replace(/^(\+973)(\d{4})(\d{4})$/, '$1****$3');
}
