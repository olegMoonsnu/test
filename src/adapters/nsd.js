import {Studio} from '../components/studio.js';
import {config} from '../core/config.js';
import {check,plain} from '../utils/data.js';
let current;
function close(){if(current){current.dispose();current=null;}}
function split(options){
  check(plain(options),'Некорректная конфигурация');
  const {mount,onOpenObject,storageKey,persistFilterFields,worker,fullscreen,urlField,messages,nonce,...settings}=options;
  if(mount!=null)check(mount instanceof Element,'mount должен быть DOM-элементом');
  if(onOpenObject!=null)check(typeof onOpenObject==='function','Некорректный callback');
  const cfg=config(settings);
  return {cfg,host:{mount,onOpenObject,storageKey,persistFilterFields,worker,fullscreen,urlField,messages,nonce}};
}
async function launch(data,cfg,host){
  check(Array.isArray(data),'Ожидается массив объектов');
  close();
  const instance=new Studio(cfg,host,close);current=instance;
  try{await instance.load(data);return instance.closed?null:{count:instance.count,mode:instance.session.mode};}
  catch(e){if(instance.closed&&e.name==='AbortError')return null;instance.report(e);instance.shell.setAttribute('aria-busy','false');instance.session.dispose();throw e;}
}
const api=Object.freeze({
  version:'0.1.0',
  open(data,options={}){const {cfg,host}=split(options);return launch(data,cfg,host);},
  update(data){check(current,'Сначала откройте аналитику');return launch(data,current.exportConfig(),current.options);},
  close,destroy:close,
  exportConfig(){check(current,'Аналитика закрыта');return current.exportConfig();},
  importConfig(value){check(current?.columns,'Дождитесь загрузки данных');return current.importConfig(value);}
});
if(!window.NSDAnalytics || window.NSDAnalytics.version!==api.version)window.NSDAnalytics=api;
