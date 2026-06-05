module.exports = {
  name: 'hello_plugin',
  description: 'Says hello from a plugin',
  execute: async (args) => {
    return `Hello from plugin! You said: ${args?.text || 'nothing'}`;
  }
};