// 这个插件的作用就是在 webpack 开始编译前输出 PluginTest Start
class PluginTest {
    // webpack 会调用 apply 函数并传入 compiler 对象
    apply(compiler) {
        // 注册同步钩子
        compiler.hooks.run.tap('Plugin Test', () => {
            console.log('PluginTest Start');
        });
    }
}

module.exports = PluginTest;