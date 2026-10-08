if (typeof require !== "undefined" && require.extensions) {
  require.extensions[".css"] = (module: NodeJS.Module) => {
    const proxy = new Proxy({}, {
      get: (_target, prop) => {
        if (prop === "__esModule") return false;
        return String(prop);
      },
    });
    module.exports = proxy;
  };
}
