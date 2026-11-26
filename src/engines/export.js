import {LIMIT,check,label,field,dateMs} from '../utils/data.js';
export function csvCell(value,sep=',',clipboard=false) {
  if(value==null)return '""';
  if(typeof value==='number' && Number.isFinite(value))return String(value);
  let s=typeof value==='object'?label(value):String(value);
  if(/^[\u0000-\u0020\u00a0\ufeff]*[=+\-@\uFF1D\uFF0B\uFF0D\uFF20]/u.test(s) || /^[\t\r\n]/.test(s))s="'"+s;
  if(clipboard)s=s.replace(/[\t\r\n]+/g,' ');
  return '"'+s.replace(/"/g,'""')+'"';
}
export const escapeHtml=s=>String(s??'').replace(/[&<>"']/g,v=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[v]));
export const formats={csv:'text/csv',tsv:'text/tab-separated-values',json:'application/json',html:'text/html',svg:'image/svg+xml',png:'image/png'};
export function reportPage(title,body){
  return '<!doctype html><html lang="ru"><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src \'none\'; style-src \'unsafe-inline\'; img-src data:"><title>'+escapeHtml(title)+'</title><style>body{font:15px system-ui;color:#242532;margin:32px}table{border-collapse:collapse}td,th{border:1px solid #ddd;padding:6px;text-align:left}svg{width:min(100%,680px);display:block}section{break-inside:avoid}h1,h2{font-weight:600}</style><h1>'+escapeHtml(title)+'</h1>'+body+'</html>';
}
export function cellData(row,c) {
  const v=field(row,c.code);
  return c.type==='date'&&dateMs(v)!=null?new Date(dateMs(v)).toISOString():v;
}
export function encodeTable(headers, rows,format,title,clipboard=false){
  if(format==='json')return JSON.stringify(rows);
  if(format==='html'){
    const tag=(cells,t)=>'<tr>'+cells.map(v=>'<'+t+'>'+escapeHtml(v==null?'':label(v))+'</'+t+'>').join('')+'</tr>';
    return reportPage(title,'<table>'+tag(headers,'th')+rows.map(row=>tag(row,'td')).join('')+'</table>');
  }
  const sep=format==='csv'?';':'\t';
  return [headers,...rows].map(row=>row.map(v=>csvCell(v,sep,clipboard)).join(sep)).join('\r\n');
}
export async function exportRows(session,query,columns,format,title,token,clipboard=false) {
  const parts=[];let bytes=0;
  const encoder=new TextEncoder();
  function add(s){bytes+=encoder.encode(s).length;check(bytes<=LIMIT.exportBytes,'Экспорт превышает 32 МиБ. Сузьте выборку.');parts.push(s);}
  const sep=format==='csv'?';':'\t', tableRow=r=>'<tr>'+r.map(v=>'<td>'+escapeHtml(v==null?'':label(v))+'</td>').join('')+'</tr>';
  if(format==='json')add('[');
  else if(format==='html')add(reportPage(title,'<table><thead><tr>'+columns.map(c=>'<th>'+escapeHtml(c.title)+'</th>').join('')+'</tr></thead><tbody>').replace('</html>',''));
  else add((clipboard?'':'\ufeff')+columns.map(c=>csvCell(c.title,sep,clipboard)).join(sep));
  let start=0;
  do{
    const page=await session.run('page',{...query,start,limit:512},token);
    for(const item of page.items){
      if(format==='json'){add((start?',':'')+JSON.stringify(item.row));}
      else{
        const r=columns.map(c=>cellData(item.row,c));
        add(format==='html'?tableRow(r):'\r\n'+r.map(v=>csvCell(v,sep,clipboard)).join(sep));
      }
      start++;
    }
    if(start>=page.count)break;
  }while(true);
  if(format==='json')add(']');if(format==='html')add('</tbody></table></html>');
  return new Blob(parts,{type:formats[format]+';charset=utf-8'});
}
export function download(blob,name) {
  const url=URL.createObjectURL(blob),a=document.createElement('a');
  a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),2000);
}
export function svgText(node){
  const clone=node.cloneNode(true);
  const source=[node,...node.querySelectorAll('*')], copy=[clone,...clone.querySelectorAll('*')];
  for(let i=0;i<copy.length;i++){
    for(const attr of ['fill','stroke'])if(copy[i].getAttribute(attr)?.includes('var('))copy[i].setAttribute(attr,getComputedStyle(source[i])[attr]);
    for(const attr of ['tabindex','role','class'])copy[i].removeAttribute(attr);
  }
  const legend=node.parentElement?.querySelector('.legend');
  const box=node.viewBox.baseVal;
  if(legend){
    const ns='http://www.w3.org/2000/svg';
    const labels=[...legend.children];
    labels.forEach((entry,i)=>{
      const y=box.height+14+i*16;
      const dot=document.createElementNS(ns,'rect');
      for(const [k,v] of Object.entries({x:10,y:y-8,width:8,height:8,rx:2,fill:getComputedStyle(entry.querySelector('i')).backgroundColor}))dot.setAttribute(k,String(v));
      const text=document.createElementNS(ns,'text');
      text.setAttribute('x','24');text.setAttribute('y',String(y));text.setAttribute('font-size','11');
      text.setAttribute('fill',getComputedStyle(entry).color);text.textContent=entry.textContent.slice(0,80);clone.append(dot,text);
    });
    clone.setAttribute('viewBox','0 0 '+box.width+' '+(box.height+labels.length*16+5));
  }
  clone.setAttribute('width',String(box.width));clone.setAttribute('height',clone.getAttribute('viewBox').split(/\s+/)[3]);
  return new XMLSerializer().serializeToString(clone);
}
export async function pngBlob(node){
  const url=URL.createObjectURL(new Blob([svgText(node)],{type:formats.svg}));
  try{
    const img=new Image();img.src=url;await img.decode();
    const c=document.createElement('canvas');c.width=img.width*2;c.height=img.height*2;
    const ctx=c.getContext('2d');ctx.fillStyle=getComputedStyle(node.closest('.widget')||node).backgroundColor;ctx.fillRect(0,0,c.width,c.height);
    ctx.drawImage(img,0,0,c.width,c.height);return await new Promise((resolve,reject)=>c.toBlob(b=>b?resolve(b):reject(new Error('Не удалось создать PNG')),'image/png'));
  }finally{URL.revokeObjectURL(url);}
}
