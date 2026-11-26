import {svg,el} from '../components/dom.js';
import {cellValue} from '../engines/pivot.js';
import {selection} from '../engines/dimensions.js';
const colors=['#6758d6','#36a996','#6689d9','#db9c53','#c77ba7','#73a257','#8b73bd','#4b9ab1'];
const ink='var(--ink)', muted='var(--muted)', grid='var(--line)';
const short=(v,n=19)=>String(v).length>n?String(v).slice(0,n-1)+'…':String(v);
const line=(s,x1,y1,x2,y2,stroke=grid,width=1)=>s.append(svg('line',{x1,y1,x2,y2,stroke,'stroke-width':width}));
function txt(s,x,y,value,size=11,anchor='start',fill=muted) {
  const n=svg('text',{x,y,'font-size':size,'text-anchor':anchor,fill},value);s.append(n);return n;
}
function mark(node,caption,action) {
  node.append(svg('title',{},caption));
  node.setAttribute('aria-label',caption);node.setAttribute('role','button');node.setAttribute('tabindex','0');
  node.onclick=action;node.onkeydown=e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();action();}};return node;
}
function scale(a,b,lo,hi) {
  if(a===b)return ()=> (lo+hi)/2;
  const span=b-a;
  return x=>lo+(Number.isFinite(span)?(x-a)/span:(x/2-a/2)/(b/2-a/2))*(hi-lo);
}
const name=g=>g.path.map(p=>p.text).join(' / ')||'Итого';
function treemap(items,x,y,w,h,draw) {
  if(items.length===1){draw(items[0],x,y,w,h);return;}
  const sum=items.reduce((n,item)=>n+item.value,0);
  let k=1,first=items[0].value;
  while(k<items.length-1 && first+items[k].value/2<sum/2){first+=items[k++].value;}
  const ratio=first/sum;
  if(w>=h){treemap(items.slice(0,k),x,y,w*ratio,h,draw);treemap(items.slice(k),x+w*ratio,y,w*(1-ratio),h,draw);}
  else{treemap(items.slice(0,k),x,y,w,h*ratio,draw);treemap(items.slice(k),x,y+h*ratio,w,h*(1-ratio),draw);}
}
export function chart(model,w,ctx) {
  const {fmt,t,choose}=ctx;
  const root=el('div','plot');
  const blank=msg=>{root.replaceChildren(el('p','empty',t(msg)));return root;};
  const title=w.title, kind=w.type;
  let height=204;
  let all=model.groups || [], data=all.filter(g=>Number.isFinite(g.value));
  if(kind==='bar'||kind==='funnel')height=Math.max(150,32+(data.length*26));
  const s=svg('svg',{viewBox:'0 0 520 '+height,role:'group','aria-label':title,'font-family':'Arial, sans-serif',class:'viz'});
  root.append(s);s.append(svg('title',{},title));
  const rect=(x,y,width,h,fill,rx=3)=>svg('rect',{x,y,width:Math.max(0,width),height:Math.max(0,h),fill,rx});
  const clickable=(n,g)=>{s.append(mark(n,name(g)+' · '+fmt(g.value),()=>choose(g)));};
  const legend=(entries)=>{
    const l=el('div','legend');
    entries.forEach(([caption,color])=>{const item=el('span');const dot=el('i');dot.style.backgroundColor=color;item.append(dot,document.createTextNode(caption));item.title=caption;l.append(item);});
    if(entries.length) root.append(l);
  };
  const axes=(min,max,y)=>{
    for(let i=0;i<=4;i++){const n=min*(1-i/4)+max*i/4;line(s,60,y(n),504,y(n));txt(s,53,y(n)+4,short(fmt(n),10),10,'end');}
  };
  if(kind==='kpi'||kind==='gauge'){
    if(model.total==null||!model.rows)return blank('Нет подходящих данных');
    if(kind==='kpi'){txt(s,20,116,short(fmt(model.total),28),54,'start',ink);return root;}
    if(!Number.isFinite(model.total))return blank('Требуется числовая мера');
    const arc=(color,fraction)=>{
      if(!fraction)return;
      const angle=Math.PI*(1-fraction);
      s.append(svg('path',{d:'M132 148 A128 128 0 0 1 '+(260+128*Math.cos(angle))+' '+(148-128*Math.sin(angle)),fill:'none',stroke:color,'stroke-width':20}));
    };
    arc(grid,1);arc(colors[0],Math.min(1,Math.max(0,model.total/w.goal)));
    txt(s,260,133,fmt(model.total),38,'middle',ink);txt(s,260,171,t('Цель')+' '+fmt(w.goal),14,'middle');return root;
  }
  if(kind==='scatter'){
    if(!model.points.length)return blank('Выберите две числовые колонки с совместными наблюдениями');
    const points=model.points, xs=points.map(p=>p.x),ys=points.map(p=>p.y);
    const min=Math.min(...ys),max=Math.max(...ys),x=scale(Math.min(...xs),Math.max(...xs),68,494),y=scale(min,max,164,18);
    axes(min,max,y);
    points.forEach(p=>s.append(mark(svg('circle',{cx:x(p.x),cy:y(p.y),r:4,fill:colors[0],opacity:.65}),fmt(p.x)+' × '+fmt(p.y),()=>choose({id:p.id}))));
    txt(s,65,191,fmt(Math.min(...xs)));txt(s,496,191,fmt(Math.max(...xs)),11,'end');
    legend([[w.x+' × '+w.y,colors[0]]]);
  } else if(kind==='box'){
    const b=model.box;if(!b)return blank('Выберите числовое поле с наблюдениями');
    const x=scale(Math.min(b.min,...b.outliers),Math.max(b.max,...b.outliers),42,480);
    line(s,x(b.min),92,x(b.max),92,colors[0],2);
    for(const n of [b.min,b.max])line(s,x(n),78,x(n),106,colors[0],2);
    s.append(mark(rect(x(b.q1),65,Math.max(2,x(b.q3)-x(b.q1)),54,colors[0]),'Q1–Q3: '+fmt(b.q1)+'–'+fmt(b.q3),
      ()=>choose({terms:[{field:model.field,low:b.q1,high:b.q3,inclusive:true}]})));
    line(s,x(b.median),65,x(b.median),119,'white',3);
    for(const n of b.outliers)s.append(mark(svg('circle',{cx:x(n),cy:92,r:3,fill:colors[3]}),fmt(n),()=>choose({terms:[{field:model.field,low:n,high:n,inclusive:true}]})));
    txt(s,260,154,t('Медиана')+' '+fmt(b.median)+'   ·   Q1 '+fmt(b.q1)+'   ·   Q3 '+fmt(b.q3),13,'middle');
    txt(s,260,177,t('Выбросы')+' '+fmt(b.outlierCount),12,'middle');
  } else if(kind==='heatmap'||kind==='stacked'){
    const rows=model.rows.filter(r=>r.path.length===1), cols=model.cols.filter(c=>c.path.length===1);
    if(!rows.length||!cols.length)return blank('Выберите два измерения');
    if(rows.length>w.limit||cols.length>16)return blank('Слишком много категорий. Уточните фильтр');
    const cells=rows.flatMap(r=>cols.map(c=>cellValue(model,r.key,c.key)));
    if(!cells.some(Number.isFinite))return blank('Требуется числовая мера');
    const magnitude=Math.max(1,...cells.filter(Number.isFinite).map(Math.abs));
    const maxStack=Math.max(0,...rows.map(r=>cols.reduce((sum,c)=>sum+Math.max(0,cellValue(model,r.key,c.key)||0),0)));
    const minStack=Math.min(0,...rows.map(r=>cols.reduce((sum,c)=>sum+Math.min(0,cellValue(model,r.key,c.key)||0),0)));
    const y=scale(minStack,maxStack,163,15);if(kind==='stacked')axes(minStack,maxStack,y);
    const dx=438/rows.length,dy=143/cols.length;
    rows.forEach((r,i)=>{
      let pos=0,neg=0;
      cols.forEach((c,j)=>{
        const v=cellValue(model,r.key,c.key);if(!Number.isFinite(v))return;
        let cell;
        if(kind==='heatmap'){
          cell=rect(65+i*dx,15+j*dy,dx-1,dy-1,v<0?colors[3]:colors[0],1);cell.setAttribute('opacity',.18+.82*Math.abs(v)/magnitude);
        }else{
          const from=v>=0?pos:neg,to=from+v;
          cell=rect(65+i*dx,Math.min(y(from),y(to)),dx*.73,Math.abs(y(to)-y(from)),colors[j%colors.length],1);
          if(v>=0)pos=to;else neg=to;
        }
        const picked={path:[...r.path,...c.path],value:v,terms:[...selection([w.dims[0]],r.path),...selection([w.dims[1]],c.path)]};
        clickable(cell,picked);
      });
      if(i%Math.max(1,Math.ceil(rows.length/6))===0)txt(s,65+(i+.4)*dx,187,short(r.path[0].text,10),10,'middle');
    });
    if(kind==='heatmap')cols.forEach((c,j)=>txt(s,61,19+(j+.5)*dy,short(c.path[0].text,9),9,'end'));
    else legend(cols.map((c,j)=>[c.path[0].text,colors[j%colors.length]]));
  } else {
    if(!data.length)return blank('Нет подходящих числовых данных');
    const positive=['pie','donut','treemap','funnel','pareto'].includes(kind);
    if(positive && (data.some(g=>g.value<0)||!data.some(g=>g.value>0)))return blank('Для этой диаграммы нужны неотрицательные значения с положительным итогом');
    const sum=data.reduce((n,g)=>n+g.value,0);
    if(positive&&!Number.isFinite(sum))return blank('Итог превышает числовой диапазон');
    const vals=data.map(g=>g.value), low=Math.min(0,...vals), high=Math.max(0,...vals);
    if(kind==='bar'||kind==='funnel'){
      if(kind==='funnel')data=data.slice().sort((a,b)=>b.value-a.value);
      const x=scale(low,high,163,458);
      data.forEach((g,i)=>{
        const y=12+i*26;
        txt(s,4,y+14,short(name(g),23),12,'start',ink);
        if(kind==='bar'){
          const x0=x(0),x1=x(g.value);
          clickable(rect(Math.min(x0,x1),y,Math.max(1,Math.abs(x1-x0)),17,g.value<0?colors[3]:colors[i%colors.length]),g);
        }else{
          const width=g.value/high*275;
          clickable(rect(310-width/2,y,width,21,colors[i%colors.length],1),g);
        }
        txt(s,507,y+14,short(fmt(g.value),13),12,'end',ink);
      });
    } else if(kind==='pie'||kind==='donut'){
      let start=-Math.PI/2;
      const cx=142,cy=102,r=86,inner=kind==='donut'?55:0;
      data.forEach((g,i)=>{
        if(!g.value)return;
        const delta=g.value/sum*2*Math.PI,end=start+Math.min(delta,Math.PI*2-.00001);
        const point=(a,rad)=>[cx+Math.cos(a)*rad,cy+Math.sin(a)*rad].join(' ');
        const large=delta>Math.PI?1:0;
        const d='M'+point(start,r)+' A'+r+' '+r+' 0 '+large+' 1 '+point(end,r)+
          (inner?' L'+point(end,inner)+' A'+inner+' '+inner+' 0 '+large+' 0 '+point(start,inner):' L'+cx+' '+cy)+' Z';
        clickable(svg('path',{d,fill:colors[i%colors.length],stroke:'var(--card)','stroke-width':2}),g);
        start+=delta;
      });
      if(inner){txt(s,cx,104,short(fmt(sum),11),27,'middle',ink);txt(s,cx,124,t('В выборке'),11,'middle');}
      const listed=data.slice(0,7);
      listed.forEach((g,i)=>{
        const yy=cy-(listed.length-1)*12+i*24;
        s.append(rect(258,yy-7,9,9,colors[i%colors.length],3));
        mark(txt(s,275,yy+2,short(name(g),20),12,'start',ink),name(g)+' · '+fmt(g.value),()=>choose(g));
        txt(s,505,yy+2,fmt(g.value/sum*100)+'%',12,'end');
      });
      if(data.length>7)legend(data.slice(7).map((g,i)=>[name(g),colors[(i+7)%colors.length]]));
    } else if(kind==='treemap'){
      treemap(data.filter(g=>g.value>0).sort((a,b)=>b.value-a.value),3,4,514,193,(g,x,y,width,h)=>{
        const i=data.indexOf(g);clickable(rect(x+1,y+1,width-2,h-2,colors[i%colors.length],2),g);
        if(width>47&&h>26){const text=txt(s,x+7,y+18,short(name(g),Math.floor(width/8)),11,'start','white');text.setAttribute('pointer-events','none');}
      });
    } else {
      if(kind==='pareto')data=data.slice().sort((a,b)=>b.value-a.value);
      const step=440/data.length,x=i=>61+step*(i+.5),y=scale(low,high||1,163,15);
      axes(low,high||1,y);
      const points=data.map((g,i)=>[x(i),y(g.value)]);
      const d=points.map((p,i)=>(i?'L':'M')+p.join(' ')).join(' ');
      if(kind==='line'||kind==='area'){
        if(kind==='area')s.append(svg('path',{d:d+' L'+x(data.length-1)+' '+y(0)+' L'+x(0)+' '+y(0)+' Z',fill:colors[0],opacity:.13}));
        s.append(svg('path',{d,fill:'none',stroke:colors[0],'stroke-width':3,'stroke-linejoin':'round'}));
        points.forEach(([cx,cy],i)=>clickable(svg('circle',{cx,cy,r:4,fill:colors[0],stroke:'var(--card)','stroke-width':1}),data[i]));
      }else{
        data.forEach((g,i)=>clickable(rect(x(i)-step*.37,Math.min(y(0),y(g.value)),step*.74,Math.max(1,Math.abs(y(0)-y(g.value))),colors[0],2),g));
        if(kind==='pareto'){
          let total=0;const path=data.map((g,i)=>{total+=g.value;return (i?'L':'M')+x(i)+' '+(163-148*total/sum);}).join(' ');
          s.append(svg('path',{d:path,fill:'none',stroke:colors[1],'stroke-width':2.5,'pointer-events':'none'}));
          legend([[t('Значение'),colors[0]],[t('Накопленная доля, 0–100 %'),colors[1]]]);
        }
      }
      data.forEach((g,i)=>{if(i%Math.max(1,Math.ceil(data.length/6))===0)txt(s,x(i),187,short(name(g),11),10,'middle');});
    }
  }
  if(model.omitted)root.append(el('small','hint',t('Скрыто из-за лимита')+' · '+fmt(model.omitted)));
  return root;
}
