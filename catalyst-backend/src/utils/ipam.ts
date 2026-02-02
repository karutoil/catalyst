import { Prisma, PrismaClient } from "@prisma/client";

type PrismaLike = PrismaClient | Prisma.TransactionClient;

type PoolRange = {
  start: number;
  end: number;
};

const parseIpv4 = (value: string): number => {
  const parts = value.split(".").map((part) => Number(part));
  if (parts.length !== 4 || parts.some((part) => Number.isNaN(part) || part < 0 || part > 255)) {
    throw new Error(`Invalid IPv4 address: ${value}`);
  }
  return (
    ((parts[0] << 24) >>> 0) +
    ((parts[1] << 16) >>> 0) +
    ((parts[2] << 8) >>> 0) +
    (parts[3] >>> 0)
  );
};

const toIpv4 = (value: number): string =>
  [
    (value >>> 24) & 0xff,
    (value >>> 16) & 0xff,
    (value >>> 8) & 0xff,
    value & 0xff,
  ].join(".");

const parseCidr = (cidr: string): PoolRange => {
  const [ip, prefixRaw] = cidr.split("/");
  if (!ip || prefixRaw === undefined) {
    throw new Error(`Invalid CIDR: ${cidr}`);
  }
  const prefix = Number(prefixRaw);
  if (Number.isNaN(prefix) || prefix < 0 || prefix > 32) {
    throw new Error(`Invalid CIDR prefix: ${cidr}`);
  }

  const ipInt = parseIpv4(ip);
  const mask = prefix === 0 ? 0 : ((~0 << (32 - prefix)) >>> 0);
  const network = ipInt & mask;
  const broadcast = (network | (~mask >>> 0)) >>> 0;

  if (prefix >= 31) {
    return { start: network, end: broadcast };
  }

  return { start: network + 1, end: broadcast - 1 };
};

const getPoolRange = (pool: {
  cidr: string;
  startIp?: string | null;
  endIp?: string | null;
}): PoolRange => {
  const baseRange = parseCidr(pool.cidr);
  const start = pool.startIp ? parseIpv4(pool.startIp) : baseRange.start;
  const end = pool.endIp ? parseIpv4(pool.endIp) : baseRange.end;

  if (start > end) {
    throw new Error("IP range start must be <= end");
  }

  if (start < baseRange.start || end > baseRange.end) {
    throw new Error("IP range must be within CIDR block");
  }

  return { start, end };
};

const getReservedIps = (pool: { reserved?: Prisma.JsonValue; gateway?: string | null }) => {
  const reserved = new Set<string>();
  if (Array.isArray(pool.reserved)) {
    for (const value of pool.reserved) {
      if (typeof value === "string" && value.length > 0) {
        reserved.add(value);
      }
    }
  }
  if (pool.gateway) {
    reserved.add(pool.gateway);
  }
  return reserved;
};

const IPV4_REGEX =
  /^(?:(?:25[0-5]|2[0-4]\d|1\d{2}|[1-9]?\d)\.){3}(?:25[0-5]|2[0-4]\d|1\d{2}|[1-9]?\d)$/;

export const normalizeHostIp = (value?: string | null) => {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (!IPV4_REGEX.test(trimmed)) {
    throw new Error("Host IP must be a valid IPv4 address");
  }
  if (trimmed.startsWith("127.")) {
    throw new Error("Host IP must be a non-loopback IPv4 address");
  }
  return trimmed;
};

export const shouldUseIpam = (networkMode?: string) => {
  if (!networkMode) return false;
  return networkMode !== "bridge" && networkMode !== "host";
};

export const allocateIpForServer = async (
  prisma: PrismaLike,
  {
    nodeId,
    networkName,
    serverId,
    requestedIp,
  }: {
    nodeId: string;
    networkName: string;
    serverId: string;
    requestedIp?: string | null;
  }
): Promise<string | null> => {
  const pool = await prisma.ipPool.findUnique({
    where: {
      nodeId_networkName: {
        nodeId,
        networkName,
      },
    },
    include: {
      allocations: {
        where: { releasedAt: null },
      },
    },
  });

  if (!pool) {
    return null;
  }

  const reserved = getReservedIps(pool);
  const range = getPoolRange(pool);
  const used = new Set(pool.allocations.map((allocation) => allocation.ip));

  if (requestedIp) {
    const ipInt = parseIpv4(requestedIp);
    if (ipInt < range.start || ipInt > range.end) {
      throw new Error("Requested IP is outside of the pool range");
    }
    if (reserved.has(requestedIp)) {
      throw new Error("Requested IP is reserved");
    }
    if (used.has(requestedIp)) {
      throw new Error("Requested IP is already allocated");
    }

    await prisma.ipAllocation.create({
      data: {
        poolId: pool.id,
        serverId,
        ip: requestedIp,
      },
    });

    return requestedIp;
  }

  for (let value = range.start; value <= range.end; value += 1) {
    const ip = toIpv4(value >>> 0);
    if (reserved.has(ip) || used.has(ip)) {
      continue;
    }

    await prisma.ipAllocation.create({
      data: {
        poolId: pool.id,
        serverId,
        ip,
      },
    });

    return ip;
  }

  throw new Error("No available IPs in pool");
};

export const releaseIpForServer = async (
  prisma: PrismaLike,
  serverId: string
) => {
  const allocation = await prisma.ipAllocation.findFirst({
    where: {
      serverId,
      releasedAt: null,
    },
  });

  if (!allocation) {
    return null;
  }

  await prisma.ipAllocation.update({
    where: { id: allocation.id },
    data: { releasedAt: new Date() },
  });

  return allocation.ip;
};

export const summarizePool = (pool: {
  cidr: string;
  startIp?: string | null;
  endIp?: string | null;
  gateway?: string | null;
  reserved?: Prisma.JsonValue;
}) => {
  const range = getPoolRange(pool);
  const reserved = getReservedIps(pool);
  const total = range.end - range.start + 1;
  let reservedCount = 0;
  reserved.forEach((ip) => {
    const value = parseIpv4(ip);
    if (value >= range.start && value <= range.end) {
      reservedCount += 1;
    }
  });
  return {
    rangeStart: toIpv4(range.start),
    rangeEnd: toIpv4(range.end),
    total,
    reserved: Array.from(reserved),
    reservedCount,
  };
};

export const listAvailableIps = async (
  prisma: PrismaLike,
  {
    nodeId,
    networkName,
    limit = 200,
  }: {
    nodeId: string;
    networkName: string;
    limit?: number;
  }
) => {
  const pool = await prisma.ipPool.findUnique({
    where: {
      nodeId_networkName: {
        nodeId,
        networkName,
      },
    },
    include: {
      allocations: {
        where: { releasedAt: null },
        select: { ip: true },
      },
    },
  });

  if (!pool) {
    return null;
  }

  const reserved = getReservedIps(pool);
  const range = getPoolRange(pool);
  const used = new Set(pool.allocations.map((allocation) => allocation.ip));
  const available: string[] = [];

  for (let value = range.start; value <= range.end; value += 1) {
    const ip = toIpv4(value >>> 0);
    if (reserved.has(ip) || used.has(ip)) {
      continue;
    }
    available.push(ip);
    if (available.length >= limit) {
      break;
    }
  }

  return available;
};
