#!/usr/bin/env npx tsx
import * as fs from 'fs';

async function main() {
  // Read the template JSON file
  const templateData = JSON.parse(
    fs.readFileSync('../templates/minecraft-paper.json', 'utf-8')
  );

  // API base URL (adjust if needed)
  const API_BASE = process.env.API_URL || 'http://localhost:3000/api';

  // First, try to get authentication token
  // For testing, we'll try to login as admin
  console.log('Logging in...');
  const loginResponse = await fetch(`${API_BASE}/auth/login`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      email: 'admin@example.com',
      password: 'admin123',
    }),
  });

  if (!loginResponse.ok) {
    console.error('Login failed:', await loginResponse.text());
    process.exit(1);
  }

  const loginResult = await loginResponse.json();
  const token = loginResult.data?.token || loginResult.token;
  
  if (!token) {
    console.error('No token in response:', loginResult);
    process.exit(1);
  }
  
  console.log('✓ Logged in successfully');

  // Check if template already exists
  console.log('\nChecking for existing template...');
  const listResponse = await fetch(`${API_BASE}/templates`, {
    headers: {
      'Authorization': `Bearer ${token}`,
    },
  });

  const { data: templates } = await listResponse.json();
  const existing = templates.find((t: any) => 
    t.name === templateData.name || 
    t.id === templateData.id
  );

  // Prepare the payload (remove the 'id' field as it's auto-generated or used in URL)
  const { id: templateId, ...payload } = templateData;

  if (existing) {
    console.log(`✓ Found existing template: ${existing.id}`);
    console.log('\nUpdating template...');
    
    const updateResponse = await fetch(`${API_BASE}/templates/${existing.id}`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
      },
      body: JSON.stringify(payload),
    });

    if (!updateResponse.ok) {
      console.error('Update failed:', await updateResponse.text());
      process.exit(1);
    }

    const result = await updateResponse.json();
    console.log('✓ Template updated successfully!');
    console.log('\nUpdated template:');
    console.log(`  ID: ${result.data.id}`);
    console.log(`  Name: ${result.data.name}`);
    console.log(`  Image: ${result.data.image}`);
    console.log(`  Version: ${result.data.version}`);
  } else {
    console.log('✗ Template not found, creating new one...');
    
    const createResponse = await fetch(`${API_BASE}/templates`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
      },
      body: JSON.stringify(payload),
    });

    if (!createResponse.ok) {
      console.error('Create failed:', await createResponse.text());
      process.exit(1);
    }

    const result = await createResponse.json();
    console.log('✓ Template created successfully!');
    console.log('\nNew template:');
    console.log(`  ID: ${result.data.id}`);
    console.log(`  Name: ${result.data.name}`);
    console.log(`  Image: ${result.data.image}`);
    console.log(`  Version: ${result.data.version}`);
  }
}

main().catch((error) => {
  console.error('Error:', error.message);
  process.exit(1);
});
