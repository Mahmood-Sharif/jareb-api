const BAHRAIN_E164_RE = /^\+973\d{8}$/;

export function normalizeBahrainPhone(value: string): string {
  const digitsOrPlus = value.trim().replace(/[^\d+]/g, '');
  const canonical = digitsOrPlus.startsWith('+')
    ? digitsOrPlus
    : digitsOrPlus.startsWith('973')
      ? `+${digitsOrPlus}`
      : `+973${digitsOrPlus}`;

  if (!BAHRAIN_E164_RE.test(canonical)) {
    throw new Error('Invalid Bahrain phone number.');
  }

  return canonical;
}

export function tryNormalizeBahrainPhone(value: unknown): string | null {
  if (typeof value !== 'string' || value.trim() === '') return null;
  try {
    return normalizeBahrainPhone(value);
  } catch {
    return null;
  }
}
