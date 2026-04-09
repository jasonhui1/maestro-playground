const { parseAgent } = require('./lib/fs/parseAgent');
const path = require('path');

const agentPath = path.join(__dirname, 'workspace/agents/token-test.md');
const agent = parseAgent(agentPath);

console.log('Agent Name:', agent.name);
console.log('Max Tokens:', agent.max_tokens);

if (agent.max_tokens === 50) {
  console.log('SUCCESS: max_tokens parsed correctly.');
} else {
  console.log('FAILURE: max_tokens not parsed correctly.');
  process.exit(1);
}
