import net from 'net';
import { Client as SshClient } from 'ssh2';

// ─── Tunnels SSH -> SOCKS5 local ────────────────────────────────────────────────
// Un proxy SSH ne parle pas HTTP/SOCKS nativement : on ouvre une connexion SSH et
// on expose un petit serveur SOCKS5 local (sans auth) qui relaie chaque connexion
// via le forwarding dynamique SSH (conn.forwardOut). axios/Playwright pointent
// ensuite vers socks5://127.0.0.1:<port>. Auth par mot de passe OU clé privée.

export interface SshProxyConfig {
  host: string;
  port: number;
  username: string;
  password?: string;
  privateKey?: string;
  passphrase?: string;
}

interface Tunnel {
  fingerprint: string;
  conn: SshClient;
  server: net.Server;
  localPort: number;
  connected: boolean;
}

const tunnels = new Map<string, Tunnel>();

function configKey(c: SshProxyConfig): string {
  return `${c.username}@${c.host}:${c.port}`;
}

function configFingerprint(c: SshProxyConfig): string {
  return JSON.stringify([c.host, c.port, c.username, c.password ?? '', c.privateKey ?? '', c.passphrase ?? '']);
}

function teardown(key: string): void {
  const t = tunnels.get(key);
  if (!t) return;
  tunnels.delete(key);
  try { t.server.close(); } catch { /* ignore */ }
  try { t.conn.end(); } catch { /* ignore */ }
}

// Relaie une connexion entrante du serveur SOCKS5 local vers la cible via SSH.
function handleSocksConnection(socket: net.Socket, conn: SshClient): void {
  socket.on('error', () => { /* non bloquant */ });
  socket.once('data', greetingRaw => {
    const greeting = Buffer.isBuffer(greetingRaw) ? greetingRaw : Buffer.from(greetingRaw);
    if (greeting[0] !== 0x05) { socket.end(); return; }
    socket.write(Buffer.from([0x05, 0x00])); // version 5, pas d'authentification
    socket.once('data', reqRaw => {
      const req = Buffer.isBuffer(reqRaw) ? reqRaw : Buffer.from(reqRaw);
      // req: VER CMD RSV ATYP ADDR PORT ; on ne gère que CONNECT (0x01)
      if (req[0] !== 0x05 || req[1] !== 0x01) {
        socket.end(Buffer.from([0x05, 0x07, 0x00, 0x01, 0, 0, 0, 0, 0, 0]));
        return;
      }
      const atyp = req[3];
      let host: string;
      let offset: number;
      if (atyp === 0x01) { // IPv4
        host = `${req[4]}.${req[5]}.${req[6]}.${req[7]}`;
        offset = 8;
      } else if (atyp === 0x03) { // domaine
        const len = req[4];
        host = req.subarray(5, 5 + len).toString('utf8');
        offset = 5 + len;
      } else if (atyp === 0x04) { // IPv6
        const parts: string[] = [];
        for (let i = 0; i < 16; i += 2) parts.push(req.readUInt16BE(4 + i).toString(16));
        host = parts.join(':');
        offset = 20;
      } else {
        socket.end(Buffer.from([0x05, 0x08, 0x00, 0x01, 0, 0, 0, 0, 0, 0]));
        return;
      }
      const port = req.readUInt16BE(offset);
      conn.forwardOut('127.0.0.1', 0, host, port, (err, stream) => {
        if (err) {
          if (!socket.destroyed) socket.end(Buffer.from([0x05, 0x05, 0x00, 0x01, 0, 0, 0, 0, 0, 0]));
          return;
        }
        socket.write(Buffer.from([0x05, 0x00, 0x00, 0x01, 0, 0, 0, 0, 0, 0])); // succès
        socket.pipe(stream).pipe(socket);
        stream.on('error', () => socket.destroy());
        socket.on('close', () => stream.destroy());
      });
    });
  });
}

/**
 * Garantit qu'un tunnel SSH + SOCKS5 local est actif pour cette config et renvoie
 * l'endpoint local. Réutilise le tunnel existant si la config est inchangée.
 */
export async function ensureSshSocks(config: SshProxyConfig): Promise<{ host: string; port: number }> {
  const key = configKey(config);
  const fp = configFingerprint(config);
  const existing = tunnels.get(key);
  if (existing && existing.connected && existing.fingerprint === fp) {
    return { host: '127.0.0.1', port: existing.localPort };
  }
  if (existing) teardown(key); // config changée ou connexion morte -> on repart propre

  const conn = new SshClient();
  const server = net.createServer(sock => handleSocksConnection(sock, conn));
  const tunnel: Tunnel = { fingerprint: fp, conn, server, localPort: 0, connected: false };
  tunnels.set(key, tunnel);

  await new Promise<void>((resolve, reject) => {
    let settled = false;
    const done = (err?: Error) => {
      if (settled) return;
      settled = true;
      if (err) { teardown(key); reject(err); } else resolve();
    };
    conn.on('ready', () => {
      server.listen(0, '127.0.0.1', () => {
        tunnel.localPort = (server.address() as net.AddressInfo).port;
        tunnel.connected = true;
        done();
      });
    });
    conn.on('error', err => { tunnel.connected = false; done(err instanceof Error ? err : new Error(String(err))); });
    conn.on('close', () => { tunnel.connected = false; });

    const connectCfg: Record<string, unknown> = {
      host: config.host,
      port: config.port,
      username: config.username,
      readyTimeout: 20_000,
      keepaliveInterval: 15_000,
    };
    if (config.privateKey) {
      connectCfg.privateKey = config.privateKey;
      if (config.passphrase) connectCfg.passphrase = config.passphrase;
    }
    if (config.password) connectCfg.password = config.password;

    try {
      conn.connect(connectCfg);
    } catch (err) {
      done(err instanceof Error ? err : new Error(String(err)));
    }
  });

  return { host: '127.0.0.1', port: tunnel.localPort };
}

/** Endpoint local synchrone si le tunnel est déjà prêt, sinon null. */
export function getSshLocalEndpoint(config: SshProxyConfig): { host: string; port: number } | null {
  const t = tunnels.get(configKey(config));
  if (t && t.connected && t.fingerprint === configFingerprint(config)) {
    return { host: '127.0.0.1', port: t.localPort };
  }
  return null;
}

/** Ferme tous les tunnels (arrêt propre). */
export function closeAllSshTunnels(): void {
  for (const key of [...tunnels.keys()]) teardown(key);
}
