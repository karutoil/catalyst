/**
 * Catalyst - Shared Type Definitions
 * Client <-> Backend <-> Agent communication protocol
 */
export declare enum ServerState {
    STOPPED = "stopped",
    INSTALLING = "installing",
    STARTING = "starting",
    RUNNING = "running",
    STOPPING = "stopping",
    CRASHED = "crashed",
    SUSPENDED = "suspended",
    ERROR = "error"
}
export declare enum NetworkMode {
    HOST = "host",
    BRIDGE = "bridge"
}
export declare enum Permission {
    SERVER_START = "server.start",
    SERVER_STOP = "server.stop",
    SERVER_READ = "server.read",
    FILE_READ = "file.read",
    FILE_WRITE = "file.write",
    CONSOLE_READ = "console.read",
    CONSOLE_WRITE = "console.write",
    SERVER_CREATE = "server.create",
    SERVER_DELETE = "server.delete",
    SERVER_SUSPEND = "server.suspend",
    DATABASE_CREATE = "database.create",
    DATABASE_READ = "database.read",
    DATABASE_DELETE = "database.delete",
    DATABASE_ROTATE = "database.rotate"
}
export interface EnvironmentVariable {
    name: string;
    description?: string;
    default: string;
    required: boolean;
    input?: "text" | "number" | "select" | "checkbox";
    rules?: string[];
}
export interface TemplateImageOption {
    name: string;
    label?: string;
    image: string;
}
export interface ServerTemplate {
    id: string;
    name: string;
    description: string;
    author: string;
    version: string;
    image: string;
    images?: TemplateImageOption[];
    defaultImage?: string;
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
        configFile?: string;
    configFiles?: string[];
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
    allocatedDiskMb: number;
    container: {
        id: string;
        name: string;
    };
    networking: {
        mode: NetworkMode;
        primaryPort: number;
        primaryIp?: string;
        portBindings: Record<number, number>;
    };
    environment: Record<string, string>;
    createdAt: Date;
    updatedAt: Date;
}
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
export declare namespace WsEvent {
    interface ServerControl {
        action: "start" | "stop" | "kill" | "restart" | "reboot";
        serverId: string;
    }
    interface ConsoleInput {
        serverId: string;
        data: string;
    }
    interface FileOperation {
        type: "read" | "write" | "delete" | "list" | "compress" | "decompress";
        serverId: string;
        path: string;
        data?: string | Buffer;
        options?: Record<string, any>;
    }
    interface ConsoleOutput {
        serverId: string;
        timestamp: number;
        data: string;
        stream: "stdout" | "stderr";
    }
    interface ServerStateUpdate {
        serverId: string;
        state: ServerState;
        timestamp: number;
        reason?: string;
        portBindings?: Record<number, number>;
        exitCode?: number;
    }
    interface HealthReport {
        nodeId: string;
        health: NodeHealth;
        timestamp: number;
    }
    interface FileOperationResponse {
        requestId: string;
        success: boolean;
        data?: any;
        error?: string;
    }
    interface NodeHandshake {
        type: "node_handshake";
        token: string;
        nodeId: string;
        tokenType?: "secret" | "api_key";
    }
    interface NodeHandshakeResponse {
        type: "node_handshake_response";
        success: boolean;
        cert?: string;
        key?: string;
        backendAddress?: string;
    }
}
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
export declare class CatalystError extends Error {
    code: string;
    statusCode: number;
    constructor(code: string, message: string, statusCode?: number);
}
export declare const ErrorCodes: {
    readonly AUTH_INVALID_TOKEN: "AUTH_INVALID_TOKEN";
    readonly AUTH_EXPIRED: "AUTH_EXPIRED";
    readonly NODE_NOT_FOUND: "NODE_NOT_FOUND";
    readonly NODE_OFFLINE: "NODE_OFFLINE";
    readonly SERVER_NOT_FOUND: "SERVER_NOT_FOUND";
    readonly SERVER_ALREADY_RUNNING: "SERVER_ALREADY_RUNNING";
    readonly INSUFFICIENT_RESOURCES: "INSUFFICIENT_RESOURCES";
    readonly CONTAINER_ERROR: "CONTAINER_ERROR";
    readonly NETWORK_ERROR: "NETWORK_ERROR";
    readonly FILE_ACCESS_DENIED: "FILE_ACCESS_DENIED";
    readonly PERMISSION_DENIED: "PERMISSION_DENIED";
};
//# sourceMappingURL=types.d.ts.map
