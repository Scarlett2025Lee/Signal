import { fileURLToPath } from 'node:url';
import { checkAndApply,confirm,rollback,withUpdateLock,applyPackage,validateManifest } from './update-core.mjs';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const args=process.argv.slice(2);
const command=args[0]??'check';
const index=args.indexOf('--root');const root=resolve(index>=0?args[index+1]:fileURLToPath(new URL('../',import.meta.url)));
try {
  let result;
  if(command==='check')result=await checkAndApply(root);
  else if(command==='confirm')result=await withUpdateLock(root,()=>confirm(root));
  else if(command==='rollback')result=await withUpdateLock(root,()=>rollback(root));
  else if(command==='install'){
    const manifest=validateManifest(JSON.parse(await readFile(args[args.indexOf('--manifest')+1],'utf8')));
    const bytes=await readFile(args[args.indexOf('--package')+1]);
    result=await withUpdateLock(root,async()=>{await rollback(root);return applyPackage(root,bytes,manifest);});
  } else throw Error('Unknown update command');
  console.log(JSON.stringify(result));
}catch(error){console.error('Signal update: '+error.message);process.exitCode=1;}
