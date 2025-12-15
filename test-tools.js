// Test script for Phase 3 implementation
// Run with: node test-tools.js

require('dotenv').config();

const { AgentService } = require('./dist/main/AgentService');
const path = require('path');
const os = require('os');

async function testTools() {
  console.log('Testing Phase 3 AugOS Tools Implementation...\n');
  
  try {
    // Initialize AgentService
    const agentService = new AgentService();
    
    // Wait a bit for initialization
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    console.log('1. Testing System Info Tool:');
    console.log('---------------------------');
    
    await agentService.ask('What is the system information?', (token) => {
      process.stdout.write(token);
    });
    
    console.log('\n\n2. Testing File Tool - List Directory:');
    console.log('---------------------------------------');
    
    await agentService.ask(`List the contents of the directory: ${os.homedir()}`, (token) => {
      process.stdout.write(token);
    });
    
    console.log('\n\n3. Testing File Tool - Read File:');
    console.log('----------------------------------');
    
    await agentService.ask(`Read the package.json file at: ${path.join(process.cwd(), 'package.json')}`, (token) => {
      process.stdout.write(token);
    });
    
    console.log('\n\n4. Testing Security - Blocked Path:');
    console.log('------------------------------------');
    
    await agentService.ask('List the contents of C:\\Windows', (token) => {
      process.stdout.write(token);
    });
    
    console.log('\n\n✅ All tests completed!');
    
  } catch (error) {
    console.error('Test failed:', error);
  }
}

// Check if built version exists
const fs = require('fs');
if (!fs.existsSync('./dist/main/AgentService.js')) {
  console.log('Please build the project first: npm run build:electron');
  process.exit(1);
}

testTools().catch(err =>{
  console.error('Test suite failed:', err);
  process.exit(1);
});
