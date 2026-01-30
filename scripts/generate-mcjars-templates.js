#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const https = require('https');
const { spawnSync } = require('child_process');

const OUT_DIR = path.resolve(__dirname, '..', 'templates');
const OVERWRITE = process.argv.includes('--overwrite');

function log(...s) { console.log('[mcjars-generator]', ...s); }

function fetch(url, maxRedirects = 5) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, (res) => {
      // follow redirects
      if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        if (maxRedirects <= 0) return reject(new Error('too many redirects'));
        // resolve relative locations against the original url
        const next = new URL(res.headers.location, url).toString();
        req.destroy();
        return resolve(fetch(next, maxRedirects - 1));
      }

      let body = '';
      res.on('data', (c) => (body += c));
      res.on('end', () => {
        resolve({ status: res.statusCode, body, headers: res.headers });
      });
    });
    req.on('error', reject);
    req.setTimeout(20_000, () => req.destroy(new Error('timeout')));
  });
}

async function tryEndpoints() {
  const endpoints = [
    'https://mcjars.app/api/v1/projects',
    'https://mcjars.app/api/v2/projects',
    'https://mcjars.app/api/projects',
    'https://mcjars.app/api/v1/types',
    'https://mcjars.app/projects.json',
    'https://mcjars.org/api/projects',
    'https://mcjars.org/api/v1/projects',
    'https://mcjars.org/api/v2/projects',
    'https://mcjars.org/projects.json',
  ];

  for (const url of endpoints) {
    try {
      log('Trying', url);
      const res = await fetch(url);
      if (res.status && res.status >= 200 && res.status < 400 && res.body) {
        try {
          const parsed = JSON.parse(res.body);
          if (Array.isArray(parsed)) return parsed;
          // if object with projects key
          if (Array.isArray(parsed.projects)) return parsed.projects;
        } catch (err) {
          // not JSON, continue
        }
      }
    } catch (err) {
      // ignore and try next endpoint
      log('Endpoint failed:', url, err.message || err);
    }
  }
  return null;
}

function safeWrite(filePath, content) {
  if (!OVERWRITE && fs.existsSync(filePath)) {
    log('Skipping existing', filePath);
    return;
  }
  fs.writeFileSync(filePath, content, { encoding: 'utf8' });
  log('Wrote', filePath);
}

function makeTemplateForProject(project) {
  const slug = project.slug || project.id || project.name?.toLowerCase()?.replace(/[^a-z0-9-]/g, '-') || String(project);
  const id = `mcjars-${slug}`;
  const name = project.title || project.name || slug;
  const description = project.description || `Minecraft server for ${name} (MCJARS)`;

  const template = {
    id,
    name: `Minecraft Server (${name})`,
    description,
    author: 'MCJARS',
    version: '1.0.0',
    image: 'eclipse-temurin:21-jre',
    installImage: 'alpine:3.19',
    startup: 'java -Xms{{MEMORY_XMS}}M -Xmx{{MEMORY}}M -jar server.jar nogui',
    stopCommand: 'stop',
    sendSignalTo: 'SIGTERM',
    variables: [
      { name: 'PROJECT', description: 'MCJARS project slug', default: slug, required: true, input: 'text' },
      { name: 'MC_VERSION', description: 'Minecraft version (leave blank for latest)', default: '', required: false, input: 'text' },
      { name: 'MEMORY', description: 'Amount of RAM in MB to allocate to the server', default: '1024', required: true, input: 'number' },
      { name: 'PORT', description: 'Server port (both container and host will use this port)', default: '25565', required: true, input: 'number' },
      { name: 'EULA', description: 'Agree to Minecraft EULA', default: 'true', required: true, input: 'checkbox' }
    ],
    installScript: `#!/bin/sh
set -e

echo '[Catalyst] Installing MCJARS project: {{PROJECT}} (mc version: {{MC_VERSION:-latest}})'

mkdir -p {{SERVER_DIR}}
cd {{SERVER_DIR}}

PROJECT="{{PROJECT}}"
MC_VERSION="{{MC_VERSION}}"

# Try MCJARS JSON API endpoints to resolve a download URL
DOWNLOAD_URL=""

try_api_json() {
  if command -v jq >/dev/null 2>&1; then
    for url in "https://mcjars.org/api/v1/projects/$PROJECT" "https://mcjars.org/api/projects/$PROJECT"; do
      if curl -sS "$url" >/dev/null 2>&1; then
        # try to find a download url for the requested mc version or latest
        candidate=$(curl -sS "$url" | jq -r --arg v "$MC_VERSION" '.releases[$v].download // .releases["latest"].download // .download // empty' 2>/dev/null || true)
        if [ -n "$candidate" ]; then
          DOWNLOAD_URL="$candidate"
          return 0
        fi
      fi
    done
  fi
  return 1
}

try_html_scrape() {
  # fallback: scrape project page for a download link
  page_url="https://mcjars.org/projects/$PROJECT"
  html=$(curl -sS "$page_url" || true)
  if [ -n "$html" ]; then
    # find the first link with "download" in it
    candidate=$(echo "$html" | grep -oE 'href="[^"]*download[^"]*"' | sed -E 's/^href="//' | sed -E 's/"$//' | head -n1)
    if [ -n "$candidate" ]; then
      # convert relative urls
      if echo "$candidate" | grep -qE '^/' ; then
        DOWNLOAD_URL="https://mcjars.org${candidate}"
      else
        DOWNLOAD_URL="$candidate"
      fi
      return 0
    fi
  fi
  return 1
}

if [ -z "$DOWNLOAD_URL" ]; then
  try_api_json || try_html_scrape || true
fi

if [ -z "$DOWNLOAD_URL" ]; then
  echo "[Catalyst] ERROR: Could not find a download URL for project $PROJECT"
  exit 1
fi

# Download jar
if command -v wget >/dev/null 2>&1; then
  wget -q -O server.jar "$DOWNLOAD_URL"
elif command -v curl >/dev/null 2>&1; then
  curl -sL -o server.jar "$DOWNLOAD_URL"
else
  echo '[Catalyst] ERROR: Neither wget nor curl found!'
  exit 1
fi

if [ ! -f server.jar ]; then
  echo "[Catalyst] ERROR: Failed to download server.jar from $DOWNLOAD_URL"
  exit 1
fi

echo '[Catalyst] Downloaded server.jar successfully'

echo '[Catalyst] Accepting Minecraft EULA...'
echo 'eula=true' > eula.txt

# minimal server.properties
cat > server.properties << 'PROPS'
server-port={{PORT}}
max-players=20
PROPS

echo '[Catalyst] Installation complete!'
` ,
    supportedPorts: [25565],
    features: { restartOnExit: true }
  };

  return { slug, template };
}

function makeTemplateForType(typeKey, typeInfo = {}) {
  const slug = typeKey.toLowerCase();
  const name = typeInfo.name || typeKey;
  const description = typeInfo.description || `Minecraft server: ${name}`;
  const template = {
    id: `mcjars-${slug}`,
    name: `Minecraft Server (${name})`,
    description,
    author: 'MCJARS',
    version: '1.0.0',
    image: 'eclipse-temurin:21-jre',
    installImage: 'alpine:3.19',
    startup: 'java -Xms{{MEMORY_XMS}}M -Xmx{{MEMORY}}M -jar server.jar nogui',
    stopCommand: 'stop',
    sendSignalTo: 'SIGTERM',
    variables: [
      { name: 'TYPE', description: 'MCJARS server type', default: typeKey, required: true, input: 'text' },
      { name: 'MC_VERSION', description: 'Minecraft version (leave blank for latest)', default: '', required: false, input: 'text' },
      { name: 'MEMORY', description: 'Amount of RAM in MB to allocate to the server', default: '1024', required: true, input: 'number' },
      { name: 'PORT', description: 'Server port (both container and host will use this port)', default: '25565', required: true, input: 'number' },
      { name: 'EULA', description: 'Agree to Minecraft EULA', default: 'true', required: true, input: 'checkbox' }
    ],
    installScript: `#!/bin/sh
set -e

echo '[Catalyst] Installing MCJARS type: ${typeKey} (mc version: {{MC_VERSION:-latest}})'

mkdir -p {{SERVER_DIR}}
cd {{SERVER_DIR}}

TYPE="${typeKey}"
MC_VERSION="{{MC_VERSION}}"

DOWNLOAD_URL=""

# If MC_VERSION is provided, try type+version endpoint otherwise get latest for type
if [ -n "$MC_VERSION" ]; then
  # example: /api/v1/builds/PAPER/1.20.4/latest
  candidate=$(curl -sS "https://mcjars.app/api/v1/builds/${typeKey}/$MC_VERSION/latest" | jq -r '.jarUrl // .builds[0].jarUrl // empty' 2>/dev/null || true)
  if [ -n "$candidate" ]; then DOWNLOAD_URL="$candidate"; fi
fi

if [ -z "$DOWNLOAD_URL" ]; then
  # fallback to /api/v2/builds/{type} and pick the latest jarUrl
  candidate=$(curl -sS "https://mcjars.app/api/v2/builds/${typeKey}" | jq -r '.builds | map(.jarUrl) | .[0] // empty' 2>/dev/null || true)
  if [ -n "$candidate" ]; then DOWNLOAD_URL="$candidate"; fi
fi

if [ -z "$DOWNLOAD_URL" ]; then
  echo "[Catalyst] ERROR: Could not find a download URL for type ${typeKey}"
  exit 1
fi

# Download jar
if command -v wget >/dev/null 2>&1; then
  wget -q -O server.jar "$DOWNLOAD_URL"
elif command -v curl >/dev/null 2>&1; then
  curl -sL -o server.jar "$DOWNLOAD_URL"
else
  echo '[Catalyst] ERROR: Neither wget nor curl found!'
  exit 1
fi

if [ ! -f server.jar ]; then
  echo "[Catalyst] ERROR: Failed to download server.jar from $DOWNLOAD_URL"
  exit 1
fi

echo '[Catalyst] Downloaded server.jar successfully'

echo '[Catalyst] Accepting Minecraft EULA...'
echo 'eula=true' > eula.txt

cat > server.properties << 'PROPS'
server-port={{PORT}}
max-players=20
PROPS

echo '[Catalyst] Installation complete!'
`,}
    supportedPorts: [25565],
    features: { restartOnExit: true }
  };

  return template;
}

async function main() {
  if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true });

  log('Fetching project list from MCJARS...');
  const projects = await tryEndpoints();

  if (!projects) {
    log('No projects endpoint found — falling back to /api/v1/types to generate templates per server type');
    try {
      const typesRes = await fetch('https://mcjars.app/api/v1/types');
      if (typesRes && typesRes.body) {
        const parsed = JSON.parse(typesRes.body);
        const types = parsed.types || {};
        const keys = Object.keys(types);
        log('Found', keys.length, 'types. Generating templates per type...');
        let created = 0;
        keys.forEach((k) => {
          const t = types[k];
          const slug = k.toLowerCase();
          const template = makeTemplateForType(k, t);
          const filename = path.join(OUT_DIR, `${slug}.json`);
          safeWrite(filename, JSON.stringify(template, null, 2));
          created += 1;
        });
        log('Templates written:', created);
        process.exit(0);
      }
    } catch (err) {
      log('Types fallback failed:', err.message || err);
    }

    log('Failed to fetch projects from endpoints. You can run this script locally where network access is available.');
    process.exit(1);
  }

  log('Found', projects.length, 'projects. Generating templates...');
  let created = 0;
  projects.forEach((p) => {
    const { slug, template } = makeTemplateForProject(p);
    const filename = path.join(OUT_DIR, `${slug}.json`);
    safeWrite(filename, JSON.stringify(template, null, 2));
    created += 1;
  });
  log('Templates written:', created);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
