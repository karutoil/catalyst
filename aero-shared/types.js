/**
 * Aero - Shared Type Definitions
 * Client <-> Backend <-> Agent communication protocol
 */
// ============================================================================
// ENUMS & CONSTANTS
// ============================================================================
export var ServerState;
(function (ServerState) {
    ServerState["STOPPED"] = "stopped";
    ServerState["STARTING"] = "starting";
    ServerState["RUNNING"] = "running";
    ServerState["STOPPING"] = "stopping";
    ServerState["CRASHED"] = "crashed";
    ServerState["ERROR"] = "error";
})(ServerState || (ServerState = {}));
export var NetworkMode;
(function (NetworkMode) {
    NetworkMode["HOST"] = "host";
    NetworkMode["BRIDGE"] = "bridge";
})(NetworkMode || (NetworkMode = {}));
export var Permission;
(function (Permission) {
    Permission["SERVER_START"] = "server.start";
    Permission["SERVER_STOP"] = "server.stop";
    Permission["SERVER_READ"] = "server.read";
    Permission["FILE_READ"] = "file.read";
    Permission["FILE_WRITE"] = "file.write";
    Permission["CONSOLE_READ"] = "console.read";
    Permission["CONSOLE_WRITE"] = "console.write";
    Permission["SERVER_CREATE"] = "server.create";
    Permission["SERVER_DELETE"] = "server.delete";
})(Permission || (Permission = {}));
// ============================================================================
// ERROR TYPES
// ============================================================================
export class AeroError extends Error {
    constructor(code, message, statusCode = 500) {
        super(message);
        this.code = code;
        this.statusCode = statusCode;
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
};
//# sourceMappingURL=types.js.map