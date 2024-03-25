const Compiler = require('./compiler')

function webpack(options) {
  // 合并参数 得到合并后的参数 mergedOptions
  const mergedOptions = mergeOptions(options);

  // 创建compiler对象
  const compiler = new Compiler(mergedOptions)

  // 加载插件
  loadPlugin(options.plugins, compiler);

  return compiler
}

// 合并参数
function mergeOptions(options) {
  const shellOptions = process.argv.slice(2).reduce((option, argv) => {
    // 根据 = 分割
    const [key, value] = argv.split('=')
    if (key && value) {
      // 去除 key 前面的 --
      const parseKey = key.slice(2)
      option[parseKey] = value
    }
    return option;
  }, {})
  return { ...options, ...shellOptions }
}

// 加载插件函数
function loadPlugin(plugins, compiler) {
  if (plugins && Array.isArray(plugins)) {
    plugins.forEach((plugin) => {
      // webpack 插件都是一个类 需要有 apply 方法
      plugin.apply(compiler);
    });
  }
}

module.exports = webpack;
