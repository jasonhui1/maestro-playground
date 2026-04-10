const matter = require('gray-matter');
const content = 'Hello world';
const data = {};
const result = matter.stringify(content, data);
console.log('Result with empty data:');
console.log(JSON.stringify(result));
console.log(result);

const data2 = { name: 'test' };
const result2 = matter.stringify(content, data2);
console.log('Result with data:');
console.log(JSON.stringify(result2));
console.log(result2);
