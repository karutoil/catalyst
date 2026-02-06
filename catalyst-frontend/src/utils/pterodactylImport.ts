/**
 * Converts a Pterodactyl egg JSON to the Catalyst template format.
 * Detects PTDL format automatically via meta.version or known fields.
 */

interface PtdlVariable {
  name: string;
  description?: string;
  env_variable: string;
  default_value: string;
  user_viewable?: boolean;
  user_editable?: boolean;
  rules?: string;
  field_type?: string;
}

interface PtdlEgg {
  meta?: { version?: string };
  name?: string;
  author?: string;
  description?: string;
  docker_images?: Record<string, string>;
  startup?: string;
  config?: {
    stop?: string;
    startup?: string;
    files?: string;
    logs?: string;
  };
  scripts?: {
    installation?: {
      script?: string;
      container?: string;
      entrypoint?: string;
    };
  };
  variables?: PtdlVariable[];
  features?: string[];
}

/** Returns true if the JSON object looks like a Pterodactyl egg. */
export function isPterodactylEgg(data: unknown): data is PtdlEgg {
  if (!data || typeof data !== 'object') return false;
  const obj = data as Record<string, unknown>;
  // Check for PTDL meta version tag
  if (
    obj.meta &&
    typeof obj.meta === 'object' &&
    'version' in obj.meta &&
    typeof (obj.meta as Record<string, unknown>).version === 'string' &&
    ((obj.meta as Record<string, unknown>).version as string).startsWith('PTDL')
  ) {
    return true;
  }
  // Fallback: presence of docker_images + variables with env_variable fields
  if (obj.docker_images && typeof obj.docker_images === 'object' && Array.isArray(obj.variables)) {
    const vars = obj.variables as Record<string, unknown>[];
    return vars.length > 0 && vars.some((v) => 'env_variable' in v);
  }
  return false;
}

/** Infer Catalyst input type from Pterodactyl rules string. */
function inferInputType(rules: string): 'text' | 'number' | 'select' | 'checkbox' {
  if (rules.includes('boolean')) return 'checkbox';
  if (rules.includes('integer') || rules.includes('numeric')) return 'number';
  if (rules.includes('in:')) return 'select';
  return 'text';
}

/** Convert Pterodactyl rules string to Catalyst rules array. */
function convertRules(rules: string): string[] {
  if (!rules) return [];
  const catalystRules: string[] = [];
  const parts = rules.split('|').map((r) => r.trim());
  for (const part of parts) {
    if (part === 'required' || part === 'nullable' || part === 'string' || part === 'boolean') {
      continue; // These are handled via the required/input fields
    }
    if (part.startsWith('in:')) {
      catalystRules.push(part);
    } else if (part.startsWith('between:')) {
      catalystRules.push(part);
    } else if (part.startsWith('max:') || part.startsWith('min:')) {
      catalystRules.push(part);
    } else if (part === 'integer' || part === 'numeric') {
      continue; // Handled by input type
    }
  }
  return catalystRules;
}

/** Convert Pterodactyl startup command variables from $VAR / ${VAR} to {{VAR}} syntax. */
function convertStartupCommand(startup: string): string {
  // Replace ${VAR_NAME} and $VAR_NAME patterns with {{VAR_NAME}}
  // First handle ${VAR} syntax (including nested ${} like ${SERVER_MEMORY})
  let result = startup.replace(/\$\{([A-Z_][A-Z0-9_]*)\}/g, '{{$1}}');
  // Then handle $VAR syntax (only uppercase env var names to avoid false matches)
  result = result.replace(/\$([A-Z_][A-Z0-9_]*)/g, '{{$1}}');
  return result;
}

/** Convert Pterodactyl install script variables similarly. */
function convertInstallScript(script: string): string {
  // Clean up JSON escape sequences and normalize line endings
  let cleaned = script.replace(/\\\//g, '/');
  // Strip Windows-style carriage returns that cause $'\r': command not found
  cleaned = cleaned.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  // Replace ash/sh shebangs with bash (host may not have ash)
  cleaned = cleaned.replace(/^#!\/bin\/ash\b/, '#!/bin/bash');
  cleaned = cleaned.replace(/^#!\/bin\/sh\b/, '#!/bin/bash');
  return cleaned;
}

/** Convert a Pterodactyl egg to a Catalyst-compatible template object. */
export function convertPterodactylEgg(egg: PtdlEgg): Record<string, unknown> {
  // Extract docker images
  const dockerImages = egg.docker_images ?? {};
  const imageEntries = Object.entries(dockerImages);
  const primaryImage = imageEntries.length > 0 ? imageEntries[0][1] : '';

  const images =
    imageEntries.length > 1
      ? imageEntries.map(([label, img]) => ({
          name: label.split('/').pop()?.replace(/:/g, '-') ?? label,
          label,
          image: img,
        }))
      : [];

  // Convert variables
  const variables = (egg.variables ?? []).map((v) => {
    const rules = convertRules(v.rules ?? '');
    const isRequired = (v.rules ?? '').includes('required');
    return {
      name: v.env_variable,
      description: v.description || v.name,
      default: v.default_value ?? '',
      required: isRequired,
      input: inferInputType(v.rules ?? ''),
      ...(rules.length ? { rules } : {}),
    };
  });

  // Convert startup command
  const startup = convertStartupCommand(egg.startup ?? '');

  // Extract stop command from config
  const stopCommand = egg.config?.stop?.replace(/^\//, '') ?? 'stop';

  // Extract install script
  const installScript = egg.scripts?.installation?.script
    ? convertInstallScript(egg.scripts.installation.script)
    : undefined;
  const installImage = egg.scripts?.installation?.container ?? undefined;

  // Build a slug-style ID from the name
  const id = (egg.name ?? 'imported')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');

  // Try to extract a port from variables or startup command
  const portVar = variables.find(
    (v) => v.name === 'SERVER_PORT' || v.name === 'PORT' || v.name === 'GAME_PORT',
  );
  const defaultPort = portVar ? Number(portVar.default) || 25565 : 25565;

  return {
    id,
    name: egg.name ?? 'Imported Egg',
    description: egg.description ?? '',
    author: egg.author ?? 'Imported from Pterodactyl',
    version: '1.0.0',
    image: primaryImage,
    ...(images.length ? { images } : {}),
    defaultImage: primaryImage || undefined,
    installImage,
    startup,
    stopCommand,
    sendSignalTo: 'SIGTERM' as const,
    variables,
    installScript,
    supportedPorts: [defaultPort],
    allocatedMemoryMb: 1024,
    allocatedCpuCores: 2,
    features: {
      restartOnExit: true,
    },
  };
}

/**
 * Auto-detect format and normalize to Catalyst template format.
 * If the input is a Pterodactyl egg, converts it first.
 * Otherwise returns the data as-is (assumed Catalyst format).
 */
export function normalizeTemplateImport(data: unknown): Record<string, unknown> {
  if (isPterodactylEgg(data)) {
    return convertPterodactylEgg(data as PtdlEgg);
  }
  return data as Record<string, unknown>;
}
