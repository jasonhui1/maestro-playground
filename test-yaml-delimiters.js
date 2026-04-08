const yaml = require('js-yaml');
const str = "---\nname: Test Agent\nmodel: gpt-4\n---\n\n";
try {
  const doc = yaml.load(str);
  console.log('Loaded:', doc);
} catch (e) {
  console.error('Error:', e.message);
}
