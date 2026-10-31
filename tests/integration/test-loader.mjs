// Offline bridge harness only: minimal DSH types; no provider or platform is contacted.
const stubs={
 '@deepseek-ai/dsh-llm':'export const createUserMessage=x=>x;',
 '@deepseek-ai/dsh-session':'export const SessionId=x=>x;',
 '@deepseek-ai/dsh-tools':'export const defineTool=x=>x;',
 '@deepseek-ai/schemastery':"const p=new Proxy(function(){return p},{get(t,k){return k==='then'?undefined:p}});export default p;",
};
export function resolve(specifier,context,next){if(stubs[specifier])return {url:'data:text/javascript,'+encodeURIComponent(stubs[specifier]),shortCircuit:true};return next(specifier,context);}
