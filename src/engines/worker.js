import {Dataset} from '../core/dataset.js';
let data;
const pending=new Map();
self.onmessage=async event=>{
  const {id,cmd,payload}=event.data;
  if(cmd==='cancel'){const job=pending.get(payload);if(job)job.cancelled=true;return;}
  const token={cancelled:false};pending.set(id,token);
  try{
    let value;
    if(cmd==='hello') value=true;
    else if(cmd==='begin') data=new Dataset(payload);
    else if(cmd==='append') data.append(payload);
    else if(cmd==='finish') value=data.finish();
    else value=await data.run(cmd,payload,token);
    self.postMessage({id,value});
  }catch(e){self.postMessage({id,error:e.message,name:e.name});}
  finally{pending.delete(id);}
};
