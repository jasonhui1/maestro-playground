import { test } from 'vitest';
import { parseTabs, serializeTabs } from '../lib/fs/tabs';
import { WorkspaceTab } from '../lib/types';

function assert(condition: boolean, message: string) {
  if (!condition) {
    throw new Error(message);
  }
}

function testParseTabs() {
  console.log('Testing parseTabs...');

  // Case 1: Empty tabsParam, with active tab
  const tabs1 = parseTabs(null, 'agent', 'dm');
  assert(tabs1.length === 1, 'Should have 1 tab');
  assert(tabs1[0].type === 'agent', 'Type should be agent');
  assert(tabs1[0].slug === 'dm', 'Slug should be dm');
  assert(tabs1[0].active === true, 'Should be active');

  // Case 2: tabsParam with multiple tabs, active tab in list
  const tabs2 = parseTabs('agent:dm,chain:story', 'chain', 'story');
  assert(tabs2.length === 2, 'Should have 2 tabs');
  assert(tabs2[0].type === 'agent' && tabs2[0].slug === 'dm', 'First tab mismatch');
  assert(tabs2[0].active === false, 'First tab should not be active');
  assert(tabs2[1].type === 'chain' && tabs2[1].slug === 'story', 'Second tab mismatch');
  assert(tabs2[1].active === true, 'Second tab should be active');

  // Case 3: tabsParam with multiple tabs, active tab NOT in list
  const tabs3 = parseTabs('agent:dm', 'chain', 'story');
  assert(tabs3.length === 2, 'Should have 2 tabs');
  assert(tabs3.some(t => t.type === 'chain' && t.slug === 'story' && t.active), 'Active tab should be added');

  // Case 4: Invalid tabsParam
  const tabs4 = parseTabs('invalid', 'agent', 'dm');
  assert(tabs4.length === 1, 'Should only have the active tab');
  assert(tabs4[0].type === 'agent' && tabs4[0].slug === 'dm', 'Active tab mismatch');

}

function testSerializeTabs() {
  console.log('Testing serializeTabs...');

  const tabs: WorkspaceTab[] = [
    { type: 'agent', slug: 'dm', active: false },
    { type: 'chain', slug: 'story', active: true }
  ];

  const serialized = serializeTabs(tabs);
  assert(serialized === 'agent:dm,chain:story', `Serialization mismatch: ${serialized}`);

}

function runTests() {
  testParseTabs();
  testSerializeTabs();
}

test('workspace-tabs', runTests);
