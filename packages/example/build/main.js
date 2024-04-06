(() => {
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
    const depModule = __webpack_require__( "./packages/example/src/module.js");
    console.log(depModule, 'Entry 1 dep');
    console.log('This is entry 1 !');

    // loader2
    // loader1
  })();
})();