import { LAYOUT_STORAGE_KEYS } from '../../shared/storage-keys.js';
import { clone, uid, readProject, exampleProject } from './model.js';
const titleOf=s=>{if(typeof s!=='string'||!s.trim()||s.trim().length>100)throw new Error('名称需为 1–100 个字符');return s.trim();};
export const filename=(name,extension='json')=>`${name.replace(/[\\/:*?"<>|\u0000-\u001f]/g,'-').replace(/[. ]+$/,'')||'配线方案'}.${extension}`;
export class LayoutFiles{
  constructor(storage){
    this.storage=storage;this.warning='';this.raw=storage.getItem(LAYOUT_STORAGE_KEYS.workspace);this.recovery=null;
    if(this.raw)try{
      const s=JSON.parse(this.raw);if(s.version!==1||!Array.isArray(s.files)||s.files.length>120||!s.files.some(f=>!f.deletedAt)||new Set(s.files.map(f=>f.id)).size!==s.files.length)throw new Error();
      for(const f of s.files){if(typeof f.id!=='string'||!/^[\w-]{1,100}$/.test(f.id)||!Number.isFinite(Date.parse(f.updatedAt))||f.deletedAt&&!Number.isFinite(Date.parse(f.deletedAt)))throw new Error();titleOf(f.title);f.project=readProject(f.project);}
      if(!s.files.some(f=>f.id===s.activeId&&!f.deletedAt))s.activeId=s.files.find(f=>!f.deletedAt).id;this.data=s;return;
    }catch{this.recovery=this.raw;this.warning='方案库读取失败，原数据会保存在恢复备份中。';}
    const f=this.makeFile('中央站配线示意',exampleProject());this.data={version:1,activeId:f.id,files:[f]};
  }
  makeFile(title,project){return {id:uid(),title:titleOf(title),project:readProject(project),updatedAt:new Date().toISOString()};}
  get current(){return clone(this.data.files.find(f=>f.id===this.data.activeId&&!f.deletedAt));}
  list(trash=false){return clone(this.data.files.filter(f=>!!f.deletedAt===trash).sort((a,b)=>(b.deletedAt||b.updatedAt).localeCompare(a.deletedAt||a.updatedAt)));}
  unique(title){const base=titleOf(title);let s=base,i=2;while(this.data.files.some(f=>!f.deletedAt&&f.title===s))s=base.slice(0,92)+` (${i++})`;return s;}
  change(action){
    const next=clone(this.data);action(next);
    if(this.storage.getItem(LAYOUT_STORAGE_KEYS.workspace)!==this.raw)throw new Error('方案已在其他窗口更新，请先下载 JSON 再刷新。');
    try{if(this.recovery)this.storage.setItem(LAYOUT_STORAGE_KEYS.recovery,this.recovery);const raw=JSON.stringify(next);this.storage.setItem(LAYOUT_STORAGE_KEYS.workspace,raw);this.raw=raw;}
    catch{throw new Error('浏览器保存失败，请下载 JSON 备份。');}
    this.recovery=null;this.data=next;return this.current;
  }
  save(project){const valid=readProject(project);return this.change(s=>{const f=s.files.find(f=>f.id===s.activeId);valid.updatedAt=new Date().toISOString();f.project=valid;f.updatedAt=valid.updatedAt;});}
  create(title,project){if(this.data.files.length>=120)throw new Error('方案库已达 120 个，请先导出备份。');const f=this.makeFile(this.unique(title),project);return this.change(s=>{s.files.push(f);s.activeId=f.id;});}
  open(id){if(!this.list().some(f=>f.id===id))throw new Error('找不到该方案');return this.change(s=>s.activeId=id);}
  rename(id,title){title=titleOf(title);if(this.list().some(f=>f.id!==id&&f.title===title))throw new Error('已有同名方案');return this.change(s=>{const f=s.files.find(f=>f.id===id);if(!f)throw new Error('找不到该方案');f.title=title;f.updatedAt=new Date().toISOString();});}
  trash(id){if(this.list().length<=1)throw new Error('请至少保留一个方案');return this.change(s=>{const f=s.files.find(f=>f.id===id&&!f.deletedAt);if(!f)throw new Error('找不到该方案');f.deletedAt=new Date().toISOString();if(s.activeId===id)s.activeId=s.files.find(f=>!f.deletedAt).id;});}
  restore(id){const file=this.list(true).find(f=>f.id===id);if(!file)throw new Error('找不到该方案');const title=this.unique(file.title);return this.change(s=>{const f=s.files.find(f=>f.id===id);delete f.deletedAt;f.title=title;});}
}
