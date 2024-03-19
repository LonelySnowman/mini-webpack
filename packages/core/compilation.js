const { SyncWaterfallHook } = require('tapable');
const path = require('path')
const { toUnixPath, tryExtensions, getSourceCode } = require('./util')
const fs = require('fs')
const parser = require('@babel/parser');
const traverse = require('@babel/traverse').default;
const generator = require('@babel/generator').default;
const t = require('@babel/types');


// Compiler类进行核心编译实现
class Compilation {
  constructor(compiler, params) {

    // 定义基础 options
    this.options = compiler.options;

    // 创建plugin hooks
    this.hooks = {
      assetPath: new SyncWaterfallHook(["path", "options"]),
    };

    // 3.编译时所需 模块编译阶段
    // 保存所有入口模块对象

    // 这些算是 compilation 对象上的
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

  // 编译全部入口模块
  buildEntryModule(entry) {
    // 这里可以优化 同时遍历 key value Object.entries()
    Object.keys(entry).forEach((entryName) => {
      const entryPath = entry[entryName];
      const entryObj = this.buildModule(entryName, entryPath);
      this.entries.add(entryObj);
      // 根据当前入口文件和模块的相互依赖关系，组装成为一个个包含当前入口所有依赖模块的chunk
      this.buildUpChunk(entryName, entryObj);
    });
  }


  // 模块编译方法
  buildModule(moduleName, modulePath) {
    // 1. 读取文件原始代码
    const originSourceCode = fs.readFileSync(modulePath, 'utf-8')
    // originSourceCode 与 moduleCode 会动态变化
    // 相当与临时全局变量
    this.originSourceCode = originSourceCode
    // moduleCode为修改后的代码
    this.moduleCode = originSourceCode;
    //  2. 调用 loader 进行处理
    this.handleLoader(modulePath);
    // 3. 调用 webpack 进行模块编译 获得最终的module对象
    // 处理 require 引用问题
    const module = this.handleWebpackCompiler(moduleName, modulePath);
    return module
  }

  // 匹配loader处理
  handleLoader(modulePath) {
    const matchLoaders = [];

    // 1. 获取所有传入的loader规则
    const rules = this.options.module.rules; // loader 匹配规则
    rules.forEach((loader) => {
      const testRule = loader.test;

      // LJQFLAG 待兼容 use 中对象数组的形式
      if (testRule.test(modulePath)) {
        // 兼容 string/array
        // object 形式待兼容
        if (typeof loader.use === 'string') {
          // 仅考虑loader { test:/\.js$/g, use:['babel-loader'] }, { test:/\.js$/, loader:'babel-loader' }
          matchLoaders.push(loader.use);
        } else {
          matchLoaders.push(...loader.use);
        }
      }

      // 2. 倒序执行loader传入源代码
      for (let i = matchLoaders.length - 1; i >= 0; i--) {
        // 目前我们外部仅支持传入绝对路径的loader模式
        // require引入对应loader
        const loaderFn = require(matchLoaders[i]);
        // 通过loader同步处理我的每一次编译的moduleCode
        // 使用 call 绑定 this
        this.moduleCode = loaderFn.call(this, this.moduleCode);
      }
    });
  }

  // 调用webpack进行模块编译
  handleWebpackCompiler(moduleName, modulePath) {
    // 将当前模块相对于项目启动根目录计算出相对路径 作为模块ID
    const moduleId = './' + path.posix.relative(this.rootPath, modulePath);
    // 创建模块对象
    const module = {
      id: moduleId,
      dependencies: new Set(), // 该模块所依赖模块绝对路径地址
      name: [moduleName], // 该模块所属的入口文件
      // source: this.originSourceCode 当前模块代码
    };

    // 调用babel分析我们的代码
    const ast = parser.parse(this.moduleCode, {
      sourceType: 'module',
    });

    // 深度优先 遍历语法Tree
    traverse(ast, {
      // 当遇到require语句时
      CallExpression:(nodePath) => {
        const node = nodePath.node;
        if (node.callee.name === 'require') {
          // 获得源代码中引入模块相对路径
          const requirePath = node.arguments[0].value;

          // 寻找模块绝对路径 当前模块路径+require()对应相对路径
          const moduleDirName = path.posix.dirname(modulePath);

          // 别名待支持 LJQFLAG

          // 获取到 require 内部的 绝对路径
          const absolutePath = tryExtensions(
            path.posix.join(moduleDirName, requirePath),
            this.options.resolve.extensions,
            requirePath,
            moduleDirName
          );

          // 生成moduleId - 针对于跟路径的模块ID 添加进入新的依赖模块路径
          // 绝对路径转化为相对 rootPath 的相对路径
          const moduleId =
            './' + path.posix.relative(this.rootPath, absolutePath);

          // 通过babel修改源代码中的require变成__webpack_require__语句
          node.callee = t.identifier('__webpack_require__');

          // 修改源代码中require语句引入的模块 全部修改变为相对于跟路径来处理
          node.arguments = [t.stringLiteral(moduleId)];

          // 为当前模块添加require语句造成的依赖(内容为相对于根路径的模块ID)
          // 监测到一个 require 就添加一个依赖
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

  // 根据入口文件和依赖模块组装chunks
  buildUpChunk(entryName, entryObj) {
    const chunk = {
      name: entryName, // 每一个入口文件作为一个chunk
      entryModule: entryObj, // entry编译后的对象
      modules: Array.from(this.modules).filter((i) =>
        i.name.includes(entryName)
      ), // 寻找与当前entry有关的所有module
    };
    // 将chunk添加到this.chunks中去
    this.chunks.add(chunk);
  }
}

module.exports = Compilation
