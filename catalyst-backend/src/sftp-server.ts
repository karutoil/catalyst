import { readFileSync } from 'fs';
import ssh2 from 'ssh2';
import { join } from 'path';
import { prisma } from './db.js';
import * as fs from 'fs/promises';
import * as fsSync from 'fs';
import { createReadStream, createWriteStream } from 'fs';
import { generateKeyPairSync } from 'crypto';
import type { Logger } from 'pino';
import { auth } from './auth';

const { Server: SSHServer, utils } = ssh2;
type SFTPStream = ssh2.SFTPStream;

const SFTP_PORT = parseInt(process.env.SFTP_PORT || '2022');
const SERVER_FILES_ROOT = process.env.SERVER_FILES_ROOT || '/var/lib/catalyst/servers';

// Generate or load host key
const HOST_KEY_PATH = process.env.SFTP_HOST_KEY || './sftp_host_key';
let hostKey: Buffer;

try {
  hostKey = readFileSync(HOST_KEY_PATH);
} catch {
  // Generate a new RSA key if none exists
  const keyPair = generateKeyPairSync('rsa', {
    modulusLength: 2048,
    privateKeyEncoding: {
      type: 'pkcs1',
      format: 'pem',
    },
    publicKeyEncoding: {
      type: 'spki',
      format: 'pem',
    },
  });
  fsSync.writeFileSync(HOST_KEY_PATH, keyPair.privateKey);
  hostKey = Buffer.from(keyPair.privateKey);
  // Logger not available at module init time, will log when server starts
}

interface SFTPSession {
  userId: string;
  username: string;
  serverId: string;
  serverPath: string;
  permissions: string[];
}

async function validateTokenAndGetServer(username: string, password: string): Promise<SFTPSession | null> {
  try {
    const serverId = username;
    let userId: string | null = null;

    // Try bearer token auth first
    try {
      const session = await auth.api.getSession({
        headers: new Headers({ authorization: `Bearer ${password}` }),
      });
      if (session) {
        userId = session.user.id;
      }
    } catch {
      // Bearer auth failed, try direct session token lookup
    }

    // Fallback: look up session token directly in database
    if (!userId) {
      const dbSession = await prisma.session.findFirst({
        where: {
          token: password,
          expiresAt: { gt: new Date() },
        },
        select: { userId: true },
      });
      if (dbSession) {
        userId = dbSession.userId;
      }
    }

    if (!userId) {
      return null;
    }

    // Check if user has access to this server via ServerAccess
    const serverAccess = await prisma.serverAccess.findFirst({
      where: {
        serverId,
        userId,
      },
      include: {
        server: {
          include: {
            node: true,
          },
        },
      },
    });

    if (!serverAccess) {
      return null;
    }

    const permissions = serverAccess.permissions;
    const serverUuid = serverAccess.server.uuid;

    const serverPath = join(SERVER_FILES_ROOT, serverUuid);

    // Ensure server directory exists
    try {
      await fs.mkdir(serverPath, { recursive: true });
    } catch (err) {
      // Directory creation errors are non-fatal
    }

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { email: true, username: true },
    });

    return {
      userId,
      username: user?.username ?? user?.email ?? userId,
      serverId,
      serverPath,
      permissions,
    };
  } catch (err) {
    return null;
  }
}

function hasPermission(session: SFTPSession, permission: string): boolean {
  // Admins bypass all checks
  if (session.permissions.includes('*')) {
    return true;
  }
  return session.permissions.includes(permission);
}

function normalizePath(serverPath: string, requestedPath: string): string {
  const normalized = join(serverPath, requestedPath);
  
  // Prevent directory traversal
  if (!normalized.startsWith(serverPath)) {
    throw new Error('Path traversal attempt detected');
  }
  
  return normalized;
}

function startSFTPServer(logger: Logger) {
  logger.info({ path: HOST_KEY_PATH }, 'SFTP server starting with host key');
  
  const sshServer = new SSHServer(
    {
      hostKeys: [hostKey],
    },
    (client) => {
      logger.debug('SFTP client connected');

      let session: SFTPSession | null = null;

      client
        .on('authentication', async (ctx) => {
          if (ctx.method === 'password') {
            const username = ctx.username;
            const password = ctx.password;

            session = await validateTokenAndGetServer(username, password);

            if (session) {
              ctx.accept();
            } else {
              ctx.reject(['password']);
            }
          } else {
            ctx.reject(['password']);
          }
        })
        .on('ready', () => {
          logger.debug({ username: session?.username }, 'SFTP client authenticated');

          client.on('session', (accept) => {
            const sshSession = accept();

            sshSession.on('sftp', (accept) => {
              logger.debug({ serverId: session?.serverId }, 'SFTP session started');
              const sftpStream = accept();

              if (!session) {
                logger.error('SFTP session has no authentication data');
                return;
              }

              handleSFTPSession(sftpStream, session);
            });
          });
        })
        .on('error', (err) => {
          logger.error({ err }, 'SFTP client error');
        })
        .on('close', () => {
          logger.debug('SFTP client disconnected');
        });
    }
  );

  sshServer.listen(SFTP_PORT, '0.0.0.0', () => {
    logger.info({ port: SFTP_PORT }, 'SFTP server listening');
  });

  return sshServer;
}

function handleSFTPSession(sftpStream: SFTPStream, session: SFTPSession) {
  const handles = new Map<number, { type: 'file' | 'dir'; path: string; stream?: any; dir?: any; sent?: boolean }>();
  let handleCounter = 0;

  // Serialize all async handlers to prevent interleaved responses
  let queue = Promise.resolve();
  const enqueue = (fn: () => Promise<void>) => {
    queue = queue.then(fn, fn);
  };

  const createHandle = (data: { type: 'file' | 'dir'; path: string; stream?: any; dir?: any; sent?: boolean }): Buffer => {
    const id = handleCounter++;
    const buf = Buffer.alloc(4);
    buf.writeUInt32BE(id, 0);
    handles.set(id, data);
    return buf;
  };

  const getHandle = (buf: Buffer) => {
    const id = buf.readUInt32BE(0);
    return handles.get(id);
  };

  const deleteHandle = (buf: Buffer) => {
    const id = buf.readUInt32BE(0);
    handles.delete(id);
  };

  sftpStream
    .on('OPEN', (reqid, filename, flags, _attrs) => {
      enqueue(async () => {
        try {
          const fullPath = normalizePath(session.serverPath, filename);
          
          if (flags & utils.sftp.OPEN_MODE.WRITE) {
            if (!hasPermission(session, 'file.write')) {
              return sftpStream.status(reqid, utils.sftp.STATUS_CODE.PERMISSION_DENIED);
            }
          } else {
            if (!hasPermission(session, 'file.read')) {
              return sftpStream.status(reqid, utils.sftp.STATUS_CODE.PERMISSION_DENIED);
            }
          }

          let handle: Buffer;

          if (flags & utils.sftp.OPEN_MODE.WRITE) {
            const stream = createWriteStream(fullPath, {
              flags: flags & utils.sftp.OPEN_MODE.APPEND ? 'a' : 'w',
            });
            handle = createHandle({ type: 'file', path: fullPath, stream });
          } else {
            const stream = createReadStream(fullPath);
            handle = createHandle({ type: 'file', path: fullPath, stream });
          }

          sftpStream.handle(reqid, handle);

          await prisma.serverLog.create({
            data: {
              serverId: session.serverId,
              stream: 'system',
              data: `SFTP: ${session.username} opened ${filename}`,
            },
          }).catch(() => {});
        } catch (err: any) {
          console.error('SFTP OPEN error:', err);
          sftpStream.status(reqid, utils.sftp.STATUS_CODE.FAILURE);
        }
      });
    })
    .on('READ', (reqid, handle, offset, length) => {
      enqueue(async () => {
        try {
          const handleData = getHandle(handle);
          if (!handleData || handleData.type !== 'file') {
            return sftpStream.status(reqid, utils.sftp.STATUS_CODE.FAILURE);
          }

          if (!hasPermission(session, 'file.read')) {
            return sftpStream.status(reqid, utils.sftp.STATUS_CODE.PERMISSION_DENIED);
          }

          const buffer = Buffer.alloc(length);
          const fd = await fs.open(handleData.path, 'r');
          const { bytesRead } = await fd.read(buffer, 0, length, offset);
          await fd.close();

          if (bytesRead === 0) {
            sftpStream.status(reqid, utils.sftp.STATUS_CODE.EOF);
          } else {
            sftpStream.data(reqid, buffer.slice(0, bytesRead));
          }
        } catch (err: any) {
          console.error('SFTP READ error:', err);
          sftpStream.status(reqid, utils.sftp.STATUS_CODE.FAILURE);
        }
      });
    })
    .on('WRITE', (reqid, handle, offset, data) => {
      enqueue(async () => {
        try {
          const handleData = getHandle(handle);
          if (!handleData || handleData.type !== 'file') {
            return sftpStream.status(reqid, utils.sftp.STATUS_CODE.FAILURE);
          }

          if (!hasPermission(session, 'file.write')) {
            return sftpStream.status(reqid, utils.sftp.STATUS_CODE.PERMISSION_DENIED);
          }

          const fd = await fs.open(handleData.path, 'r+');
          await fd.write(data, 0, data.length, offset);
          await fd.close();

          sftpStream.status(reqid, utils.sftp.STATUS_CODE.OK);
        } catch (err: any) {
          console.error('SFTP WRITE error:', err);
          sftpStream.status(reqid, utils.sftp.STATUS_CODE.FAILURE);
        }
      });
    })
    .on('CLOSE', (reqid, handle) => {
      enqueue(async () => {
        try {
          const handleData = getHandle(handle);
          if (handleData) {
            if (handleData.stream) {
              handleData.stream.close?.();
            }
            deleteHandle(handle);
          }
          sftpStream.status(reqid, utils.sftp.STATUS_CODE.OK);
        } catch (err: any) {
          console.error('SFTP CLOSE error:', err);
          sftpStream.status(reqid, utils.sftp.STATUS_CODE.FAILURE);
        }
      });
    })
    .on('OPENDIR', (reqid, dirpath) => {
      enqueue(async () => {
        try {
          const fullPath = normalizePath(session.serverPath, dirpath);

          if (!hasPermission(session, 'file.read')) {
            return sftpStream.status(reqid, utils.sftp.STATUS_CODE.PERMISSION_DENIED);
          }

          const entries = await fs.readdir(fullPath, { withFileTypes: true });

          const handle = createHandle({ type: 'dir', path: fullPath, dir: entries, sent: false });

          sftpStream.handle(reqid, handle);
        } catch (err: any) {
          console.error('SFTP OPENDIR error:', err);
          sftpStream.status(reqid, utils.sftp.STATUS_CODE.FAILURE);
        }
      });
    })
    .on('READDIR', (reqid, handle) => {
      enqueue(async () => {
        try {
          const handleData = getHandle(handle);
          if (!handleData || handleData.type !== 'dir') {
            return sftpStream.status(reqid, utils.sftp.STATUS_CODE.FAILURE);
          }

          if (!hasPermission(session, 'file.read')) {
            return sftpStream.status(reqid, utils.sftp.STATUS_CODE.PERMISSION_DENIED);
          }

          // Already sent entries, return EOF
          if (handleData.sent) {
            return sftpStream.status(reqid, utils.sftp.STATUS_CODE.EOF);
          }

          handleData.sent = true;
          const entries = handleData.dir || [];

          // Build file list including . and ..
          const dirStats = await fs.stat(handleData.path);
          const dirAttrs = {
            mode: dirStats.mode,
            uid: dirStats.uid,
            gid: dirStats.gid,
            size: dirStats.size,
            atime: Math.floor(dirStats.atimeMs / 1000),
            mtime: Math.floor(dirStats.mtimeMs / 1000),
          };

          const fileList: Array<{ filename: string; longname: string; attrs: any }> = [
            { filename: '.', longname: formatLongname('.', dirStats), attrs: dirAttrs },
            { filename: '..', longname: formatLongname('..', dirStats), attrs: dirAttrs },
          ];

          for (const entry of entries) {
            const entryPath = join(handleData.path, entry.name);
            try {
              const stats = await fs.stat(entryPath);
              fileList.push({
                filename: entry.name,
                longname: formatLongname(entry.name, stats),
                attrs: {
                  mode: stats.mode,
                  uid: stats.uid,
                  gid: stats.gid,
                  size: stats.size,
                  atime: Math.floor(stats.atimeMs / 1000),
                  mtime: Math.floor(stats.mtimeMs / 1000),
                },
              });
            } catch (err) {
              // Skip entries that can't be stat'd
            }
          }

          sftpStream.name(reqid, fileList);
        } catch (err: any) {
          console.error('SFTP READDIR error:', err);
          sftpStream.status(reqid, utils.sftp.STATUS_CODE.FAILURE);
        }
      });
    })
    .on('STAT', (reqid, filepath) => {
      enqueue(async () => {
        try {
          const fullPath = normalizePath(session.serverPath, filepath);

          if (!hasPermission(session, 'file.read')) {
            return sftpStream.status(reqid, utils.sftp.STATUS_CODE.PERMISSION_DENIED);
          }

          const stats = await fs.stat(fullPath);
          sftpStream.attrs(reqid, {
            mode: stats.mode,
            uid: stats.uid,
            gid: stats.gid,
            size: stats.size,
            atime: Math.floor(stats.atimeMs / 1000),
            mtime: Math.floor(stats.mtimeMs / 1000),
          });
        } catch (err: any) {
          console.error('SFTP STAT error:', err);
          sftpStream.status(reqid, utils.sftp.STATUS_CODE.NO_SUCH_FILE);
        }
      });
    })
    .on('LSTAT', (reqid, filepath) => {
      enqueue(async () => {
        try {
          const fullPath = normalizePath(session.serverPath, filepath);

          if (!hasPermission(session, 'file.read')) {
            return sftpStream.status(reqid, utils.sftp.STATUS_CODE.PERMISSION_DENIED);
          }

          const stats = await fs.lstat(fullPath);
          sftpStream.attrs(reqid, {
            mode: stats.mode,
            uid: stats.uid,
            gid: stats.gid,
            size: stats.size,
            atime: Math.floor(stats.atimeMs / 1000),
            mtime: Math.floor(stats.mtimeMs / 1000),
          });
        } catch (err: any) {
          console.error('SFTP LSTAT error:', err);
          sftpStream.status(reqid, utils.sftp.STATUS_CODE.NO_SUCH_FILE);
        }
      });
    })
    .on('REMOVE', (reqid, filepath) => {
      enqueue(async () => {
        try {
          const fullPath = normalizePath(session.serverPath, filepath);

          if (!hasPermission(session, 'file.delete')) {
            return sftpStream.status(reqid, utils.sftp.STATUS_CODE.PERMISSION_DENIED);
          }

          await fs.unlink(fullPath);
          sftpStream.status(reqid, utils.sftp.STATUS_CODE.OK);

          await prisma.serverLog.create({
            data: {
              serverId: session.serverId,
              stream: 'system',
              data: `SFTP: ${session.username} deleted ${filepath}`,
            },
          }).catch(() => {});
        } catch (err: any) {
          console.error('SFTP REMOVE error:', err);
          sftpStream.status(reqid, utils.sftp.STATUS_CODE.FAILURE);
        }
      });
    })
    .on('RMDIR', (reqid, dirpath) => {
      enqueue(async () => {
        try {
          const fullPath = normalizePath(session.serverPath, dirpath);

          if (!hasPermission(session, 'file.delete')) {
            return sftpStream.status(reqid, utils.sftp.STATUS_CODE.PERMISSION_DENIED);
          }

          await fs.rmdir(fullPath);
          sftpStream.status(reqid, utils.sftp.STATUS_CODE.OK);

          await prisma.serverLog.create({
            data: {
              serverId: session.serverId,
              stream: 'system',
              data: `SFTP: ${session.username} removed directory ${dirpath}`,
            },
          }).catch(() => {});
        } catch (err: any) {
          console.error('SFTP RMDIR error:', err);
          sftpStream.status(reqid, utils.sftp.STATUS_CODE.FAILURE);
        }
      });
    })
    .on('MKDIR', (reqid, dirpath, attrs) => {
      enqueue(async () => {
        try {
          const fullPath = normalizePath(session.serverPath, dirpath);

          if (!hasPermission(session, 'file.write')) {
            return sftpStream.status(reqid, utils.sftp.STATUS_CODE.PERMISSION_DENIED);
          }

          await fs.mkdir(fullPath, { mode: attrs.mode });
          sftpStream.status(reqid, utils.sftp.STATUS_CODE.OK);

          await prisma.serverLog.create({
            data: {
              serverId: session.serverId,
              stream: 'system',
              data: `SFTP: ${session.username} created directory ${dirpath}`,
            },
          }).catch(() => {});
        } catch (err: any) {
          console.error('SFTP MKDIR error:', err);
          sftpStream.status(reqid, utils.sftp.STATUS_CODE.FAILURE);
        }
      });
    })
    .on('RENAME', (reqid, oldPath, newPath) => {
      enqueue(async () => {
        try {
          const fullOldPath = normalizePath(session.serverPath, oldPath);
          const fullNewPath = normalizePath(session.serverPath, newPath);

          if (!hasPermission(session, 'file.write')) {
            return sftpStream.status(reqid, utils.sftp.STATUS_CODE.PERMISSION_DENIED);
          }

          await fs.rename(fullOldPath, fullNewPath);
          sftpStream.status(reqid, utils.sftp.STATUS_CODE.OK);

          await prisma.serverLog.create({
            data: {
              serverId: session.serverId,
              stream: 'system',
              data: `SFTP: ${session.username} renamed ${oldPath} to ${newPath}`,
            },
          }).catch(() => {});
        } catch (err: any) {
          console.error('SFTP RENAME error:', err);
          sftpStream.status(reqid, utils.sftp.STATUS_CODE.FAILURE);
        }
      });
    })
    .on('REALPATH', (reqid, path) => {
      try {
        // For chroot, we always resolve relative to the server root
        const normalized = path === '.' || path === '/' ? '/' : `/${  path.replace(/^\/+/, '')}`;
        sftpStream.name(reqid, [{ filename: normalized, longname: normalized, attrs: {} }]);
      } catch (err: any) {
        console.error('SFTP REALPATH error:', err);
        sftpStream.status(reqid, utils.sftp.STATUS_CODE.FAILURE);
      }
    });
}

function formatLongname(filename: string, stats: any): string {
  const isDir = stats.isDirectory();
  const perms = formatPermissions(stats.mode);
  const size = stats.size.toString().padStart(10);
  const date = new Date(stats.mtimeMs).toISOString().slice(0, 16).replace('T', ' ');
  return `${perms} 1 1000 1000 ${size} ${date} ${filename}`;
}

function formatPermissions(mode: number): string {
  const types = ['---', '--x', '-w-', '-wx', 'r--', 'r-x', 'rw-', 'rwx'];
  const isDir = (mode & 0o040000) !== 0;
  const prefix = isDir ? 'd' : '-';
  
  const owner = types[(mode >> 6) & 7];
  const group = types[(mode >> 3) & 7];
  const other = types[mode & 7];
  
  return prefix + owner + group + other;
}

export { startSFTPServer };
