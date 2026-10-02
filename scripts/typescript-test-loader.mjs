import {registerHooks} from 'node:module';
import {existsSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
// Production uses .js module paths; Node's no-build tests resolve the local TS source.
registerHooks({resolve(specifier,context,next){
  if(specifier.endsWith('.js')&&context.parentURL?.startsWith('file:')&&specifier.startsWith('.')) {
    const source=new URL(specifier.replace(/\.js$/,'.ts'),context.parentURL);
    if(existsSync(fileURLToPath(source)))return next(source.href,context);
  }
  return next(specifier,context);
}});
