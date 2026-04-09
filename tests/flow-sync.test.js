const matter = require('gray-matter');

/**
 * Integration test for graph-to-YAML synchronization logic.
 * This test verifies the parsing and stringification logic used in ChainFlowBuilder.tsx.
 */

function testReorderAgents() {
  console.log('Testing Reorder Agents...');
  
  const initialContent = `---
name: Story Chain
description: A chain for generating stories
agents:
  - world-builder
  - character-designer
  - event-writer
---
# Story Chain Content
This is the body of the chain.
`;

  const { data, content: body } = matter(initialContent);
  const currentAgents = data.agents || [];
  
  // Simulate reordering: move 'event-writer' to the top
  const newAgents = ['event-writer', 'world-builder', 'character-designer'];
  
  const newData = { ...data, agents: newAgents };
  const newContent = matter.stringify(body, newData);
  
  const parsed = matter(newContent);
  
  if (JSON.stringify(parsed.data.agents) === JSON.stringify(newAgents)) {
    console.log('✅ Reorder agents verified successfully');
  } else {
    console.log('Expected:', newAgents);
    console.log('Actual:', parsed.data.agents);
    throw new Error('❌ Reorder agents verification failed');
  }
  
  // Verify body content is preserved
  if (parsed.content.trim() === '# Story Chain Content\nThis is the body of the chain.') {
    console.log('✅ Body content preserved successfully');
  } else {
    console.log('Expected body:', '# Story Chain Content\nThis is the body of the chain.');
    console.log('Actual body:', parsed.content.trim());
    throw new Error('❌ Body content preservation failed');
  }
}

function testAddAgent() {
  console.log('Testing Add Agent...');
  
  const initialContent = `---
name: Story Chain
agents:
  - world-builder
  - event-writer
---
`;

  const { data, content: body } = matter(initialContent);
  const currentAgents = data.agents || [];
  
  // Simulate adding 'character-designer' after 'world-builder'
  const addingAfter = 'world-builder';
  const newSlug = 'character-designer';
  
  const index = currentAgents.indexOf(addingAfter);
  const newAgents = [...currentAgents];
  if (index !== -1) {
    newAgents.splice(index + 1, 0, newSlug);
  } else {
    newAgents.push(newSlug);
  }
  
  const newData = { ...data, agents: newAgents };
  const newContent = matter.stringify(body, newData);
  
  const parsed = matter(newContent);
  const expectedAgents = ['world-builder', 'character-designer', 'event-writer'];
  
  if (JSON.stringify(parsed.data.agents) === JSON.stringify(expectedAgents)) {
    console.log('✅ Add agent verified successfully');
  } else {
    console.log('Expected:', expectedAgents);
    console.log('Actual:', parsed.data.agents);
    throw new Error('❌ Add agent verification failed');
  }
}

function testEmptyAgents() {
  console.log('Testing Empty Agents...');
  
  const initialContent = `---
name: Empty Chain
agents: []
---
`;

  const { data, content: body } = matter(initialContent);
  
  // Simulate adding first agent
  const newSlug = 'world-builder';
  const newAgents = [newSlug];
  
  const newData = { ...data, agents: newAgents };
  const newContent = matter.stringify(body, newData);
  
  const parsed = matter(newContent);
  
  if (JSON.stringify(parsed.data.agents) === JSON.stringify(newAgents)) {
    console.log('✅ Empty agents to first agent verified successfully');
  } else {
    throw new Error('❌ Empty agents verification failed');
  }
}

async function runTests() {
  try {
    console.log('Running Flow Sync Integration Tests...\n');
    testReorderAgents();
    testAddAgent();
    testEmptyAgents();
    console.log('\nAll flow sync tests passed! 🎉');
  } catch (err) {
    console.error('\nTests failed:', err.message);
    process.exit(1);
  }
}

runTests();
