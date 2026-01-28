const fs = require('fs');
const path = require('path');

// Read the auth.ts file
const authPath = path.join(__dirname, 'catalyst-backend/src/routes/auth.ts');
const source = fs.readFileSync(authPath, 'utf8');

// Helper functions from generate-api-docs.sh

const parseTypeLiteral = (literal) => {
  const fields = [];
  const fieldRegex = /([A-Za-z0-9_]+)\s*(\?)?\s*:\s*([^;\n,}]+)/g;
  let match;
  while ((match = fieldRegex.exec(literal)) !== null) {
    fields.push({
      name: match[1],
      optional: Boolean(match[2]),
      type: match[3].trim(),
    });
  }
  return fields;
};

const parseDestructuredNames = (chunk, kind) => {
  const names = [];
  const regex = new RegExp(`const\\s+\\{([^}]+)\\}\\s*=\\s*request\\.${kind}\\s+as`, 'g');
  let match;
  while ((match = regex.exec(chunk)) !== null) {
    const content = match[1];
    content.split(',').forEach((raw) => {
      const cleaned = raw.trim();
      if (!cleaned) return;
      const name = cleaned.split(/[:=]/)[0].trim();
      if (name) names.push(name);
    });
  }
  return names;
};

const extractFields = (chunk, kind) => {
  const results = [];
  const typeLiteralRegex = new RegExp(`request\\.${kind}\\s+as\\s+\\{([\\s\\S]*?)\\}`, 'g');
  let match;
  while ((match = typeLiteralRegex.exec(chunk)) !== null) {
    results.push(...parseTypeLiteral(match[1]));
  }
  const typeNames = new Set(results.map((field) => field.name));
  const destructured = parseDestructuredNames(chunk, kind);
  destructured.forEach((name) => {
    if (!typeNames.has(name)) {
      results.push({ name, optional: true, type: 'unknown' });
    }
  });
  return results;
};

const collectRouteChunks = (content) => {
  const regex = /app\.(get|post|put|patch|delete)\(\s*(['"`])([^'"`]+)\2/g;
  const matches = Array.from(content.matchAll(regex));
  return matches.map((match, index) => {
    const start = match.index || 0;
    const end = index + 1 < matches.length ? (matches[index + 1].index || content.length) : content.length;
    return {
      method: match[1],
      path: match[3],
      chunk: content.slice(start, end),
    };
  });
};

// Extract routes
const chunks = collectRouteChunks(source);

// Find the login route (POST /login)
const loginRoute = chunks.find(c => c.method === 'post' && c.path === '/login');

if (!loginRoute) {
  console.error('Could not find POST /login route');
  process.exit(1);
}

console.log('='.repeat(60));
console.log('POST /api/auth/login - Inferred Fields');
console.log('='.repeat(60));
console.log();

// Extract fields
const fields = {
  params: extractFields(loginRoute.chunk, 'params'),
  query: extractFields(loginRoute.chunk, 'query'),
  body: extractFields(loginRoute.chunk, 'body'),
};

// Print results
console.log('Route Path: /login');
console.log('Route Method: POST');
console.log();

if (fields.params.length) {
  console.log('Params:');
  fields.params.forEach((field) => {
    console.log(`  - ${field.name}${field.optional ? '?' : ''}: ${field.type}`);
  });
} else {
  console.log('Params: (none)');
}

console.log();

if (fields.query.length) {
  console.log('Query:');
  fields.query.forEach((field) => {
    console.log(`  - ${field.name}${field.optional ? '?' : ''}: ${field.type}`);
  });
} else {
  console.log('Query: (none)');
}

console.log();

if (fields.body.length) {
  console.log('Body:');
  fields.body.forEach((field) => {
    console.log(`  - ${field.name}${field.optional ? '?' : ''}: ${field.type}`);
  });
} else {
  console.log('Body: (none)');
}

console.log();
console.log('='.repeat(60));
console.log('Raw Chunk Analysis:');
console.log('='.repeat(60));
console.log();
console.log('Route chunk (first 500 chars):');
console.log(loginRoute.chunk.substring(0, 500));
console.log('...');
