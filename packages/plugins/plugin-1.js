class Plugin1 {
  apply(compiler) {
    compiler.hooks.run.tap('Plugin1', () => {
      console.log('Plugin1 Start');
    });
  }
}

module.exports = Plugin1;
