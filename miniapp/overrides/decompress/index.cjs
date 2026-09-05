'use strict';

const implementation = import('@xhmikosr/decompress').then(module => module.default);

// download@7 is CommonJS and expects the legacy function export. The maintained
// fork is ESM, so keep the adapter asynchronous just like decompress itself.
module.exports = (...args) => implementation.then(decompress => decompress(...args));
