# 【Wbpack原理】基础流程解析，实现 mini-webpack

⛄：webpack 对前端同学来说并不陌生，它是我们学习前端工程化的第一站，在最开始的 ` vue-cli ` 中我们就可以发现它的身影。我们的 `vue/react` 项目是如何打包成 `js` 文件并在浏览器中运行的呢？这篇文章将会帮助你由浅入深理解 `webpack` 原理，了解其中的 `loader/plugin` 机制，熟悉 `webpack` 打包流程。实现简易 `webpack` 核心代码，`run-loader` 模块，示例 `loader` 与 `plugin`。

本质上，**webpack** 是一个用于现代 JavaScript 应用程序的 *静态模块打包工具*。当 `webpack` 处理应用程序时，它会在内部从一个或多个入口点构建一个**依赖图(dependency graph)**，然后将你项目中所需的每一个模块组合成一个或多个 *bundles*，它们均为静态资源，用于展示你的内容。

## 基础流程解析

webpack 打包流程可大致分为以下四部分。

> compiler 对象记录着构建过程中 webpack 环境与配置信息，整个 webpack 从开始到结束的生命周期。

1. 初始化准备：
   - `webpack` 会读取 `webpack.config.js` 文件中的参数，并将 `shell` 命令中的参数合并形成最终参数。
   - 然后 `webpack` 根据最终参数初始化 `compiler` 对象，注册配置中的插件，执行 `compiler.run()` 开始编译。
2. 模块编译：
   - 从打包入口开始，调用匹配文件的 `loader` 对文件进行处理，并分析模块间的依赖关系，递归对模块进行编译。
3. 模块生成：
   - 模块递归编译结束后，得到模块之间的相互依赖关系。
4. 输出文件：
   - 根据模块间的依赖关系及配置文件，将处理后的模块输出到 `output` 的目录下。

## 目录结构

```

```

>  使用 pnpm-workspace 构建一个 monorepo 仓库

```yaml
# pnpm-workspace.yaml
packages:
  - 'packages/*'
```

新建打包案例

## 初始化准备阶段

### `webpack cli` 运行入口

打包打包时 `webpack` 会读取 `webpack.config.js` 的配置并与 `shell` 中的参数合并，生成 `compiler` 对象并调用 `compiler.run()` 方法进行打包。

我们新建 `index.js` 作为 `webpack` 运行的入口。 

```js
// packages/core/index.js
// 调用 webpack(config) 初始化 compiler 对象
const webpack = require('webpack');
const config = require('../example/webpack.config');

// webpack() 方法会返回一个 compiler 对象
const compiler = webpack(config);

// 调用 run 方法进行打包
compiler.run((err, stats) => {
  if (err) {
    console.log(err, 'err');
  }
});
```

新建 `webpack.js` 去读取参数并返回 `compiler` 对象。

```js
// packages/core/webpack.js
const Compiler = require('./compiler')

function webpack(options) {
  // 初始化参数根据配置文件和 shell 参数得到合并后的参数
  const mergedOptions = mergeOptions(options);
  // 创建compiler对象
  const compiler = new Compiler(mergedOptions)
  return compiler
}

module.exports = webpack;
```

补充 `mergeOptions` 方法。

- 在运行 `webpack` 命令时我们可以使用 `--mode=production` 去覆盖 `webpack.config.js` 的参数

```js
// packages/core/webpack.js
// webpack --mode=production
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
  // 用 shellOptions 覆盖配置文件的 options
  return { ...options, ...shellOptions }
}
```

### 实现 compiler 对象

新建 `compiler.js` 文件，实现 `compiler` 对象核心逻辑。

compiler 对象记录着构建过程中 webpack 环境与配置信息，整个 webpack 从开始到结束的生命周期。我们需要实现 `plugin` 插件机制与 `loader` 机制。下面是 `compiler` 对象的基础骨架。 

```js
// packages/core/compiler.js
class Compiler {
  constructor(options) {
    this.options = options;
  }
  // 实现 run 方法开始编译
  run(callback) {
  }
}

module.exports = Compiler
```

### 实现基础插件钩子

插件是 webpack 生态的关键部分， 它为我们提供了一种强有力的方式来直接触及 webpack 的编译过程(compilation process)。 插件能够 [hook](https://www.webpackjs.com/api/compiler-hooks/#hooks) 到每一个编译(compilation)中发出的关键事件中。 在编译的每个阶段中，插件都拥有对 `compiler` 对象的完全访问能力， 并且在合适的时机，还可以访问当前的 `compilation` 对象。

compilation 对象记录编译模块的信息，只要项目文件有改动，compilation 就会被重新创建。

`webpack` 插件可以简单理解为可以在 `wepack` 整个生命周期中触发的钩子，类似与 `vue` 中的 `created`，`mounted` 等生命周期。

> 这里简单讲解以下，后续有单独的章节详细讲解 plugin

我们实现一个简易的 `webpack` 插件，`packages/plugins/plugin-test.js`，插件就是一个 `javascript` 类，需要实现 `apply` 方法供 `webpack` 调用，`webpack` 会在 `compiler` 及 `compilation` 对象上预设一系列钩子供我们调用。 

```js
// 这个插件的作用就是在 webpack 开始编译前输出 PluginTest Start
class PluginTest {
    // webpack 会调用 apply 函数并传入 compiler 对象
    apply(compiler) {
        // 在 compiler 对象上的 run hooks 下注册同步钩子
        compiler.hooks.run.tap('Plugin Test', () => {
            console.log('PluginTest Start');
        });
    }
}

module.exports = PluginTest;
```

接下来我们在 `compiler` 实现一些基本的钩子，`webpack` 的插件借助 `tapable` 这个库去实现，我们可以使用 `new SyncHook()` 去初始化一个钩子对象，放在 `compiler.hooks` 下。

```js
const { SyncHook } = require('tapable')

class Compiler {
  constructor(options) {
    // ...
    // 创建 plugin hooks
    this.hooks = {
      // 开始编译时的钩子
      run: new SyncHook(), // new AsyncSeriesHook(["compiler"])
      // 输出 asset 到 output 目录之前执行的钩子
      emit: new SyncHook(), // new AsyncSeriesHook(["compilation"])
      // 在 compilation 全部完成编译执行的钩子
      done: new SyncHook(), // new AsyncSeriesHook(["stats"])
      compilation: new SyncHook(["compilation", "params"]),
    };
  }
  run(callback) {
      // 调用 run 方法时触发 hooks.run 的钩子回调
      this.hooks.run.call()
  }
}
```

在初始化 `compiler` 对象时我们还需要去执行插件实例中的 `apply` 方法，用于注册插件中的钩子。

添加 `loadPlugin` 方法后的完整 `webpack.js` 如下。

```js
// packages/core/webpack.js
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
```

`webpack` 插件本质上就是通过发布订阅者模式，在 `compiler.hooks` 上监听事件，通过  `compiler.hooks.xxx.tap` 去订阅事件，用 `compiler.hooks.xxx.call` 去触发事件，触发方法在后续会逐步添加。

> 至此已实现了初始化准备阶段的内容，我们实现了 webpack 配置的读取及初始化合并，注册 webpack 插件并调用 compiler.run() 方法开始编译。

## 模块编译阶段

### 寻找编译入口 `entry`

打包前我们需要根据合并后的配置找到打包入口文件，对 `entry` 文件进行编译处理。入口配置可以为字符串也可以为对象。

```js
// 字符串配置形式
{
    entry: 'entry.js'
}
// 字符串形式最终也会被转为对象配置
{
    entry: {
         main: 'entry.js'
	}
}

// 对象配置形式
{
    entry: {
   		'entry1': './entry1.js',
   		'entry2': './entry2.js'
	}
}
```

我们在 `compiler.js` 中实现 `getEntry` 寻找打包入口的方法。

```js
// packages/core/compiler.js
const path = require('path')
const { toUnixPath } = require('./util')

class Compiler {
  constructor(options) {
    // 读取配置中的 根目录 路径默认值为 process.cwd()
    this.rootPath = this.options.context || toUnixPath(process.cwd())
    // ...
  }

  // run方法启动编译
  // 同时run方法接受外部传递的callback
  run(callback) {
	// ...
    const entry = this.getEntry();
    // ...
  }

  // 获取入口文件路径
  getEntry() {
    let entry = Object.create(null)
    const { entry: optionsEntry } = this.options
    // string 转为含 main 的对象 (支持 webpack entry 配置传入字符串的情况)
    if (typeof optionsEntry === 'string') entry['main'] = optionsEntry
    else entry = optionsEntry
    // 将 entry 变成绝对路径
    Object.keys(entry).forEach((key) => {
      const value = entry[key]
      if (!path.isAbsolute(value)) {
        // 转化为绝对路径的同时统一路径分隔符为 /
        entry[key] = toUnixPath(path.join(this.rootPath, value))
      }
    })
    return entry
  }
}

module.exports = Compiler
```

补充一下用到的工具函数。

```js
// packages/core/util/index.js

// 统一路径分隔符为 /
function toUnixPath(path) {
  return path.replace(/\\/g, '/');
}

module.exports = {
  toUnixPath
}
```

这一步我们通过读取 `webpack` 配置中的 `entry` 获取打包入口文件转化为绝对路径并统一路径分分隔符。

### 从入口文件开始编译

编译阶段我们需要完成以下内容：

1. 根据入口文件构建 `compilation` 对象，`compilation` 对象会负责模块编译过程的处理。
2. 根据入口文件路径分析入口文件，使用 `loader` 处理匹配的文件。
3. 将 `loader` 处理完成的入口文件进行编译。
4. 分析入口文件依赖，重复上边两个步骤编译对应依赖。
5. 如果嵌套文件存在依赖文件，递归调用依赖模块进行编译。
6. 递归编译完成后，组装一个个包含多个模块的`chunk`。

新建 `Compilation` 类进行编译模块的处理，

```js
class Compilation {
  constructor(compiler) {
    // 获取 compiler 上的 options
    this.options = compiler.options;
     
	// 保存所有入口模块对象
    this.entries = new Set();
    // 保存所有依赖模块对象
    this.modules = new Set();
    // 所有的代码块对象
    this.chunks = new Set();
    // 存放本次产出的文件对象
    this.assets = new Set();
    // 存放本次编译所有产出的文件名
    this.files = [];
  }
}
```

