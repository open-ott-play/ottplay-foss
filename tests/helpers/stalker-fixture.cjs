"use strict";
const {context,declarations}=require('./playlist-fixture.cjs'),vm=require('node:vm');
exports.run=function(input){
    const ctx=context(),calls=[];
    Object.assign(ctx,{stalker:input.config || {portal:'https://portal.test/',mac:'00:1a:79:01:02:03'},loadStalkerParams(){},launch_id:'#launch',checkProviderUrl:()=>true,editStalkerSettings:()=>calls.push({settings:true}),alert:value=>ctx.errors.push(value),Date:{now:()=>1767225600500}});
    ctx.$=()=>({append(){}});
    ctx.$.ajax=request=>{
        const reply=input.responses[calls.length];calls.push({url:request.url,data:JSON.parse(request.data),method:request.type,timeout:request.timeout});
        if(calls.length>15)throw Error('Fixture request overflow');
        return {done(callback){callback(reply);return this;},fail(){return this;}};
    };
    vm.runInContext(declarations('prov/stalker/prov.js').filter(row=>['getChanelsArray','loadChannelsFromStalker','stalkerApiCall','addChan2cat','getEPGchanel','stalkerCore'].includes(row.name)).map(row=>row.text).join('\n'),ctx);
    let epg;
    ctx.getChanelsArray(()=>ctx.callbacks++);
    if(input.guide && ctx.cList.length)ctx.getEPGchanel(ctx.cList[0],(id,data)=>{epg={id,data};});
    return JSON.parse(JSON.stringify({calls,ids:ctx.cList,channels:ctx.chanels,groups:ctx.cats,groupOrder:ctx.catsArray,errors:ctx.errors,callbacks:ctx.callbacks,epg}));
};
