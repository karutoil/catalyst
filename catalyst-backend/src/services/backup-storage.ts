import { createReadStream, createWriteStream } from "fs";
import * as fs from "fs/promises";
import path from "path";
import { PassThrough, Readable } from "stream";
import crypto from "crypto";
import { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand } from "@aws-sdk/client-s3";
import type { WebSocketGateway } from "../websocket/gateway";

export type BackupStorageMode = "local" | "s3" | "stream";

const BACKUP_DIR = process.env.BACKUP_DIR || "/var/lib/catalyst/backups";
const STREAM_DIR = process.env.BACKUP_STREAM_DIR || "/tmp/catalyst-backup-stream";
const TRANSFER_DIR = process.env.BACKUP_TRANSFER_DIR || "/tmp/catalyst-backup-transfer";

let cachedS3Client: S3Client | null = null;

type S3Config = {
  client: S3Client;
  bucket: string;
};

const ensureS3Config = (): S3Config => {
  const bucket = process.env.BACKUP_S3_BUCKET;
  const region = process.env.BACKUP_S3_REGION;
  const accessKeyId = process.env.BACKUP_S3_ACCESS_KEY;
  const secretAccessKey = process.env.BACKUP_S3_SECRET_KEY;
  if (!bucket || !region || !accessKeyId || !secretAccessKey) {
    throw new Error("S3 backup configuration is missing");
  }
  if (!cachedS3Client) {
    cachedS3Client = new S3Client({
      region,
      endpoint: process.env.BACKUP_S3_ENDPOINT || undefined,
      forcePathStyle: process.env.BACKUP_S3_PATH_STYLE === "true",
      credentials: { accessKeyId, secretAccessKey },
    });
  }
  return { client: cachedS3Client, bucket };
};

export const resolveBackupStorageMode = (server?: { backupStorageMode?: string | null }) => {
  const raw = (server?.backupStorageMode || process.env.BACKUP_STORAGE_MODE || "local").toLowerCase();
  if (raw === "s3" || raw === "stream" || raw === "local") {
    return raw as BackupStorageMode;
  }
  return "local";
};

export const resolveRetentionPolicy = (server?: {
  backupRetentionCount?: number | null;
  backupRetentionDays?: number | null;
}) => ({
  count: Math.max(0, server?.backupRetentionCount ?? 0),
  days: Math.max(0, server?.backupRetentionDays ?? 0),
});

export const buildBackupPaths = (serverUuid: string, backupName: string, mode: BackupStorageMode) => {
  const fileName = `${backupName}.tar.gz`;
  const agentPath =
    mode === "stream"
      ? path.join(STREAM_DIR, serverUuid, fileName)
      : path.join(BACKUP_DIR, serverUuid, fileName);

  if (mode === "s3") {
    const { bucket } = ensureS3Config();
    const storageKey = `backups/${serverUuid}/${fileName}`;
    return {
      agentPath,
      storagePath: `s3://${bucket}/${storageKey}`,
      storageKey,
    };
  }

  return {
    agentPath,
    storagePath: path.join(BACKUP_DIR, serverUuid, fileName),
    storageKey: null as string | null,
  };
};

const ensureLocalDir = async (targetPath: string) => {
  await fs.mkdir(path.dirname(targetPath), { recursive: true });
};

export const streamAgentBackupToLocal = async (
  gateway: WebSocketGateway,
  nodeId: string,
  serverId: string,
  agentPath: string,
  destinationPath: string,
) => {
  await ensureLocalDir(destinationPath);
  const response = await gateway.requestFromAgent(nodeId, {
    type: "download_backup_start",
    serverId,
    backupPath: agentPath,
  });
  const requestId = response?.requestId as string | undefined;
  if (!requestId) {
    throw new Error("Missing download requestId");
  }
  const writeStream = createWriteStream(destinationPath);
  await gateway.streamBinaryFromAgent(
    nodeId,
    { type: "download_backup", serverId, backupPath: agentPath, requestId },
    (chunk) => {
      writeStream.write(chunk);
    },
  );
  writeStream.end();
  await new Promise<void>((resolve, reject) => {
    writeStream.on("finish", () => resolve());
    writeStream.on("error", reject);
  });
};

export const streamAgentBackupToS3 = async (
  gateway: WebSocketGateway,
  nodeId: string,
  serverId: string,
  agentPath: string,
  storageKey: string,
) => {
  const { client, bucket } = ensureS3Config();
  const passThrough = new PassThrough();
  const upload = client.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: storageKey,
      Body: passThrough,
      ContentType: "application/gzip",
    }),
  );

  const response = await gateway.requestFromAgent(nodeId, {
    type: "download_backup_start",
    serverId,
    backupPath: agentPath,
  });
  const requestId = response?.requestId as string | undefined;
  if (!requestId) {
    throw new Error("Missing download requestId");
  }

  await gateway.streamBinaryFromAgent(
    nodeId,
    { type: "download_backup", serverId, backupPath: agentPath, requestId },
    (chunk) => {
      passThrough.write(chunk);
    },
  );
  passThrough.end();
  await upload;
};

export const openStorageStream = async (backup: { path: string; storageMode?: string; metadata?: any }) => {
  const mode = (backup.storageMode || "local") as BackupStorageMode;
  if (mode === "s3") {
    const { client, bucket } = ensureS3Config();
    const storageKey = backup.metadata?.storageKey as string | undefined;
    if (!storageKey) {
      throw new Error("Missing S3 storage key");
    }
    const response = await client.send(
      new GetObjectCommand({
        Bucket: bucket,
        Key: storageKey,
      }),
    );
    return {
      stream: response.Body as Readable,
      contentLength: response.ContentLength,
    };
  }

  return {
    stream: createReadStream(backup.path),
    contentLength: undefined,
  };
};

export const deleteBackupFromStorage = async (
  gateway: WebSocketGateway,
  backup: { id: string; path: string; storageMode?: string; metadata?: any },
  server: { id: string; nodeId: string; node?: { isOnline: boolean } } | null,
) => {
  const mode = (backup.storageMode || "local") as BackupStorageMode;
  if (mode === "s3") {
    const { client, bucket } = ensureS3Config();
    const storageKey = backup.metadata?.storageKey as string | undefined;
    if (storageKey) {
      await client.send(
        new DeleteObjectCommand({
          Bucket: bucket,
          Key: storageKey,
        }),
      );
    }
    return;
  }

  try {
    await fs.unlink(backup.path);
    return;
  } catch {
    // ignore if local path doesn't exist
  }

  const agentPath = backup.metadata?.agentPath as string | undefined;
  if (server?.node?.isOnline && agentPath) {
    await gateway.sendToAgent(server.nodeId, {
      type: "delete_backup",
      serverId: server.id,
      backupPath: agentPath,
    });
  }
};

export const uploadStreamToAgent = async (
  gateway: WebSocketGateway,
  nodeId: string,
  serverId: string,
  targetPath: string,
  source: Readable,
) => {
  const requestId = crypto.randomUUID();
  await gateway.requestFromAgent(nodeId, {
    type: "upload_backup_start",
    requestId,
    serverId,
    backupPath: targetPath,
  });

  for await (const chunk of source) {
    if (!chunk || chunk.length === 0) continue;
    await gateway.sendToAgent(nodeId, {
      type: "upload_backup_chunk",
      requestId,
      serverId,
      data: Buffer.isBuffer(chunk) ? chunk.toString("base64") : Buffer.from(chunk).toString("base64"),
    });
  }

  await gateway.requestFromAgent(nodeId, {
    type: "upload_backup_complete",
    requestId,
    serverId,
  });
};

export const buildTransferBackupPath = (serverUuid: string, backupName: string) =>
  path.join(TRANSFER_DIR, serverUuid, `${backupName}.tar.gz`);
