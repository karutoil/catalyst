# Fastify Security Audit

### 1. [Severity: High] - Hardcoded auth secret fallback
**Location:** `catalyst-backend/src/auth.ts`
**Explanation:** In production, a hardcoded default secret can be used when the env var is missing, enabling token forgery.
**Fix:**
```typescript
const authSecret = process.env.BETTER_AUTH_SECRET; // CHANGED: prefer explicit secret
if (!authSecret && process.env.NODE_ENV === "production") {
  throw new Error("BETTER_AUTH_SECRET is required in production"); // CHANGED: prevent default in prod
}

export const auth = betterAuth({
  // ...
  secret: authSecret || "dev-better-auth-secret", // CHANGED: dev-only fallback
  // ...
});
```

### 2. [Severity: Medium] - Missing centralized error handler
**Location:** `catalyst-backend/src/index.ts`
**Explanation:** Unhandled errors may leak stack traces or internal messages to clients.
**Fix:**
```typescript
app.setErrorHandler((error, _request, reply) => {
  app.log.error(error);
  const status = error.statusCode && error.statusCode >= 400 ? error.statusCode : 500;
  reply.status(status).send({
    error: status === 500 ? "Internal Server Error" : error.message, // CHANGED: hide internals
  });
});
```

### 3. [Severity: High] - Archive path traversal (Zip Slip)
**Location:** `catalyst-backend/src/routes/servers.ts`
**Explanation:** Decompression trusts archive paths, allowing files to be written outside the server directory.
**Fix:**
```typescript
const validateArchiveEntries = async (archivePath: string, isZip: boolean) => {
  const { stdout } = isZip
    ? await execFileAsync("unzip", ["-Z", "-1", archivePath])
    : await execFileAsync("tar", ["-tzf", archivePath]);
  const entries = stdout
    .split("\n")
    .map((entry) => entry.trim())
    .filter(Boolean);
  for (const entry of entries) {
    const normalized = path.posix.normalize(entry);
    if (normalized.startsWith("..") || path.posix.isAbsolute(normalized)) {
      throw new Error("Archive contains invalid paths"); // CHANGED: block zip slip
    }
  }
};

const isZip = archiveLower.endsWith(".zip");
await validateArchiveEntries(archiveFullPath, isZip); // CHANGED: validate entries
if (isZip) {
  await execFileAsync("unzip", ["-o", archiveFullPath, "-d", targetFullPath]);
} else {
  await execFileAsync("tar", ["-xzf", archiveFullPath, "-C", targetFullPath]);
}
```

### 4. [Severity: Medium] - Unbounded metrics query parameters
**Location:** `catalyst-backend/src/routes/metrics.ts`
**Explanation:** `hours` and `limit` are user-controlled and can trigger large queries and heavy CPU usage.
**Fix:**
```typescript
const parsedHours = hours ? parseInt(hours) : 1;
const parsedLimit = limit ? parseInt(limit) : 100;
const hoursBack = Number.isFinite(parsedHours) ? Math.min(Math.max(parsedHours, 1), 168) : 1; // CHANGED: clamp
const maxRecords = Number.isFinite(parsedLimit) ? Math.min(Math.max(parsedLimit, 1), 1000) : 100; // CHANGED: clamp
```

### 5. [Severity: Low] - Unbounded backup pagination parameters
**Location:** `catalyst-backend/src/routes/backups.ts`
**Explanation:** `limit` and `page` are user-controlled and can cause heavy database work or negative offsets.
**Fix:**
```typescript
const parsedLimit = parseInt(limit);
const parsedPage = parseInt(page);
const limitNum = Number.isFinite(parsedLimit) ? Math.min(Math.max(parsedLimit, 1), 100) : 50; // CHANGED: clamp
const pageNum = Number.isFinite(parsedPage) ? Math.max(parsedPage, 1) : 1; // CHANGED: clamp
```

### 6. [Severity: High] - Mass assignment on template update
**Location:** `catalyst-backend/src/routes/templates.ts`
**Explanation:** Update path spreads arbitrary request body into Prisma update data, allowing unintended field updates.
**Fix:**
```typescript
const { name, description, author, version, image, installImage, startup, stopCommand, sendSignalTo, variables, installScript, configFile, supportedPorts, allocatedMemoryMb, allocatedCpuCores, features } =
  request.body as {
    name?: string;
    description?: string;
    author?: string;
    version?: string;
    image?: string;
    installImage?: string;
    startup?: string;
    stopCommand?: string;
    sendSignalTo?: string;
    variables?: any[];
    installScript?: string;
    configFile?: string;
    supportedPorts?: number[];
    allocatedMemoryMb?: number;
    allocatedCpuCores?: number;
    features?: Record<string, any>;
  };
const nextData: Record<string, unknown> = {}; // CHANGED: allow-list fields only
if (name !== undefined) nextData.name = name;
if (description !== undefined) nextData.description = description;
if (author !== undefined) nextData.author = author;
if (version !== undefined) nextData.version = version;
if (image !== undefined) nextData.image = image;
if (installImage !== undefined) nextData.installImage = installImage;
if (startup !== undefined) nextData.startup = startup;
if (stopCommand !== undefined) nextData.stopCommand = stopCommand;
if (sendSignalTo !== undefined) nextData.sendSignalTo = sendSignalTo;
if (variables !== undefined) nextData.variables = variables;
if (installScript !== undefined) nextData.installScript = installScript;
if (supportedPorts !== undefined) nextData.supportedPorts = supportedPorts;
if (allocatedMemoryMb !== undefined) nextData.allocatedMemoryMb = allocatedMemoryMb;
if (allocatedCpuCores !== undefined) nextData.allocatedCpuCores = allocatedCpuCores;
if (features !== undefined) {
  nextData.features = { ...features, ...(configFile ? { configFile } : {}) };
} else if (configFile !== undefined) {
  nextData.features = { ...(template.features as Record<string, unknown>), configFile };
}
```
