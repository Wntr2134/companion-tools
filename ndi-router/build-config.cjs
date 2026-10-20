// koffi is a native add-on with prebuilt binaries for every platform inside its package:
// keep it out of the bundle and ship the package itself (Mac Intel/Apple Silicon and Windows x64/ARM).
module.exports = {
	externals: [{ koffi: 'commonjs koffi' }],
}
