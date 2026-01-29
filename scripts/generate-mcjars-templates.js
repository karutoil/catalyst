#!/usr/bin/env node
/*
 * Generates template JSON files for MCJARS projects into the templates/ folder.
 * Usage: node scripts/generate-mcjars-templates.js [--overwrite]
 */
const https = require('https');
const fs = require('fs');
const path = require('path');

const OUT_DIR = path.join(__dirname, '..', 'templates');
const OVERWRITE = process.argv.includes('--overwrite');

function fetchJson(url) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { 'User-Agent': 'catalyst-generator' } }, (res) => {
      let data = '';
      res.on('data', (chunk) => data += chunk);
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          resolve(json);
        } catch (err) {
          reject(new Error('Failed to parse JSON from ' + url + ': ' + err.message));
        }
      });
    }).on('error', reject);
  });
}

async function getProjects() {
  // Prefer official mcjars.app API endpoints per documentation
  const candidates = [
    'https://mcjars.app/api/v2/types',
    'https://mcjars.app/api/v2/lookups/types',
    'https://mcjars.app/api/v1/types',
    'https://mcjars.app/api/v2/lookups/types'
  ];

  for (const url of candidates) {
    try {
      const data = await fetchJson(url);
      // If API returns an object with a `types` field, extract project keys
      if (data && typeof data === 'object') {
        if (Array.isArray(data)) return data;
        if (Array.isArray(data.projects)) return data.projects;
        if (data.types && typeof data.types === 'object') {
          const types = data.types;
          const projects = [];
          const seen = new Set();
          for (const categoryKey of Object.keys(types)) {
            const category = types[categoryKey];
            if (!category || typeof category !== 'object') continue;
            for (const key of Object.keys(category)) {
              const entry = category[key];
              // key is the identifier (e.g., PAPER, SPIGOT)
              const slug = (entry && entry.name) ? entry.name : key;
              const normalizedSlug = String(slug).toLowerCase().replace(/\s+/g, '-');
              if (seen.has(normalizedSlug)) continue;
              seen.add(normalizedSlug);
              projects.push({ slug: normalizedSlug, name: (entry && entry.name) || key, meta: entry });
            }
          }
          if (projects.length) return projects;
        }
      }
    } catch (err) {
      // try next endpoint
    }
  }
  throw new Error('Unable to fetch project list from MCJARS API — check network access or the API URL (https://mcjars.app/api).');
}

function slugToFilename(slug) {
  return 'minecraft-' + slug.replace(/[^a-z0-9-_]/gi, '-').toLowerCase() + '.json';
}

function makeTemplate(project) {
  const slug = (project.slug || project.id || project.name || String(project)).toString();
  const displayName = project.name || slug;
  return {
    id: `minecraft-${slug}`,
    name: `Minecraft Server (${displayName})`,
    description: `${displayName} server (downloaded via MCJARS latest build)` ,
    author: 'Catalyst Maintainers',
    version: '1.0.0',
    image: 'eclipse-temurin:21-jre',
    installImage: 'alpine:3.19',
    startup: 'java -Xms{{MEMORY_XMS}}M -Xmx{{MEMORY}}M -jar server.jar nogui',
    stopCommand: 'stop',
    sendSignalTo: 'SIGTERM',
    variables: [
      { name: 'MC_VERSION', description: 'Minecraft version (choose version)', default: '1.20.4', required: true, input: 'text' },
      { name: 'PROJECT', description: 'MCJARS project identifier', default: slug, required: true, input: 'text' },
      { name: 'DOWNLOAD_URL', description: 'Optional direct download URL (overrides MCJARS API)', default: '', required: false, input: 'text' },
      { name: 'MEMORY', description: 'Amount of RAM in MB to allocate to the server', default: '2048', required: true, input: 'number', rules: ['between:512,65536'] },
      { name: 'MEMORY_PERCENT', description: 'Percent of allocated memory to give the JVM', default: '75', required: false, input: 'number', rules: ['between:50,95'] },
      { name: 'MEMORY_XMS', description: 'Xms in MB (overrides percent) - leave blank to use percent', default: '', required: false, input: 'number' },
      { name: 'PORT', description: 'Server port (container & host)', default: '25565', required: true, input: 'number', rules: ['between:1024,65535'] },
      { name: 'EULA', description: 'Agree to Minecraft EULA', default: 'true', required: true, input: 'checkbox' }
    ],
    installScript: "#!/bin/sh\nset -e\n\necho '[Catalyst] Starting installation...'\nmkdir -p {{SERVER_DIR}}\ncd {{SERVER_DIR}}\n\nPROJECT={{PROJECT}}\nMC_VERSION={{MC_VERSION}}\nif [ -n \"{{DOWNLOAD_URL}}\" ] && [ \"{{DOWNLOAD_URL}}\" != \"\" ]; then\n  URL=\"{{DOWNLOAD_URL}}\"\nelse\n  URL1=\"https://mcjars.org/api/v1/projects/${PROJECT}/versions/${MC_VERSION}/builds/latest/download\"\n  URL2=\"https://api.mcjars.org/projects/${PROJECT}/versions/${MC_VERSION}/builds/latest/download\"\n  URL=\"$URL1\"\nfi\n\necho '[Catalyst] Downloading server jar from:' $URL\nif command -v wget >/dev/null 2>&1; then\n  wget -q -O server.jar \"$URL\" || ( [ -n \"$URL2\" ] && wget -q -O server.jar \"$URL2\" )\nelse\n  curl -sL -o server.jar \"$URL\" || ( [ -n \"$URL2\" ] && curl -sL -o server.jar \"$URL2\" )\nfi\n\nif [ ! -f server.jar ]; then\n  echo '[Catalyst] ERROR: Failed to download server.jar. Set DOWNLOAD_URL to a direct download.'\n  exit 1\nfi\n\necho '[Catalyst] Download complete'\n\n# Accept EULA\necho 'eula=true' > eula.txt\n\n# Basic server.properties\ncat > server.properties << 'PROPS'\nserver-port={{PORT}}\nPROPS\n\necho '[Catalyst] Installation complete'\n",
    supportedPorts: [25565],
    allocatedMemoryMb: 2048,
    allocatedCpuCores: 2,
    features: { restartOnExit: true }
  };
}

async function main() {
  try {
    if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true });
    console.log('Fetching project list from MCJARS...');
    const projects = await getProjects();
    console.log('Found', projects.length, 'projects. Generating templates...');
    let created = 0;
    for (const p of projects) {
      const slug = (p.slug || p.id || p.name || String(p)).toString();
      const filename = slugToFilename(slug);
      const filepath = path.join(OUT_DIR, filename);
      if (fs.existsSync(filepath) && !OVERWRITE) {
        console.log('Skipping existing:', filename);
        continue;
      }
      const tpl = makeTemplate(p);
      fs.writeFileSync(filepath, JSON.stringify(tpl, null, 2) + '\n', 'utf8');
      created++;
    }
    console.log('Templates written:', created);
    console.log('Done. Review the generated files in templates/ and run with --overwrite to regenerate.');
  } catch (err) {
    console.error('Error:', err.message);
    process.exit(1);
  }
}

main();
