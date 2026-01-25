#!/usr/bin/env node
// Simple WebSocket client for sending server control commands

const token = process.argv[2];
const serverId = process.argv[3];

if (!token || !serverId) {
    console.error('Usage: ws-client.js <token> <serverId>');
    process.exit(1);
}

// Try to load ws module from global location
let WebSocket;
try {
    WebSocket = require('ws');
} catch (e) {
    // Try loading from global node_modules
    try {
        const globalPath = require('child_process').execSync('npm root -g').toString().trim();
        WebSocket = require(`${globalPath}/ws`);
    } catch (e2) {
        console.error('Error: ws module not found. Install with: npm install -g ws');
        process.exit(1);
    }
}

const ws = new WebSocket(`ws://localhost:3000/ws?token=${token}`);

ws.on('open', () => {
    console.log('✓ WebSocket connected');
    
    const startCmd = {
        type: 'server_control',
        action: 'start',
        serverId: serverId
    };
    
    console.log(`✓ Sending start command for server: ${serverId}`);
    ws.send(JSON.stringify(startCmd));
    
    // Wait for responses
    setTimeout(() => {
        console.log('✓ Closing WebSocket connection');
        ws.close();
        process.exit(0);
    }, 5000);
});

ws.on('message', (data) => {
    console.log('← Received:', data.toString());
});

ws.on('error', (err) => {
    console.error('✗ WebSocket error:', err.message);
    process.exit(1);
});

ws.on('close', () => {
    console.log('✓ WebSocket closed');
});
