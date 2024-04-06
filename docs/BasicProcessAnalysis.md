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

## 新建打包案例

在开始编写 `mini-webpack` 核心代码前，我们先编写一个用于我们编写完成后的测试用例。

新建一个 `webpack` 配置文件。

```js
// packages/example/webpack.config.js
const path = require('path')
const Plugin1 = require('../plugins/plugin-1')
const Plugin2 = require('../plugins/plugin-2')

module.exports = {
  mode: 'development',
  entry: {
    main: path.resolve(__dirname, './src/entry1.js'),
    second: path.resolve(__dirname, './src/entry2.js'),
  },
  devtool: false,
  context: process.cwd(),
  output: {
    path: path.resolve(__dirname, './build'),
    filename: '[name].js',
  },
  plugins: [new Plugin1(), new Plugin2()],
  resolve: {
    extensions: ['.js', '.ts'],
  },
  module: {
    rules: [
      {
        test: /\.js/,
        use: [
          path.resolve(__dirname, '../loaders/loader-1.js'),
          path.resolve(__dirname, '../loaders/loader-2.js'),
        ],
      },
    ],
  },
};

```

新建一下我们需要打包用的文件。

```js
// packages/example/src/entry1.js
const depModule = require('./module');
console.log(depModule, 'Entry 1 dep');
console.log('This is entry 1 !');

// packages/example/src/entry2.js
const depModule = require('./module');
console.log(depModule, 'Entry 2 dep');
console.log('This is entry 2 !');

// packages/example/src/module.js
const name = 'This is module';
module.exports = {
  name,
};

```

新建我们用到的 `plugin` 与 `loader`，如果你对这两个的实现原理都不太了解也不要担心，后续我们会详细讲解，这里只编写了一些简单的小案例。

```js
// packages/plugins/plugin-1.js
class Plugin1 {
  apply(compiler) {
    compiler.hooks.run.tap('Plugin1', () => {
      console.log('Plugin1 Start');
    });
  }
}

module.exports = Plugin1;

// packages/plugins/plugin-2.js
class Plugin2 {
  apply(compiler) {
    compiler.hooks.done.tap('Plugin2', () => {
      console.log('Plugin2 Done');
    });
  }
}

module.exports = Plugin2;

```

```js
// packages/loaders/loader-1.js
function loader(source) {
  console.log('loader1: normal', source);
  return source + '\n// loader1';
}

loader.pitch = function () {
  console.log('loader1 pitch');
};

module.exports = loader;

// packages/loaders/loader-2.js
function loader(source) {
  console.log('loader2: normal', source);
  return source + '\n// loader2';
}

loader.pitch = function () {
  console.log('loader2 pitch');
};

module.exports = loader;

```

## 初始化准备阶段

### `webpack cli` 运行入口

打包打包时 `webpack` 会读取 `webpack.config.js` 的配置并与 `shell` 中的参数合并，生成 `compiler` 对象并调用 `compiler.run()` 方法进行打包。

我们新建 `index.js` 作为 `webpack` 运行的入口。 

```js
// packages/core/index.js
// 调用 webpack(config) 初始化 compiler 对象
const webpack = require('./webpack');
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

新建 `Compilation` 类进行编译模块的处理，保存该次编译过程中的入口模块对象、依赖模块对象、

```js
// packages/core/compilation.js

class Compilation {
  constructor(compiler, params) {
    // 获取 compiler 上的 options
    this.options = compiler.options;
    this.rootPath = compiler.rootPath;
     
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

根据配置中的入口文件，开始从入口文件开始进行编译，并创建入口文件对象。

```js
// packages/core/compilation.js

class Compilation {
  // ...
  
  // A.编译全部入口模块
  buildEntryModule(entry) {
    Object.entries(entry).forEach(([entryName, entryPath]) => {
      // 对入口文件进行编译 获取入口文件对象
      const entryObj = this.buildModule(entryName, entryPath);
      this.entries.add(entryObj);
      // 根据当前入口文件和模块的相互依赖关系，组装成为一个个包含当前入口所有依赖模块的chunk
      this.buildUpChunk(entryName, entryObj);
    });
  }
}
```

### 模块编译

在编写模块编译的方法前，我们可以先使用原版的 `webpack` 对我们的案例进行打包，看一下打包后的结果。

我们可以看到依据我们的 `entry` 打包出了两个文件，分别来自 `entry1` 与 `entry2` ，我们可以看一下 `packages/example/build/main.js` 文件。下面的代码是剔除了注释后的。

```js
(() => {
  // entry 中引入的模块被存入了一个 __webpack_modules__ 对象
  // key 为模块的相对路径
  // value 为一个函数直接执行 module 中的代码
  var __webpack_modules__ = ({
  "./packages/example/src/module.js":
      ((module) => {
  const name = 'This is module';
  module.exports = {
    name,
  };
  })
  });
  var __webpack_module_cache__ = {};

  // 自行封装一个 __webpack_require__ 方法执行 module 中的代码
  function __webpack_require__(moduleId) {
    var cachedModule = __webpack_module_cache__[moduleId];
    if (cachedModule !== undefined) {
        return cachedModule.exports;
    }
    var module = __webpack_module_cache__[moduleId] = {
        exports: {}
    };
    __webpack_modules__[moduleId](module, module.exports, __webpack_require__);
    return module.exports;
  }

  var __webpack_exports__ = {};

  (() => {
    // 代码中的 require 均被替换为 __webpack_require__
    const depModule = __webpack_require__( "./packages/example/src/module.js");
    console.log(depModule, 'Entry 1 dep');
    console.log('This is entry 1 !');

    // loader2
    // loader1
  })();
})();
```

这样一看原理其实很简单，`webpack` 最终打包出的文件是一个立即执行函数，依次读取 `entry` 中引用的文件全部编译在 `__webpack_modules__` 中的一个对象 ，key 为模块的相对路径(作为一个模块的唯一 id)，value 为一个函数直接执行 module 中的代码。然后再封装一个  `__webpack_require__` 方法从 `__webpack_modules__` 获取 `module` 代码并执行。并将代码中的 `require` 全部替换为  `__webpack_require__`。

那么再编译模块的方法主要进行两步操作，获取代码文件的源代码字符串，然后使用 loader 对代码进行处理，再对处理后的代码进行编译，就是将代码中的 require 全部替换为 `__webpack_require__`，最后我们输出模块的时候再将 `module` 中的代码打包进 `__webpack_modules__` 就可以了。

```js
// packages/core/compilation.js
buildModule(moduleName, modulePath) {
    // 1.读取文件原始代码
    const originSourceCode = fs.readFileSync(modulePath, 'utf-8')
    // originSourceCode 与 moduleCode
    // 记录当前处理模块的 源代码 与 编译后代码
    this.originSourceCode = originSourceCode
    this.moduleCode = originSourceCode;
    // 2.调用 loader 进行处理
    // 这里先用一个简单的方法进行处理
    // 源码中封装了一个 loader-runner 模块进行处理
    this.handleLoader(modulePath);
    // 3.调用 webpack 进行模块编译获得最终的module对象
    // 处理 require 引用问题
    const module = this.handleWebpackCompiler(moduleName, modulePath);
    return module
}

```

首先我们需要用 `loader` 处理读取的源文件内容。`loader` 本质上就是一个函数，接收文件源代码并可以在 `this` 中调用 `webpack` 上下文对象，返回 `loader` 处理后的代码内容。

```js
// packages/core/compilation.js
handleLoader(modulePath) {
  const matchLoaders = [];
  // 1. 获取所有传入的loader规则
  const rules = this.options.module.rules;
  // 读取 loader 路径
  rules.forEach((loader) => {
    const testRule = loader.test;
    if (testRule.test(modulePath)) {
      if (typeof loader.use === 'string') {
        matchLoaders.push(loader.use);
      } else {
        matchLoaders.push(...loader.use);
      }
    }
    // 2. 倒序执行loader传入源代码
    for (let i = matchLoaders.length - 1; i >= 0; i--) {
      // require 引入对应 loader
      const loaderFn = require(matchLoaders[i]);
      // 使用 call 绑定 this
      this.moduleCode = loaderFn.call(this, this.moduleCode);
    }
  });
}
```

`loader` 处理完毕后我们需要进行 `webpack` 编译阶段，也就是需要将源代码中的 `require` 全部替换为 `__webpack_require__`，并生成 `module` 对象。这个操作可以利用 `bable` 将代码转化为 `ast` 语法树，并直接操作语法树生成新的代码，非常方便。

并且在处理过程中我们要进行递归操作，一个模块依赖其他模块时，也需要对该模块的依赖模块进行编译处理。

```js
// 引入相关工具库
const parser = require('@babel/parser');
const traverse = require('@babel/traverse').default;
const generator = require('@babel/generator').default;
const t = require('@babel/types');

// packages/core/compilation.js
handleWebpackCompiler(moduleName, modulePath) {
  // 将当前模块相对于项目启动根目录计算出相对路径 作为模块ID
  const moduleId = toUnixPath('./' + path.relative(this.rootPath, modulePath));
  // 创建模块对象
  const module = {
    id: moduleId,
    dependencies: new Set(), // 该模块所依赖模块绝对路径地址
    name: [moduleName], // 该模块所属的入口文件
    source: this.originSourceCode // 当前模块代码
  };

  // 调用 babel 分析我们的代码
  const ast = parser.parse(this.moduleCode, {
    sourceType: 'module',
  });

  // 利用 traverse 方法遍历语法树
  traverse(ast, {
    // 当遇到 require 语句时会触发该回调
    CallExpression:(nodePath) => {
      const node = nodePath.node;
      if (node.callee.name === 'require') {
        // 获得源代码中引入模块相对路径
        const requirePath = node.arguments[0].value;

        // 获取到 require 内部的绝对路径
        // tryExtensions 就是对路径进行后缀的匹配
        const moduleDirName = path.dirname(modulePath);
        const absolutePath = tryExtensions(
          path.join(moduleDirName, requirePath),
          this.options.resolve.extensions,
          requirePath,
          moduleDirName
        );

        // 绝对路径转化为相对 rootPath 的相对路径作为 moduleId
        const moduleId = toUnixPath('./' + path.relative(this.rootPath, absolutePath));

        // 将 require 替换为 __webpack_require__
        node.callee = t.identifier('__webpack_require__');

        // 修改源代码中 require 语句引入的模块
        // 全部修改变为相对于跟路径 moduleId 来处理
        node.arguments = [t.stringLiteral(moduleId)];
        // 将该模块 require 的模块全部添加进依赖中
        module.dependencies.add(moduleId);
      }
    },
  });

  // 遍历结束根据AST生成新的代码
  const { code } = generator(ast);
  // 为当前模块挂载新的生成的代码
  module._source = code;
  // 递归依赖深度遍历 存在依赖模块则加入
  // 添加前防止重复解析
  const alreadyModules = Array.from(this.modules).map((i) => i.id);
  module.dependencies.forEach((dependencyPath) => {
    if (!alreadyModules.includes(dependencyPath)) {
      const depModule = this.buildModule(moduleName, dependencyPath);
      // 将编译后的任何依赖模块对象加入到modules对象中去
      this.modules.add(depModule);
    } else {
      // 否则不需要解析 仅添加入口文件
      this.modules.forEach((value) => {
        if (value.id === dependencyPath) {
          value.name.push(moduleName);
        }
      })
    }
  });

  // 返回当前模块对象
  return module
}
```

补充一下匹配文件后缀的方法。

```js
// packages/core/util/index.js
function tryExtensions(
  modulePath,
  extensions,
  originModulePath,
  moduleContext
) {
  // 用户传入后缀优先直接寻找
  extensions.unshift('');
  for (let extension of extensions) {
    if (fs.existsSync(modulePath + extension)) {
      return modulePath + extension;
    }
  }
  // 未匹配对应文件
  throw new Error(
    `No module, Error: Can't resolve ${originModulePath} in  ${moduleContext}`
  );
}
```



到这里我们就完成了模块编译阶段，我们从打包入口开始，依次对入口文件以及引用的依赖模块进行 `loader` 处理以及 `webpack` 编译，构建出一个 **依赖图(dependency graph)**，使用 `entries` 与 `modules` 分别保存了入口对象和模块对象，我们可以根据这些信息去构建我们的 `chunks`，最后将打包后的模块输出。

## 模块生成阶段

### 组装 chunk

这一阶段比较简单，一个 `entry` 生成一个 `chunk` 根据相关 `modules` 生成对象即可。

```js
// packages/core/compilation.js
buildUpChunk(entryName, entryObj) {
  const chunk = {
    name: entryName, // 每一个入口文件作为一个 chunk
    entryModule: entryObj, // 编译后的 entry 对象
    modules: Array.from(this.modules).filter((i) =>
      i.name.includes(entryName)
    ), // 在该 entry 中引入的 module
  };
  // 将 chunk 添加到 this.chunks 中去
  this.chunks.add(chunk);
}
```

接下来补充一下在 `compiler` 对象中调用 `compilation` 进行编译的代码。

```js
run(callback) {
  // ...
  
  // 获取入口配置对象
  const entry = this.getEntry();
  const compilation = this.newCompilation();
  // 编译入口文件
  compilation.buildEntryModule(entry);
  
  // ...
}
```

补充一下构建 `compilation` 对象的方法。

```js
newCompilation(params) {
  // 源码这里还会传入 normalModuleFactory 等对象
  const compilation = new Compilation(this, {})
  // 调用 compilation 阶段触发的钩子
  this.hooks.compilation.call(compilation, params);
  return compilation;
}
```

## 输出文件阶段

最后我们需要根据我们生成的 `chunks` 去输出最终编译完成的文件即可，在模块编译阶段中已经讲解了 `webpack` 打包的原理，是在内部封装了一个 `__webpack_require__` 方法去调用 `__webpack_modules__` 中的方法，需要变更的地方只有 `__webpack_modules__` 对象和处理后的源代码内容，这些在 `entrys`、`modules` 和 `chunks` 中我们都已经生成好了，其他地方直接使用原版 `webpack` 打包后的内容即可，这样我们就能生成我们的 `assets` 并输出文件。

编写一个根据 `chunk` 信息去生成最终代码的方法。

```js
// packages/core/util/index.js
function getSourceCode(chunk) {
  const { name, entryModule, modules } = chunk;
  // 根据 moduleId 作为 key
  // 处理后的代码封装成一个方法作为 value
  return `
  (() => {
    var __webpack_modules__ = {
      ${modules
    .map((module) => {
      return `
          '${module.id}': (module) => {
            ${module._source}
      }
        `;
    })
    .join(',')}
    };
    // The module cache
    var __webpack_module_cache__ = {};

    // The require function
    function __webpack_require__(moduleId) {
      // Check if module is in cache
      var cachedModule = __webpack_module_cache__[moduleId];
      if (cachedModule !== undefined) {
        return cachedModule.exports;
      }
      // Create a new module (and put it into the cache)
      var module = (__webpack_module_cache__[moduleId] = {
        // no module.id needed
        // no module.loaded needed
        exports: {},
      });

      // Execute the module function
      __webpack_modules__[moduleId](module, module.exports, __webpack_require__);

      // Return the exports of the module
      return module.exports;
    }

    var __webpack_exports__ = {};
    // This entry need to be wrapped in an IIFE because it need to be isolated against other modules in the chunk.
    (() => {
      ${entryModule._source}
    })();
  })();
  `;
}
```

最后我们根据 `chunks` 中的信息直接输出文件即可。

```js
// packages/core/compilation.js

emitAssets(compilation) {
  const output = this.options.output;
  // 根据 chunks 生成 assets 内容
  compilation.chunks.forEach((chunk) => {
    const parseFileName = output.filename.replace('[name]', chunk.name);
    compilation.assets[parseFileName] = getSourceCode(chunk);
  });

  // 调用 Plugin emit 钩子
  this.hooks.emit.call();

  // 目录不存在需要先创建目录
  if (!fs.existsSync(output.path)) fs.mkdirSync(output.path);
  // files 中保存所有的生成文件名
  compilation.files = Object.keys(this.assets);
  // 将 assets 中的内容生成打包文件输出
  compilation.files.forEach((fileName) => {
    const filePath = path.join(output.path, fileName);
    fs.writeFileSync(filePath, this.assets[fileName]);
  });
}
```

还需要在 `compiler.run` 函数中调用一下并补充回调逻辑，触发钩子等。

```js
run(callback) {
  // ...
  // 导出列表之后将每个 chunk 转化称为单独的文件
  // 加入到输出列表 assets 中
  this.emitAssets(compilation);

  // 结束之后触发钩子
  this.hooks.done.call();
  // 执行 compiler.run 结束后的回调并返回编译信息
  callback(null, {
    toJson: () => {
      return {
        entries: compilation.entries,
        modules: compilation.modules,
        files: compilation.files,
        chunks: compilation.chunks,
        assets: compilation.assets,
      };
    },
  });
}
```

到这里我们简易 `webpack` 的核心逻辑就实现完成了
