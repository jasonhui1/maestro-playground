const yaml = require('js-yaml');

function validateYaml(raw) {
  try {
    yaml.load(raw);
    return { valid: true };
  } catch (err) {
    return { valid: false, error: err.message };
  }
}

// Test cases
const validYaml = 'name: test\nvalue: 123';
const invalidYaml = 'name: test\nvalue: : invalid';

console.log('Testing valid YAML:');
console.log(validateYaml(validYaml));

console.log('\nTesting invalid YAML:');
console.log(validateYaml(invalidYaml));
