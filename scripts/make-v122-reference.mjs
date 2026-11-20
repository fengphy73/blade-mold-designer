// One-off: node scripts/make-v122-reference.mjs /path/to/v1.2.2-checkout
// Writes scripts/fixtures/v1.2.2-hashes.json, the byte-for-byte reference used by check-outputs.mjs.
import { writeFileSync } from 'fs';
import { pathToFileURL } from 'url';
import { paramSets, formLike, hashOutputs } from './output-hashes.mjs';

const root = process.argv[2];
if (!root) { console.error('usage: node scripts/make-v122-reference.mjs <v1.2.2 checkout>'); process.exit(1); }
const imp = p => import(pathToFileURL(`${root}/${p}`).href);
const model = await imp('js/model.js');
const mods = {
  validateConfig: model.validateConfig,
  buildMold: (await imp('js/mesh.js')).buildMold,
  ...(await imp('js/blade.js')),
  meshToStl: (await imp('js/stl.js')).meshToStl,
  bladePlanformSvg: (await imp('js/svg-blade.js')).bladePlanformSvg,
  // v1.2.2 main.js configFile()
  configText: c => JSON.stringify({ ...c, profile: 'NACA 2412', purpose: '上翼面配對壓模（含可選葉根平面接合段）' }, null, 2)
};
const result = paramSets().map(set => ({ name: set.name, ...hashOutputs(mods, formLike(model.defaultConfig(), set.overrides)) }));
writeFileSync(new URL('./fixtures/v1.2.2-hashes.json', import.meta.url), JSON.stringify(result, null, 1) + '\n');
console.log(`wrote ${result.length} reference sets`);
