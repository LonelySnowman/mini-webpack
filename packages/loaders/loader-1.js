function loader(source) {
  console.log('loader1: normal', source);
  return source + '//loader1';
}

loader.pitch = function () {
  console.log('loader1 pitch');
};

module.exports = loader;
