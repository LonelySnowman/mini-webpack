function loader(source) {
  console.log('loader2: normal', source);
  return source + '\n// loader2';
}

loader.pitch = function () {
  console.log('loader2 pitch');
};

module.exports = loader;
