const yaml = require('js-yaml');
const str = "---\nname: Test Agent\nmodel: gpt-4\n---\n\n";
try {
  const docs = yaml.loadAll(str);
  console.log('Loaded docs:', docs);
} catch (e) {
  console.error('Error:', e.message);
}
