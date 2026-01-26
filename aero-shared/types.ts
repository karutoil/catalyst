/**
 * Aero - Shared Type Definitions
 * Client <-> Backend <-> Agent communication protocol
 */

// ============================================================================
// ENUMS & CONSTANTS
// ============================================================================

export enum ServerState {
  STOPPED = "stopped",
  STARTING = "starting",
  RUNNING = "running",
  STOPPING = "stopping",
  CRASHED = "crashed",
  ERROR = "error",
}

export enum NetworkMode {
  HOST = "host",
  BRIDGE = "bridge",
}

export enum Permission {
  SERVER_START = "server.start",
  SERVER_STOP = "server.stop",
  SERVER_READ = "server.read",
  FILE_READ = "file.read",
  FILE_WRITE = "file.write",
  CONSOLE_READ = "console.read",
  CONSOLE_WRITE = "console.write",
  SERVER_CREATE = "server.create",
  SERVER_DELETE = "server.delete",
}

// ============================================================================
// SERVER TEMPLATE SYSTEM
// ============================================================================

export interface EnvironmentVariable {
  name: string;
  description?: string;
  default: string;
  required: boolean;
  input?: "text" | "number" | "select" | "checkbox";
  rules?: string[];
}

export interface ServerTemplate {
  id: string;
  name: string;
  description: string;
  author: string;
  version: string;
  image: string;
  startup: string;
  stopCommand: string;
  sendSignalTo: "SIGTERM" | "SIGKILL";
  variables: EnvironmentVariable[];
  installScript?: string;
  supportedPorts: number[];
  allocatedMemoryMb: number;
  allocatedCpuCores: number;
  features?: {
    restartOnExit?: boolean;
    maxInstances?: number;
    iconUrl?: string;
  };
}

export interface ServerInstance {
  id: string;
  uuid: string;
  name: string;
  description?: string;
  templateId: string;
  nodeId: string;
  ownerId: string;
  status: ServerState;
  allocatedMemoryMb: number;
  allocatedCpuCores: number;
  container: {
    id: string;
    name: string;
  };
  networking: {
    mode: NetworkMode;
    primaryPort: number;
    primaryIp?: string;
    portBindings: Record<number, number>; // container port -> host port
  };
  environment: Record<string, string>;
  createdAt: Date;
  updatedAt: Date;
}

// ============================================================================
// NODE MANAGEMENT
// ============================================================================

export interface Node {
  id: string;
  name: string;
  description?: string;
  hostname: string;
  publicAddress: string;
  secret: string;
  maxMemoryMb: number;
  maxCpuCores: number;
  isOnline: boolean;
  lastSeenAt?: Date;
  createdAt: Date;
}

export interface NodeHealth {
  cpuPercent: number;
  memoryUsageMb: number;
  memoryTotalMb: number;
  uptime: number;
  containerCount: number;
  diskUsageMb: number;
  diskTotalMb: number;
}

// ============================================================================
// WEBSOCKET EVENTS
// ============================================================================

export namespace WsEvent {
  // CLIENT -> BACKEND -> AGENT
  export interface ServerControl {
    action: "start" | "stop" | "kill" | "restart" | "reboot";
    serverId: string;
  }

  export interface ConsoleInput {
    serverId: string;
    data: string;
  }

  export interface FileOperation {
    type: "read" | "write" | "delete" | "list" | "compress" | "decompress";
    serverId: string;
    path: string;
    data?: string | Buffer;
    options?: Record<string, any>;
  }

  // AGENT -> BACKEND -> CLIENT
  export interface ConsoleOutput {
    serverId: string;
    timestamp: number;
    data: string;
    stream: "stdout" | "stderr";
  }

  export interface ServerStateUpdate {
    serverId: string;
    state: ServerState;
    timestamp: number;
    reason?: string;
  }

  export interface HealthReport {
    nodeId: string;
    health: NodeHealth;
    timestamp: number;
  }

  export interface FileOperationResponse {
    requestId: string;
    success: boolean;
    data?: any;
    error?: string;
  }

  // AUTH
  export interface NodeHandshake {
    type: "node_handshake";
    token: string;
    nodeId: string;
  }

  export interface NodeHandshakeResponse {
    type: "node_handshake_response";
    success: boolean;
    cert?: string;
    key?: string;
    backendAddress?: string;
  }
}

// ============================================================================
// API RESPONSES
// ============================================================================

export interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: string;
  code?: string;
}

export interface PaginatedResponse<T> {
  data: T[];
  total: number;
  page: number;
  pageSize: number;
}

// ============================================================================
// AUTHENTICATION
// ============================================================================

export interface JwtPayload {
  userId: string;
  email: string;
  username: string;
  permissions: Permission[];
  exp: number;
}

export interface DeploymentTokenPayload {
  nodeId: string;
  secret: string;
  exp: number;
}

// ============================================================================
// ERROR TYPES
// ============================================================================

export class AeroError extends Error {
  constructor(
    public code: string,
    message: string,
    public statusCode: number = 500
  ) {
    super(message);
    this.name = "AeroError";
  }
}

export const ErrorCodes = {
  AUTH_INVALID_TOKEN: "AUTH_INVALID_TOKEN",
  AUTH_EXPIRED: "AUTH_EXPIRED",
  NODE_NOT_FOUND: "NODE_NOT_FOUND",
  NODE_OFFLINE: "NODE_OFFLINE",
  SERVER_NOT_FOUND: "SERVER_NOT_FOUND",
  SERVER_ALREADY_RUNNING: "SERVER_ALREADY_RUNNING",
  INSUFFICIENT_RESOURCES: "INSUFFICIENT_RESOURCES",
  CONTAINER_ERROR: "CONTAINER_ERROR",
  NETWORK_ERROR: "NETWORK_ERROR",
  FILE_ACCESS_DENIED: "FILE_ACCESS_DENIED",
  PERMISSION_DENIED: "PERMISSION_DENIED",
} as const;
