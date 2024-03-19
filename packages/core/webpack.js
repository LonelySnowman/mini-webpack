const Compiler = require('./compiler')
// webpack.js
function webpack(options) {
  // 合并参数 得到合并后的参数 mergeOptions
  const mergeOptions = _mergeOptions(options);

  // 创建compiler对象
  const compiler = new Compiler(mergeOptions)

  // 加载插件
  _loadPlugin(options.plugins, compiler);

  return compiler
}

// 合并参数
function _mergeOptions(options) {
  const shellOptions = process.argv.slice(2).reduce((option, argv) => {
    // argv -> --mode=production
    const [key, value] = argv.split('=');
    if (key && value) {
      const parseKey = key.slice(2); // 去除--
      option[parseKey] = value;
    }
    return option;
  }, {});
  return { ...options, ...shellOptions };
}

// 加载插件函数
function _loadPlugin(plugins, compiler) {
  if (plugins && Array.isArray(plugins)) {
    plugins.forEach((plugin) => {
      // webpack 插件都是一个类 需要有 apply 方法
      plugin.apply(compiler);
    });
  }
}

module.exports = webpack;