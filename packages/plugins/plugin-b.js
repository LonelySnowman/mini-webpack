// plugin-b.js
class PluginB {
  apply(compiler) {
    compiler.hooks.done.tap('Plugin B', () => {
      console.log('PluginB Done');
    });
  }
}

module.exports = PluginB;
