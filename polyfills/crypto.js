// Browser stand-in for Node's `crypto`, limited to what source/dingocoin.js uses.
//
// These are the same modules crypto-browserify re-exports. Its signing, ECDH and
// RSA parts are left out so that `elliptic` is not bundled; ECDSA is done with
// @noble/curves instead.
const aes = require("browserify-cipher");

exports.randomBytes = require("randombytes");
exports.createHash = require("create-hash");
exports.pbkdf2Sync = require("pbkdf2").pbkdf2Sync;
exports.createCipheriv = aes.createCipheriv;
exports.createDecipheriv = aes.createDecipheriv;
