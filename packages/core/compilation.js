const { SyncWaterfallHook } = require('tapable');
const path = require('path')
const { toUnixPath, tryExtensions } = require('./util')
const fs = require('fs')
const parser = require('@babel/parser');
const traverse = require('@babel/traverse').default;
const generator = require('@babel/generator').default;
const t = require('@babel/types');


// Compiler类进行核心编译实现
class Compilation{
  constructor(compiler, params) {

    // 定义基础 options
    this.options = compiler.options;
    this.rootPath = compiler.rootPath

    // 创建plugin hooks
    this.hooks = {
      assetPath: new SyncWaterfallHook(["path", "options"]),
    };

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

  // B.模块编译方法
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

  // C.匹配loader处理
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

  // D.调用webpack进行模块编译
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
          // 别名待支持 MINIWEBPACKFLAG
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

  // E.根据入口文件和依赖模块组装 chunks
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
}

module.exports = Compilation
