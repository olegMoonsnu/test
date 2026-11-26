'use strict';
async function launchDemo(measure) {
  const status=document.getElementById('timing');
  try {
    const kind=document.getElementById('dataset').value,n=document.getElementById('count').valueAsNumber;
    const t0=performance.now(),data=NSDDemo.generate(kind,n),t1=performance.now();
    const result=await NSDAnalytics.open(data,NSDDemo.config(kind));
    if(!result)return;
    const t2=performance.now();
    status.textContent='Объектов '+n+' · генерация '+Math.round(t1-t0)+' мс · открытие дашборда '+Math.round(t2-t1)+' мс · '+result.mode;
    if(measure)NSDAnalytics.close();
  } catch(e){status.textContent=e.message;}
}
document.getElementById('launch').onclick=()=>launchDemo(false);
document.getElementById('bench').onclick=()=>launchDemo(true);
launchDemo(false);
