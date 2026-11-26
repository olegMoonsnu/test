import {build} from 'esbuild';
import {mkdir} from 'node:fs/promises';
await mkdir('dist',{recursive:true});
const common={bundle:true,format:'iife',platform:'browser',target:'es2020',charset:'utf8',legalComments:'none'};
const worker=await build({...common,entryPoints:['src/engines/worker.js'],write:false,minify:true});
for(const minify of [false,true]) await build({...common,entryPoints:['src/adapters/nsd.js'],minify,
  outfile:'dist/nsd-analytics'+(minify?'.min':'')+'.js',
  define:{__NSD_WORKER__:JSON.stringify(worker.outputFiles[0].text)},
  banner:{js:'/*! NSD Analytics Studio v0.1.0 | MIT */'}});
