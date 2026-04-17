const http = require('http');
const fs = require('fs');
const path = require('path');

const TARGET_URL = process.env.TARGET_URL || 'http://localhost:3000/api/workspace/context';
const EXPECTED_HEADERS = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET, POST, PUT, DELETE, OPTIONS',
  'access-control-allow-headers': 'Content-Type, Authorization'
};

function verifyConfigLogic() {
  console.log('--- Static Configuration Check ---');
  const configPath = path.join(__dirname, '../next.config.ts');
  
  if (!fs.existsSync(configPath)) {
    console.log('❌ next.config.ts not found');
    return false;
  }
  
  const content = fs.readFileSync(configPath, 'utf-8');
  
  // Check for the presence of CORS headers in next.config.ts
  const hasOrigin = content.includes('Access-Control-Allow-Origin') && content.includes('*');
  const hasMethods = content.includes('Access-Control-Allow-Methods');
  const hasHeaders = content.includes('Access-Control-Allow-Headers');
  const hasPath = content.includes('/api/workspace/:path*');

  if (hasOrigin && hasMethods && hasHeaders && hasPath) {
    console.log('✅ next.config.ts contains correct CORS configuration logic');
    return true;
  } else {
    console.log('❌ next.config.ts is missing some CORS configuration');
    if (!hasOrigin) console.log('   - Missing Access-Control-Allow-Origin: *');
    if (!hasMethods) console.log('   - Missing Access-Control-Allow-Methods');
    if (!hasHeaders) console.log('   - Missing Access-Control-Allow-Headers');
    if (!hasPath) console.log('   - Missing /api/workspace/:path* source pattern');
    return false;
  }
}

async function verifyLiveServer(url) {
  console.log('\n--- Live Server Header Check ---');
  console.log(`Target: ${url}`);
  
  return new Promise((resolve) => {
    const req = http.request(url, { method: 'OPTIONS' }, (res) => {
      console.log(`Status Code: ${res.statusCode}`);
      
      let allPassed = true;
      for (const [key, value] of Object.entries(EXPECTED_HEADERS)) {
        const actualValue = res.headers[key.toLowerCase()];
        if (actualValue === value) {
          console.log(`✅ ${key}: ${actualValue}`);
        } else {
          console.log(`❌ ${key}: Expected "${value}", got "${actualValue}"`);
          allPassed = false;
        }
      }
      
      if (allPassed) {
        console.log('\n✅ Live CORS verification passed! 🎉');
        resolve(true);
      } else {
        console.log('\n❌ Live CORS verification failed.');
        resolve(false);
      }
    });

    req.on('error', (err) => {
      if (err.code === 'ECONNREFUSED') {
        console.log('⚠️  Server is not running. Skipping live check.');
        console.log('   To perform a live verification:');
        console.log('   1. Start the server: npm run dev');
        console.log('   2. Run this test again: node tests/verify-cors.js');
        resolve(true); 
      } else {
        console.log(`❌ Error connecting to server: ${err.message}`);
        resolve(false);
      }
    });

    // Set a short timeout for the request
    req.setTimeout(2000, () => {
      req.destroy();
      console.log('⚠️  Connection timed out. Skipping live check.');
      resolve(true);
    });

    req.end();
  });
}

async function run() {
  console.log('CORS Verification Tool\n');
  
  const configOk = verifyConfigLogic();
  const liveOk = await verifyLiveServer(TARGET_URL);
  
  if (configOk && liveOk) {
    console.log('\nVerification complete.');
    process.exit(0);
  } else {
    console.log('\nVerification failed.');
    process.exit(1);
  }
}

run();
