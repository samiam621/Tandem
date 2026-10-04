// Ad-hoc sign the whole macOS app after packaging. Without this only the main binary carries a
// linker signature, and a downloaded copy is reported as "damaged" instead of the normal
// "unidentified developer" prompt.
// ponytail: ad-hoc only; real signing and notarization need an Apple Developer ID.
const { execFileSync } = require('child_process')

exports.default = async function adhocSign({ electronPlatformName, appOutDir, packager }) {
  if (electronPlatformName !== 'darwin') return
  const app = `${appOutDir}/${packager.appInfo.productFilename}.app`
  execFileSync('codesign', ['--force', '--deep', '--sign', '-', app], { stdio: 'inherit' })
}
