const { SyncHook } = require('tapable');
const path = require('path')
const { toUnixPath, tryExtensions, getSourceCode } = require('./util')
const fs = require('fs')
const Compilation = require('./compilation')


// Compiler类进行核心编译实现
class Compiler {
  constructor(options) {
    // 定义基础 options
    this.options = options;

    // 赋予跟路径默认值
    // 相对路径跟路径 Context参数
    this.rootPath = this.options.context || toUnixPath(process.cwd())

    // 创建plugin hooks
    this.hooks = {
      // 开始编译时的钩子
      // new AsyncSeriesHook(["compiler"])
      run: new SyncHook(),
      // new AsyncSeriesHook(["compilation"]),
      // 输出 asset 到 output 目录之前执行 (写入文件之前)
      emit: new SyncHook(),
      // 在 compilation 完成时执行 全部完成编译执行
      // new AsyncSeriesHook(["stats"])
      done: new SyncHook(),
      compilation: new SyncHook(["compilation", "params"]),
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

  // run方法启动编译
  // 同时run方法接受外部传递的callback
  run(callback) {
    // 当调用run方式时 触发开始编译的plugin
    this.hooks.run.call();

    // 获取入口配置对象
    const entry = this.getEntry();

    // 源码这里还会穿入
    // normalModuleFactory
    //
    const compilation = this.newCompilation();

    // 编译入口文件
    compilation.buildEntryModule(entry);

    // 导出列表;之后将每个chunk转化称为单独的文件加入到输出列表assets中
    this.emitAssets(compilation);

    // 结束之后触发钩子
    // 触发结束回调
    this.hooks.done.call();
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

  // 获取入口文件路径
  getEntry() {
    let entry = Object.create(null);
    const { entry: optionsEntry } = this.options;

    // string 转为含 main 的对象
    if (typeof optionsEntry === 'string') {
      entry['main'] = optionsEntry;
    } else {
      entry = optionsEntry;
    }

    // 将entry变成绝对路径
    Object.keys(entry).forEach((key) => {
      const value = entry[key];
      if (!path.isAbsolute(value)) {

        // 转化为绝对路径的同时统一路径分隔符为 /
        entry[key] = toUnixPath(path.join(this.rootPath, value));
      }
    });
    return entry;
  }

  // 将chunk加入输出列表中去
  emitAssets(compilation) {
    const output = this.options.output;
    // 根据 chunks 生成 assets 内容
    compilation.chunks.forEach((chunk) => {
      // LJQFLAG assetPath
      const parseFileName = output.filename.replace('[name]', chunk.name);
      // assets中 { 'main.js': '生成的字符串代码...' }
      compilation.assets[parseFileName] = getSourceCode(chunk);
    });

    // 调用Plugin emit钩子
    this.hooks.emit.call();

    // 先判断目录是否存在 存在直接fs.write 不存在则首先创建
    if (!fs.existsSync(output.path)) {
      fs.mkdirSync(output.path);
    }
    // files中保存所有的生成文件名
    compilation.files = Object.keys(this.assets);
    // 将assets中的内容生成打包文件 写入文件系统中
    compilation.files.forEach((fileName) => {
      const filePath = path.join(output.path, fileName);
      fs.writeFileSync(filePath, this.assets[fileName]);
    });
  }

  newCompilation(params) {
    const compilation = new Compilation(this, {})
    this.hooks.compilation.call(compilation, params);
    return compilation;
  }
}

module.exports = Compiler
