// loader-runner
const fs = require('fs')

function runLoaders(options, callback) {
  // 需要处理的资源绝对路径
  const resource = options.resource || ''
  // 需要处理的所有loaders 组成的绝对路径数组
  let loaders = options.loaders || []
  // 读取资源内容的方法
  const readResource = options.readResource || fs.readFile.bind(fs);
  // 1.根据loaders路径数组创建loaders对象
  loaders = loaders.map(createLoaderObject);
  // 2.loader执行上下文对象 每个loader中的this就会指向这个loaderContext
  const loaderContext = handleLoaderContext(options.context, resource, readResource, loaders) || {}


  // 3.执行 pitch 阶段
  // 用来存储读取资源文件的二进制内容 (转化前的原始文件内容)
  const processOptions = {
    resourceBuffer: null,
  };
  // 处理完loaders对象和loaderContext上下文对象后
  // 根据流程我们需要开始迭代loaders--从pitch阶段开始迭代
  // 按照 post-inline-normal-pre 顺序迭代pitch
  iteratePitchingLoaders(processOptions, loaderContext, (err, result) => {
    callback(err, {
      result,
      resourceBuffer: processOptions.resourceBuffer,
    });
  });

}


// 根据 Loader 绝对路径创建 Loader 对象
function createLoaderObject(loader) {
  const obj = {
    normal: null, // loader normal 函数本身
    pitch: null, // loader pitch 函数
    raw: null, // 表示normal loader处理文件内容时 是否需要将内容转为buffer对象
    // pitch阶段通过给data赋值 normal阶段通过this.data取值 用来保存传递的data
    data: null,
    pitchExecuted: false, // 标记这个loader的pitch函数时候已经执行过
    normalExecuted: false, // 表示这个loader的normal阶段是否已经执行过
    request: loader, // 保存当前loader资源绝对路径
  };

  // 按照路径加载loader模块 真实源码中通过loadLoader加载还支持ESM模块 咱们这里仅仅支持CJS语法
  const normalLoader = require(obj.request);
  // 赋值
  obj.normal = normalLoader;
  obj.pitch = normalLoader.pitch;
  // 转化时需要buffer/string   raw为true时为buffer false时为string
  obj.raw = normalLoader.raw;
  return obj;
}


// 处理 Loader 上下文变量
function handleLoaderContext(loaderContext, resource, readResource, loaders) {
  // 处理loaderContext 也就是loader中的this对象
  loaderContext.resourcePath = resource; // 资源路径绝对地址
  loaderContext.readResource = readResource; // 读取资源文件的方法
  loaderContext.loaderIndex = 0; // 我们通过loaderIndex来执行对应的loader
  loaderContext.loaders = loaders; // 所有的loader对象
  loaderContext.data = null;
  // 标志异步loader的对象属性
  loaderContext.async = null;
  loaderContext.callback = null;

  // request 保存所有loader路径和资源路径
  // 这里我们将它全部转化为inline-loader的形式(字符串拼接的"!"分割的形式)
  // 注意同时在结尾拼接了资源路径哦～

  Object.defineProperty(loaderContext, 'request', {
    enumerable: true,
    get: function () {
      return loaderContext.loaders
        .map((l) => l.request)
        .concat(loaderContext.resourcePath || '')
        .join('!');
    },
  });

  // 保存剩下的请求 不包含自身(以LoaderIndex分界) 包含资源路径
  Object.defineProperty(loaderContext, 'remainingRequest', {
    enumerable: true,
    get: function () {
      return loaderContext.loaders
        .slice(loaderContext + 1)
        .map((i) => i.request)
        .concat(loaderContext.resourcePath)
        .join('!');
    },
  });

  // 保存剩下的请求，包含自身也包含资源路径
  Object.defineProperty(loaderContext, 'currentRequest', {
    enumerable: true,
    get: function () {
      return loaderContext.loaders
        .slice(loaderContext)
        .map((l) => l.request)
        .concat(loaderContext.resourcePath)
        .join('!');
    },
  });
  // 已经处理过的loader请求 不包含自身 不包含资源路径
  Object.defineProperty(loaderContext, 'previousRequest', {
    enumerable: true,
    get: function () {
      return loaderContext.loaders
        .slice(0, loaderContext.index)
        .map((l) => l.request)
        .join('!');
    },
  });
  // 通过代理保存pitch存储的值 pitch方法中的第三个参数可以修改 通过normal中的this.data可以获得对应loader的pitch方法操作的data
  Object.defineProperty(loaderContext, 'data', {
    enumerable: true,
    get: function () {
      return loaderContext.loaders[loaderContext.loaderIndex].data;
    },
  });


}

/**
 * 迭代pitch-loaders
 * 核心思路: 执行第一个loader的pitch 依次迭代 如果到了最后一个结束 就开始读取文件
 * @param {*} options processOptions对象
 * @param {*} loaderContext loader中的this对象
 * @param {*} callback runLoaders中的callback函数
 */
function iteratePitchingLoaders(options, loaderContext, callback) {
  // 超出loader个数 表示所有pitch已经结束 那么此时需要开始读取资源文件内容
  if (loaderContext.loaderIndex >= loaderContext.loaders.length) {
    return processResource(options, loaderContext, callback);
  }

  const currentLoaderObject = loaderContext.loaders[loaderContext.loaderIndex];

  // 当前loader的pitch已经执行过了 继续递归执行下一个
  if (currentLoaderObject.pitchExecuted) {
    loaderContext.loaderIndex++;
    return iteratePitchingLoaders(options, loaderContext, callback);
  }

  const pitchFunction = currentLoaderObject.pitch;

  // 标记当前loader pitch已经执行过
  currentLoaderObject.pitchExecuted = true;

  // 如果当前loader不存在pitch阶段
  if (!currentLoaderObject.pitch) {
    return iteratePitchingLoaders(options, loaderContext, callback);
  }

  // 存在pitch阶段 并且当前pitch loader也未执行过 调用loader的pitch函数
  runSyncOrAsync(
    pitchFunction,
    loaderContext,
    [
      currentLoaderObject.remainingRequest,
      currentLoaderObject.previousRequest,
      currentLoaderObject.data,
    ],
    function (err, ...args) {
      if (err) {
        // 存在错误直接调用callback 表示runLoaders执行完毕
        return callback(err);
      }
      // 根据返回值 判断是否需要熔断 or 继续往下执行下一个pitch
      // pitch函数存在返回值 -> 进行熔断 掉头执行normal-loader
      // pitch函数不存在返回值 -> 继续迭代下一个 iteratePitchLoader
      const hasArg = args.some((i) => i !== undefined);
      if (hasArg) {
        loaderContext.loaderIndex--;
        // 熔断 直接返回调用normal-loader
        iterateNormalLoaders(options, loaderContext, args, callback);
      } else {
        // 这个pitch-loader执行完毕后 继续调用下一个loader
        iteratePitchingLoaders(options, loaderContext, callback);
      }
    }
  );
}

/**
 *
 * 执行loader 同步/异步
 * @param {*} fn 需要被执行的函数
 * @param {*} context loader的上下文对象
 * @param {*} args [remainingRequest,previousRequest,currentLoaderObj.data = {}]
 * @param {*} callback 外部传入的callback (runLoaders方法的形参)
 */
function runSyncOrAsync(fn, context, args, callback) {
  // 是否同步 默认同步loader 表示当前loader执行完自动依次迭代执行
  let isSync = true;
  // 表示传入的fn是否已经执行过了 用来标记重复执行
  let isDone = false;

  // 定义 this.callback
  // 同时this.async 通过闭包访问调用innerCallback 表示异步loader执行完毕
  const innerCallback = (context.callback = function () {
    isDone = true;
    // 当调用this.callback时 标记不走loader函数的return了
    isSync = false;
    callback(null, ...arguments);
  });

  // 定义异步 this.async
  // 每次loader调用都会执行runSyncOrAsync都会重新定义一个context.async方法
  context.async = function () {
    isSync = false; // 将本次同步变更成为异步
    return innerCallback;
  };

  // 调用pitch-loader执行 将this传递成为loaderContext 同时传递三个参数
  // 返回pitch函数的返回值 甄别是否进行熔断
  const result = fn.apply(context, args);

  if (isSync) {
    isDone = true;
    if (result === undefined) {
      return callback();
    }
    // 如果 loader返回的是一个Promise 异步loader
    if (
      result &&
      typeof result === 'object' &&
      typeof result.then === 'function'
    ) {
      // 同样等待Promise结束后直接熔断 否则Reject 直接callback错误
      return result.then((r) => callback(null, r), callback);
    }
    // 非Promise 切存在执行结果 进行熔断
    return callback(null, result);
  }
}


/**
 *
 * 读取文件方法
 * @param {*} options
 * @param {*} loaderContext
 * @param {*} callback
 */
function processResource(options, loaderContext, callback) {
  // 重置越界的 loaderContext.loaderIndex
  // 达到倒叙执行 pre -> normal -> inline -> post
  loaderContext.loaderIndex = loaderContext.loaders.length - 1;
  const resource = loaderContext.resourcePath;
  // 读取文件内容
  loaderContext.readResource(resource, (err, buffer) => {
    if (err) {
      return callback(err);
    }
    // 保存原始文件内容的buffer 相当于processOptions.resourceBuffer = buffer
    options.resourceBuffer = buffer;
    // 同时将读取到的文件内容传入iterateNormalLoaders 进行迭代`normal loader`
    iterateNormalLoaders(options, loaderContext, [buffer], callback);
  });
}

/**
 * 迭代normal-loaders 根据loaderIndex的值进行迭代
 * 核心思路: 迭代完成pitch-loader之后 读取文件 迭代执行normal-loader
 *          或者在pitch-loader中存在返回值 熔断执行normal-loader
 * @param {*} options processOptions对象
 * @param {*} loaderContext loader中的this对象
 * @param {*} args [buffer/any]
 * 当pitch阶段不存在返回值时 此时为即将处理的资源文件
 * 当pitch阶段存在返回值时 此时为pitch阶段的返回值
 * @param {*} callback runLoaders中的callback函数
 */
function iterateNormalLoaders(options, loaderContext, args, callback) {
  // 越界元素判断 越界表示所有normal loader处理完毕 直接调用callback返回
  if (loaderContext.loaderIndex < 0) {
    return callback(null, args);
  }
  const currentLoader = loaderContext.loaders[loaderContext.loaderIndex];
  if (currentLoader.normalExecuted) {
    loaderContext.loaderIndex--;
    return iterateNormalLoaders(options, loaderContext, args, callback);
  }

  const normalFunction = currentLoader.normal;
  // 标记为执行过
  currentLoader.normalExecuted = true;
  // 检查是否执行过
  if (!normalFunction) {
    return iterateNormalLoaders(options, loaderContext, args, callback);
  }
  // 根据loader中raw的值 格式化source
  convertArgs(args, currentLoader.raw);
  // 执行loader
  runSyncOrAsync(normalFunction, loaderContext, args, (err, ...args) => {
    if (err) {
      return callback(err);
    }
    // 继续迭代 注意这里的args是处理过后的args
    iterateNormalLoaders(options, loaderContext, args, callback);
  });
}

/**
 *
 * 转化资源source的格式
 * @param {*} args [资源]
 * @param {*} raw Boolean 是否需要Buffer
 * raw为true 表示需要一个Buffer
 * raw为false表示不需要Buffer
 */
function convertArgs(args, raw) {
  if (!raw && Buffer.isBuffer(args[0])) {
    // 我不需要buffer
    args[0] = args[0].toString();
  } else if (raw && typeof args[0] === 'string') {
    // 需要Buffer 资源文件是string类型 转化称为Buffer
    args[0] = Buffer.from(args[0], 'utf8');
  }
}

