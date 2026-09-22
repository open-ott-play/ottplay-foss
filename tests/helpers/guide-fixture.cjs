"use strict";
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),ts=require('typescript');
const root=path.resolve(__dirname,'../..');
exports.run=function(input,sourceFile=path.join(root,'src/channels/index.ts')) {
    const text=fs.readFileSync(sourceFile,'utf8'),ast=ts.createSourceFile('channels.ts',text,ts.ScriptTarget.Latest,true);
    const names=['epgCacheLimit','readEpgCache','cacheFetchedEpg','getLegacyGuideCache','syncGuideCacheOrder','setCurProg','applyChannelTvgShift'];
    const source=ast.statements.filter(node=>ts.isFunctionDeclaration(node)&&names.includes(node.name.text)).map(node=>node.getText(ast).replace(/^export\s+/, '')).join('\n');
    let now=0;
    const context=vm.createContext({Date:{now:()=>now},epgCacheCapacity:input.limit===undefined?2:input.limit,EPG_CACHE_TTL_MS:43200000,
        epg:{},epgCacheByChannel:{},epgCacheChannelOrder:[],epgCacheFetchedAt:{},legacyGuideCache:null,
        channels:JSON.parse(JSON.stringify(input.channels||{1:{},2:{},3:{}})),sNextCount:input.nextCount===undefined?1:input.nextCount});
    context.window=context;
    vm.runInContext(fs.readFileSync(path.join(root,'vendor/ottplay-core.js'),'utf8'),context);
    vm.runInContext(ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES5,module:ts.ModuleKind.None}}).outputText,context);
    const states=[];
    for(const action of input.actions){
        if(action.now!==undefined)now=action.now;
        const data=action.data===undefined?null:JSON.parse(JSON.stringify(action.data));let result=null,callbacks=[];
        if(action.type==='put')context.cacheFetchedEpg(action.id,data);
        else if(action.type==='read')result=context.readEpgCache(action.id);
        else if(action.type==='select')context.setCurProg(action.id,data,id=>callbacks.push(id));
        else if(action.type==='limit')context.epgCacheCapacity=action.value;
        else if(action.type==='shift')result=context.applyChannelTvgShift(action.channel,data);
        states.push(JSON.parse(JSON.stringify({result,callbacks,channels:context.channels,cache:context.epg,secondary:context.epgCacheByChannel,order:context.epgCacheChannelOrder})));
    }
    return states;
};
