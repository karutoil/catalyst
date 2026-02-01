import crypto from "crypto";

const ENCRYPTION_VERSION = "v1";
const KEY_ENV = "BACKUP_CREDENTIALS_ENCRYPTION_KEY";
const KEY_LENGTH = 32;
const IV_LENGTH = 12;
const TAG_LENGTH = 16;

const getKey = () => {
  const raw = process.env[KEY_ENV];
  if (!raw) {
    throw new Error(`${KEY_ENV} is required to encrypt backup credentials`);
  }
  const key = Buffer.from(raw, "base64");
  if (key.length !== KEY_LENGTH) {
    throw new Error(`${KEY_ENV} must be 32 bytes (base64 encoded)`);
  }
  return key;
};

const encryptValue = (value: string) => {
  const key = getKey();
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${ENCRYPTION_VERSION}:${Buffer.concat([iv, tag, encrypted]).toString("base64")}`;
};

const decryptValue = (value: string) => {
  if (!value || typeof value !== "string") return value;
  const [version, payload] = value.split(":", 2);
  if (version !== ENCRYPTION_VERSION || !payload) return value;
  const key = getKey();
  const buffer = Buffer.from(payload, "base64");
  const iv = buffer.subarray(0, IV_LENGTH);
  const tag = buffer.subarray(IV_LENGTH, IV_LENGTH + TAG_LENGTH);
  const encrypted = buffer.subarray(IV_LENGTH + TAG_LENGTH);
  const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  const decrypted = Buffer.concat([decipher.update(encrypted), decipher.final()]);
  return decrypted.toString("utf8");
};

export const encryptBackupConfig = (config: Record<string, any> | null | undefined) => {
  if (!config) return config;
  return {
    ...config,
    secretAccessKey: config.secretAccessKey ? encryptValue(config.secretAccessKey) : config.secretAccessKey,
    password: config.password ? encryptValue(config.password) : config.password,
    privateKey: config.privateKey ? encryptValue(config.privateKey) : config.privateKey,
    privateKeyPassphrase: config.privateKeyPassphrase
      ? encryptValue(config.privateKeyPassphrase)
      : config.privateKeyPassphrase,
  };
};

export const decryptBackupConfig = (config: Record<string, any> | null | undefined) => {
  if (!config) return config;
  return {
    ...config,
    secretAccessKey: config.secretAccessKey ? decryptValue(config.secretAccessKey) : config.secretAccessKey,
    password: config.password ? decryptValue(config.password) : config.password,
    privateKey: config.privateKey ? decryptValue(config.privateKey) : config.privateKey,
    privateKeyPassphrase: config.privateKeyPassphrase
      ? decryptValue(config.privateKeyPassphrase)
      : config.privateKeyPassphrase,
  };
};

export const redactBackupConfig = (config: Record<string, any> | null | undefined) => {
  if (!config) return config;
  return {
    ...config,
    secretAccessKey: config.secretAccessKey ? "********" : config.secretAccessKey,
    password: config.password ? "********" : config.password,
    privateKey: config.privateKey ? "********" : config.privateKey,
    privateKeyPassphrase: config.privateKeyPassphrase ? "********" : config.privateKeyPassphrase,
  };
};
