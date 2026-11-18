import crypto from 'crypto';

// ─── TOTP (RFC 6238) ───────────────────────────────────────────────────────────
// Génération de code 2FA à partir d'un secret base32 (type Google Authenticator),
// en pur Node (crypto), sans dépendance. Idée inspirée de github.com/Gusdezup/Autovisit.

function base32Decode(input: string): Buffer {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  const clean = input.replace(/=+$/g, '').replace(/\s+/g, '').toUpperCase();
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const ch of clean) {
    const idx = alphabet.indexOf(ch);
    if (idx === -1) continue; // ignore les caractères non-base32
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      bits -= 8;
      out.push((value >>> bits) & 0xff);
    }
  }
  return Buffer.from(out);
}

/**
 * Génère le code TOTP courant pour un secret base32.
 * Renvoie '' si le secret est vide/invalide.
 */
export function generateTotp(
  secret: string,
  opts: { digits?: number; period?: number; algorithm?: string; timestampMs?: number } = {},
): string {
  const digits = opts.digits ?? 6;
  const period = opts.period ?? 30;
  const algorithm = opts.algorithm ?? 'sha1';
  const key = base32Decode(secret);
  if (key.length === 0) return '';

  const counter = Math.floor(((opts.timestampMs ?? Date.now()) / 1000) / period);
  const buf = Buffer.alloc(8);
  buf.writeBigUInt64BE(BigInt(counter));

  const hmac = crypto.createHmac(algorithm, key).update(buf).digest();
  const offset = hmac[hmac.length - 1] & 0x0f;
  const code = ((hmac[offset] & 0x7f) << 24)
    | ((hmac[offset + 1] & 0xff) << 16)
    | ((hmac[offset + 2] & 0xff) << 8)
    | (hmac[offset + 3] & 0xff);
  return (code % 10 ** digits).toString().padStart(digits, '0');
}

/** Vrai si la chaîne ressemble à un secret base32 exploitable. */
export function looksLikeTotpSecret(secret: string): boolean {
  return base32Decode(secret).length >= 10; // >= 80 bits
}
