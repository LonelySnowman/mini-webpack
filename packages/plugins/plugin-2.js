class Plugin2 {
  apply(compiler) {
    compiler.hooks.done.tap('Plugin2', () => {
      console.log('Plugin2 Done');
    });
  }
}

module.exports = Plugin2;
