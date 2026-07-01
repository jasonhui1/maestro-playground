const matter = require('gray-matter');
const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');

function validateYaml(raw) {
  try {
    yaml.load(raw);
    return { valid: true };
  } catch (err) {
    return { valid: false, error: err.message };
  }
}

function saveWorkspaceEntity({ type, slug, data, content, workspacePath }) {
  // Simulate sanitizeSlug
  const cleanSlug = path.basename(slug).replace(/[^a-z0-9_-]/gi, '');

  // Simulate validateEntityPath
  const subDir = type === 'agent' ? 'agents' : type === 'skill' ? 'skills' : type === 'chain' ? 'chains' : '';
  if (!subDir) throw new Error('Invalid type');

  // Validate frontmatter data
  const frontmatterString = yaml.dump(data);
  console.log('Frontmatter string:', JSON.stringify(frontmatterString));
  const validation = validateYaml(frontmatterString);
  if (!validation.valid) {
    throw new Error(`Invalid YAML frontmatter: ${validation.error}`);
  }

  const filePath = path.join(workspacePath, subDir, `${cleanSlug}.md`);
  const fileContent = matter.stringify(content, data);

  // In this test, we'll just return the content instead of writing to disk
  return { filePath, slug: cleanSlug, fileContent };
}

const workspacePath = path.join(__dirname, 'workspace');
const testData = {
  type: 'agent',
  slug: 'test-agent',
  data: { name: 'Test Agent', model: 'gpt-4' },
  content: 'Hello world',
  workspacePath
};

console.log('Testing save logic with valid data:');
try {
  const result = saveWorkspaceEntity(testData);
  console.log(result);
} catch (err) {
  console.error(err.message);
}

console.log('\nTesting save logic with invalid YAML data:');
try {
  // This is tricky because matter.stringify usually produces valid YAML from an object.
  // But if we pass something that can't be stringified...
  const invalidData = { ...testData, data: { name: 'Test', invalid: { [Symbol('test')]: 'test' } } };
  saveWorkspaceEntity(invalidData);
} catch (err) {
  console.log('Caught expected error:', err.message);
}
