import {mkdir, readFile} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import {dirname, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const {codegenConfig}=JSON.parse(await readFile(resolve(root,'package.json'),'utf8'));
const run=args=>{
  const result=spawnSync(process.execPath,args,{cwd:root,stdio:'inherit'});
  if(result.error) throw result.error;
  if(result.status!==0) throw new Error(`React Native codegen failed (${result.status})`);
};
// The all-platform convenience CLI uses a default Java package. Generate the
// Android spec with the same package as the public Gradle integration instead.
run(['node_modules/react-native/scripts/generate-codegen-artifacts.js','--path','.',
  '--outputPath','codegen','--targetPlatform','ios','--source','library']);
await mkdir(resolve(root,'codegen/android'),{recursive:true});
run(['node_modules/@react-native/codegen/lib/cli/combine/combine-js-to-schema-cli.js',
  '--platform','android','--libraryName',codegenConfig.name,'codegen/android/schema.json',codegenConfig.jsSrcsDir]);
run(['node_modules/react-native/scripts/generate-specs-cli.js','--platform','android',
  '--schemaPath','codegen/android/schema.json','--outputDir','codegen/android/generated',
  '--libraryName',codegenConfig.name,'--javaPackageName',codegenConfig.android.javaPackageName,
  '--libraryType',codegenConfig.type]);
