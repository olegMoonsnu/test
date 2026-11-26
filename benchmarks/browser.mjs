import {chromium} from 'playwright-core';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {writeFile} from 'node:fs/promises';
const b=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_PATH||undefined,args:['--no-sandbox','--disable-dev-shm-usage']});
const sizes=[100,1000,10000,50000,100000],rows=[];
try{
  const p=await b.newPage({viewport:{width:1440,height:960}});
  await p.goto(pathToFileURL(resolve('demo/index.html')).href);
  await p.locator('.shell[aria-busy=false]').waitFor();
  for(const size of sizes){
    const r=await p.evaluate(async n=>{
      const data=NSDDemo.generate('tickets',n),cfg=NSDDemo.config('tickets');
      const t=performance.now(),result=await NSDAnalytics.open(data,cfg);
      const root=document.querySelector('[data-nsd-analytics]').shadowRoot;
      await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
      const time=Math.round((performance.now()-t)*10)/10;
      if(root.querySelector('.empty')||root.querySelector('.notice.error')||root.querySelectorAll('.widget').length!==14)throw new Error('Incomplete dashboard');
      const nodes=root.querySelectorAll('*').length;
      NSDAnalytics.destroy();
      return {objects:n,openMs:time,mode:result.mode,domNodes:nodes};
    },size);rows.push(r);console.log(r);
  }
  if(process.argv.includes('--record'))await writeFile('benchmarks/browser-results.json',JSON.stringify({browser:b.version(),viewport:'1440x960',rounds:1,seed:417,widgets:14,rows},null,2)+'\n');
}finally{await b.close();}
