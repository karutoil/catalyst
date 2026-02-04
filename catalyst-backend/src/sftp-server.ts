import { readFileSync } from 'fs';
import ssh2 from 'ssh2';
import { join } from 'path';
import { PrismaClient } from '@prisma/client';
import * as fs from 'fs/promises';
import * as fsSync from 'fs';
import { createReadStream, createWriteStream } from 'fs';
import { generateKeyPairSync } from 'crypto';
import type { Logger } from 'pino';
import { auth } from './auth';

const { Server: SSHServer, utils } = ssh2;
type SFTPStream = ssh2.SFTPStream;

const prisma = new PrismaClient();

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
    // Username format: serverId
    const serverId = username;

    const session = await auth.api.getSession({
      headers: new Headers({ authorization: `Bearer ${password}` }),
    });
    if (!session) {
      return null;
    }

    // Check if user has access to this server via ServerAccess
    const serverAccess = await prisma.serverAccess.findFirst({
      where: {
        serverId,
        userId: session.user.id,
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

    const serverPath = join(SERVER_FILES_ROOT, serverId, 'files');

    // Ensure server directory exists
    try {
      await fs.mkdir(serverPath, { recursive: true });
    } catch (err) {
      // Directory creation errors are non-fatal
    }

    return {
      userId: session.user.id,
      username: (session.user as any).username ?? session.user.email,
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
              ctx.reject();
            }
          } else {
            ctx.reject();
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
  const handles = new Map<Buffer, { type: 'file' | 'dir'; path: string; stream?: any; dir?: any }>();
  let handleCounter = 0;

  sftpStream
    .on('OPEN', async (reqid, filename, flags, attrs) => {
      try {
        const fullPath = normalizePath(session.serverPath, filename);
        
        // Check permissions
        if (flags & utils.sftp.OPEN_MODE.WRITE) {
          if (!hasPermission(session, 'file.write')) {
            return sftpStream.status(reqid, utils.sftp.STATUS_CODE.PERMISSION_DENIED);
          }
        } else {
          if (!hasPermission(session, 'file.read')) {
            return sftpStream.status(reqid, utils.sftp.STATUS_CODE.PERMISSION_DENIED);
          }
        }

        const handle = Buffer.alloc(4);
        handle.writeUInt32BE(handleCounter++, 0);

        if (flags & utils.sftp.OPEN_MODE.WRITE) {
          const stream = createWriteStream(fullPath, {
            flags: flags & utils.sftp.OPEN_MODE.APPEND ? 'a' : 'w',
          });
          handles.set(handle, { type: 'file', path: fullPath, stream });
        } else {
          const stream = createReadStream(fullPath);
          handles.set(handle, { type: 'file', path: fullPath, stream });
        }

        sftpStream.handle(reqid, handle);

        // Log file access
        await prisma.serverLog.create({
          data: {
            serverId: session.serverId,
            stream: 'system',
            data: `SFTP: ${session.username} opened ${filename}`,
          },
        });
      } catch (err: any) {
        console.error('SFTP OPEN error:', err);
        sftpStream.status(reqid, utils.sftp.STATUS_CODE.FAILURE);
      }
    })
    .on('READ', async (reqid, handle, offset, length) => {
      try {
        const handleData = handles.get(handle);
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
    })
    .on('WRITE', async (reqid, handle, offset, data) => {
      try {
        const handleData = handles.get(handle);
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
    })
    .on('CLOSE', async (reqid, handle) => {
      try {
        const handleData = handles.get(handle);
        if (handleData) {
          if (handleData.stream) {
            handleData.stream.close?.();
          }
          handles.delete(handle);
        }
        sftpStream.status(reqid, utils.sftp.STATUS_CODE.OK);
      } catch (err: any) {
        console.error('SFTP CLOSE error:', err);
        sftpStream.status(reqid, utils.sftp.STATUS_CODE.FAILURE);
      }
    })
    .on('OPENDIR', async (reqid, path) => {
      try {
        const fullPath = normalizePath(session.serverPath, path);

        if (!hasPermission(session, 'file.read')) {
          return sftpStream.status(reqid, utils.sftp.STATUS_CODE.PERMISSION_DENIED);
        }

        const entries = await fs.readdir(fullPath, { withFileTypes: true });

        const handle = Buffer.alloc(4);
        handle.writeUInt32BE(handleCounter++, 0);
        handles.set(handle, { type: 'dir', path: fullPath, dir: entries });

        sftpStream.handle(reqid, handle);
      } catch (err: any) {
        console.error('SFTP OPENDIR error:', err);
        sftpStream.status(reqid, utils.sftp.STATUS_CODE.FAILURE);
      }
    })
    .on('READDIR', async (reqid, handle) => {
      try {
        const handleData = handles.get(handle);
        if (!handleData || handleData.type !== 'dir') {
          return sftpStream.status(reqid, utils.sftp.STATUS_CODE.FAILURE);
        }

        if (!hasPermission(session, 'file.read')) {
          return sftpStream.status(reqid, utils.sftp.STATUS_CODE.PERMISSION_DENIED);
        }

        const entries = handleData.dir;
        if (!entries || entries.length === 0) {
          return sftpStream.status(reqid, utils.sftp.STATUS_CODE.EOF);
        }

        const fileList: Array<{
          filename: string;
          longname: string;
          attrs: {
            mode: number;
            uid: number;
            gid: number;
            size: number;
            atime: number;
            mtime: number;
          };
        }> = [];
        for (const entry of entries.splice(0, 100)) {
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
            console.error(`Failed to stat ${entryPath}:`, err);
          }
        }

        if (fileList.length === 0) {
          sftpStream.status(reqid, utils.sftp.STATUS_CODE.EOF);
        } else {
          sftpStream.name(reqid, fileList);
        }
      } catch (err: any) {
        console.error('SFTP READDIR error:', err);
        sftpStream.status(reqid, utils.sftp.STATUS_CODE.FAILURE);
      }
    })
    .on('STAT', async (reqid, path) => {
      try {
        const fullPath = normalizePath(session.serverPath, path);

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
    })
    .on('LSTAT', async (reqid, path) => {
      try {
        const fullPath = normalizePath(session.serverPath, path);

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
    })
    .on('REMOVE', async (reqid, path) => {
      try {
        const fullPath = normalizePath(session.serverPath, path);

        if (!hasPermission(session, 'file.delete')) {
          return sftpStream.status(reqid, utils.sftp.STATUS_CODE.PERMISSION_DENIED);
        }

        await fs.unlink(fullPath);
        sftpStream.status(reqid, utils.sftp.STATUS_CODE.OK);

        await prisma.serverLog.create({
          data: {
            serverId: session.serverId,
            stream: 'system',
            data: `SFTP: ${session.username} deleted ${path}`,
          },
        });
      } catch (err: any) {
        console.error('SFTP REMOVE error:', err);
        sftpStream.status(reqid, utils.sftp.STATUS_CODE.FAILURE);
      }
    })
    .on('RMDIR', async (reqid, path) => {
      try {
        const fullPath = normalizePath(session.serverPath, path);

        if (!hasPermission(session, 'file.delete')) {
          return sftpStream.status(reqid, utils.sftp.STATUS_CODE.PERMISSION_DENIED);
        }

        await fs.rmdir(fullPath);
        sftpStream.status(reqid, utils.sftp.STATUS_CODE.OK);

        await prisma.serverLog.create({
          data: {
            serverId: session.serverId,
            stream: 'system',
            data: `SFTP: ${session.username} removed directory ${path}`,
          },
        });
      } catch (err: any) {
        console.error('SFTP RMDIR error:', err);
        sftpStream.status(reqid, utils.sftp.STATUS_CODE.FAILURE);
      }
    })
    .on('MKDIR', async (reqid, path, attrs) => {
      try {
        const fullPath = normalizePath(session.serverPath, path);

        if (!hasPermission(session, 'file.write')) {
          return sftpStream.status(reqid, utils.sftp.STATUS_CODE.PERMISSION_DENIED);
        }

        await fs.mkdir(fullPath, { mode: attrs.mode });
        sftpStream.status(reqid, utils.sftp.STATUS_CODE.OK);

        await prisma.serverLog.create({
          data: {
            serverId: session.serverId,
            stream: 'system',
            data: `SFTP: ${session.username} created directory ${path}`,
          },
        });
      } catch (err: any) {
        console.error('SFTP MKDIR error:', err);
        sftpStream.status(reqid, utils.sftp.STATUS_CODE.FAILURE);
      }
    })
    .on('RENAME', async (reqid, oldPath, newPath) => {
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
        });
      } catch (err: any) {
        console.error('SFTP RENAME error:', err);
        sftpStream.status(reqid, utils.sftp.STATUS_CODE.FAILURE);
      }
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
