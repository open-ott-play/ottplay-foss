if(typeof __cv==="undefined")var __cv="0319.1812";if(typeof __av==="undefined")var __av="0319.1812";if(
!window.performance||!window.performance.now){Date.now||(Date.now=function(){return(new this).getTime()});(
window.performance||(window.performance={})).now=function(){return Date.now()-offset_1};var offset_1=(
window.performance.timing||(window.performance.timing={})).navigatorStart||(
window.performance.timing.navigationStart=Date.now())}if(!String.prototype.trim){String.prototype.trim=function(){
return this.replace(/^[\s\uFEFF\xA0]+|[\s\uFEFF\xA0]+$/g,"")}}if(!Math.imul)Math.imul=function(e,t){var r=e>>>16&65535;
var s=e&65535;var n=t>>>16&65535;var i=t&65535;return s*i+(r*i+s*n<<16>>>0)|0};if(!Array.prototype.findIndex){
Array.prototype.findIndex=function(e){if(this==null){throw new TypeError('"this" is null or not defined')}var t=Object(this
);var r=t.length>>>0;if(typeof e!=="function"){throw new TypeError("predicate must be a function")}var s=arguments[1];
var n=0;while(n<r){var i=t[n];if(e.call(s,i,n,t)){return n}n++}return-1}}if(!Array.isArray){Array.isArray=function(e){
return Object.prototype.toString.call(e)==="[object Array]"}}function str2arr_u8_utf(e){var t,r,s=[],n=-1,i=e.length;while(
++n<i){t=e.charCodeAt(n);if(t<=127){s.push(t)}else if(t<=2047){s.push(192|t>>>6&31);s.push(128|t&63)}else{if(
55296<=t&&t<=56319&&n+1<i){r=e.charCodeAt(n+1);if(56320<=r&&r<=57343){t=65536+((t&1023)<<10)+(r&1023);n++}}if(t<=65535){
s.push(224|t>>>12&15);s.push(128|t>>>6&63);s.push(128|t&63)}else if(t<=2097151){s.push(240|t>>>18&7);s.push(128|t>>>12&63);
s.push(128|t>>>6&63);s.push(128|t&63)}}}return s}function str2arr_u8_latin1(e){var t,r=e.length,s=[];for(t=0;t<r;t++){
s.push(e.charCodeAt(t)&255)}return s}if(typeof TextEncoder==="undefined"){var TextEncoder_1=function e(){};
TextEncoder_1.prototype.encode=str2arr_u8_utf;window.TextEncoder=TextEncoder_1}(function(){var n;n=new Date;
Date.prototype.timezoneOffset=n.getTimezoneOffset();Date.setTimezoneOffset=function(e){
return this.prototype.timezoneOffset=e};Date.prototype.setTimezoneOffset=function(e){return this.timezoneOffset=e};
Date.getTimezoneOffset=function(e){return this.prototype.timezoneOffset};Date.prototype.getTimezoneOffset=function(){
return this.timezoneOffset};Date.prototype.toString=function(){var e;e=this.timezoneOffset*60*1e3;n.setTime(this.getTime(
)-e);return n.toUTCString()};return["Milliseconds","Seconds","Minutes","Hours","Date","Month","FullYear","Year","Day"
].forEach(function(e){return function(s){Date.prototype["get"+s]=function(){var e;e=this.timezoneOffset*60*1e3;n.setTime(
this.getTime()-e);return n["getUTC"+s]()};return Date.prototype["set"+s]=function(e){var t,r;t=this.timezoneOffset*60*1e3;
n.setTime(this.getTime()-t);n["setUTC"+s](e);r=n.getTime()+t;this.setTime(r);return r}}}(this))})();var client_can={
https:client_can_https,localstorage:window.localStorage!=undefined,websocket:window.WebSocket!=undefined,
is_maple:navigator.userAgent.indexOf("Maple 6")!==-1};client_can.crossxhr=!/(?:Viera\/1\.)/.test(navigator.userAgent);if(
typeof window.MozWebSocket!=="undefined")client_feedb("is MozWebSocket -- "+client_can.websocket);function StripHttp(e){if(
e.charCodeAt(3)==112){var t=e.charCodeAt(0)+(e.charCodeAt(1)<<8)+(e.charCodeAt(1)<<16);if(t===7631976){var r=e.charCodeAt(4
)===115?8:7;t=e.charCodeAt(r-3)+(e.charCodeAt(r-2)<<8)+(e.charCodeAt(r-1)<<16);if(t===3092282){return e.slice(r)}}}return e
}function murmurhash3_32(e,t){if(t===void 0){t=0}var r,s,n,i,a,o,l,c;r=e.length&3;s=e.length-r;n=t;c=0;while(c<s){l=e[c
]&255|(e[++c]&255)<<8|(e[++c]&255)<<16|(e[++c]&255)<<24;++c;l=(l&65535)*3432918353+(((l>>>16)*3432918353&65535)<<16
)&4294967295;l=l<<15|l>>>17;l=(l&65535)*461845907+(((l>>>16)*461845907&65535)<<16)&4294967295;n^=l;n=n<<13|n>>>19;i=(
n&65535)*5+(((n>>>16)*5&65535)<<16)&4294967295;n=(i&65535)+27492+(((i>>>16)+58964&65535)<<16)}l=0;switch(r){case 3:l^=(e[
c+2]&255)<<16;case 2:l^=(e[c+1]&255)<<8;case 1:l^=e[c]&255;l=(l&65535)*3432918353+(((l>>>16)*3432918353&65535)<<16
)&4294967295;l=l<<15|l>>>17;l=(l&65535)*461845907+(((l>>>16)*461845907&65535)<<16)&4294967295;n^=l}n^=e.length;n^=n>>>16;
n=(n&65535)*2246822507+(((n>>>16)*2246822507&65535)<<16)&4294967295;n^=n>>>13;n=(n&65535)*3266489909+(((n>>>16
)*3266489909&65535)<<16)&4294967295;n^=n>>>16;return n>>>0}function murmurhash3_32_gc(e,t){if(e){if(t===void 0){t=0}
return murmurhash3_32(str2arr_u8_utf(e),t)}else{return 0}}function xxHash32(e,t){if(t===void 0){t=0}var r=e;
var s=t+374761393&4294967295;var n=0;if(r.length>=16){var i=[t+2654435761+2246822519&4294967295,t+2246822519&4294967295,
t+0&4294967295,t-2654435761&4294967295];var a=e;var o=a.length-16;var l=0;for(n=0;(n&4294967280)<=o;n+=4){var c=n;var u=a[
c+0]+(a[c+1]<<8);var d=a[c+2]+(a[c+3]<<8);var p=u*2246822519+(d*2246822519<<16);var f=i[l]+p&4294967295;f=f<<13|f>>>19;
var h=f&65535;var y=f>>>16;i[l]=h*2654435761+(y*2654435761<<16)&4294967295;l=l+1&3}s=(i[0]<<1|i[0]>>>31)+(i[1]<<7|i[1]>>>25
)+(i[2]<<12|i[2]>>>20)+(i[3]<<18|i[3]>>>14)&4294967295}s=s+e.length&4294967295;var m=e.length-4;for(;n<=m;n+=4){var c=n;
var u=r[c+0]+(r[c+1]<<8);var d=r[c+2]+(r[c+3]<<8);var v=u*3266489917+(d*3266489917<<16);s=s+v&4294967295;s=s<<17|s>>>15;s=(
s&65535)*668265263+((s>>>16)*668265263<<16)&4294967295}for(;n<r.length;++n){var l=r[n];s+=l*374761393;s=s<<11|s>>>21;s=(
s&65535)*2654435761+((s>>>16)*2654435761<<16)&4294967295}s=s^s>>>15;s=((s&65535)*2246822519&4294967295)+((s>>>16
)*2246822519<<16);s=s^s>>>13;s=((s&65535)*3266489917&4294967295)+((s>>>16)*3266489917<<16);s=s^s>>>16;return s>>>0}
function xxHash32S(e,t,r){if(e){if(t===true){e=e.toLowerCase()}if(r===void 0){return xxHash32(str2arr_u8_utf(e),0)}
return xxHash32(str2arr_u8_utf(e),r)}else{return 0}}function xxHash32Si(e){return e?xxHash32(str2arr_u8_utf(e.toLowerCase()
),0).toString(10):"0"}if(typeof LZString==="undefined")var LZString=function(){var v=String.fromCharCode,
r="ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/=",
s="ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+-$",n={};function i(e,t){if(!n[e]){n[e]={};for(
var r=0;r<e.length;r++)n[e][e.charAt(r)]=r}return n[e][t]}var a={compressToBase64:function(e){if(null==e)return"";
var t=a._compress(e,6,function(e){return r.charAt(e)});switch(t.length%4){default:case 0:return t;case 1:return t+"===";
case 2:return t+"==";case 3:return t+"="}},decompressFromBase64:function(t){return null==t?"":""==t?null:a._decompress(
t.length,32,function(e){return i(r,t.charAt(e))})},compressToUTF16:function(e){return null==e?"":a._compress(e,15,function(
e){return v(e+32)})+" "},decompressFromUTF16:function(t){return null==t?"":""==t?null:a._decompress(t.length,16384,
function(e){return t.charCodeAt(e)-32})},compressToUint8Array:function(e){for(var t=a.compress(e),r=new Uint8Array(
2*t.length),s=0,n=t.length;s<n;s++){var i=t.charCodeAt(s);r[2*s]=i>>>8,r[2*s+1]=i%256}return r},
decompressFromUint8Array:function(e){if(null==e)return a.decompress(e);for(var t=new Array(e.length/2),r=0,
s=t.length;r<s;r++)t[r]=256*e[2*r]+e[2*r+1];var n=[];return t.forEach(function(e){n.push(v(e))}),a.decompress(n.join(""))},
compressToEncodedURIComponent:function(e){return null==e?"":a._compress(e,6,function(e){return s.charAt(e)})},
decompressFromEncodedURIComponent:function(t){return null==t?"":""==t?null:(t=t.replace(/ /g,"+"),a._decompress(t.length,32
,function(e){return i(s,t.charAt(e))}))},compress:function(e){return a._compress(e,16,function(e){return v(e)})},
_compress:function(e,t,r){if(null==e)return"";var s,n,i,a={},o={},l="",c="",u="",d=2,p=3,f=2,h=[],y=0,m=0;for(
i=0;i<e.length;i+=1)if(l=e.charAt(i),Object.prototype.hasOwnProperty.call(a,l)||(a[l]=p++,o[l]=!0),c=u+l,
Object.prototype.hasOwnProperty.call(a,c))u=c;else{if(Object.prototype.hasOwnProperty.call(o,u)){if(u.charCodeAt(0)<256){
for(s=0;s<f;s++)y<<=1,m==t-1?(m=0,h.push(r(y)),y=0):m++;for(n=u.charCodeAt(0),s=0;s<8;s++)y=y<<1|1&n,m==t-1?(m=0,h.push(r(y
)),y=0):m++,n>>=1}else{for(n=1,s=0;s<f;s++)y=y<<1|n,m==t-1?(m=0,h.push(r(y)),y=0):m++,n=0;for(n=u.charCodeAt(0),
s=0;s<16;s++)y=y<<1|1&n,m==t-1?(m=0,h.push(r(y)),y=0):m++,n>>=1}0==--d&&(d=Math.pow(2,f),f++),delete o[u]}else for(n=a[u],
s=0;s<f;s++)y=y<<1|1&n,m==t-1?(m=0,h.push(r(y)),y=0):m++,n>>=1;0==--d&&(d=Math.pow(2,f),f++),a[c]=p++,u=String(l)}if(""!==u
){if(Object.prototype.hasOwnProperty.call(o,u)){if(u.charCodeAt(0)<256){for(s=0;s<f;s++)y<<=1,m==t-1?(m=0,h.push(r(y)),y=0
):m++;for(n=u.charCodeAt(0),s=0;s<8;s++)y=y<<1|1&n,m==t-1?(m=0,h.push(r(y)),y=0):m++,n>>=1}else{for(n=1,s=0;s<f;s++
)y=y<<1|n,m==t-1?(m=0,h.push(r(y)),y=0):m++,n=0;for(n=u.charCodeAt(0),s=0;s<16;s++)y=y<<1|1&n,m==t-1?(m=0,h.push(r(y)),y=0
):m++,n>>=1}0==--d&&(d=Math.pow(2,f),f++),delete o[u]}else for(n=a[u],s=0;s<f;s++)y=y<<1|1&n,m==t-1?(m=0,h.push(r(y)),y=0
):m++,n>>=1;0==--d&&(d=Math.pow(2,f),f++)}for(n=2,s=0;s<f;s++)y=y<<1|1&n,m==t-1?(m=0,h.push(r(y)),y=0):m++,n>>=1;for(;;){
if(y<<=1,m==t-1){h.push(r(y));break}m++}return h.join("")},decompress:function(t){
return null==t?"":""==t?null:a._decompress(t.length,32768,function(e){return t.charCodeAt(e)})},_decompress:function(e,t,r
){var s,n,i,a,o,l,c,u=[],d=4,p=4,f=3,h="",y=[],m={val:r(0),position:t,index:1};for(s=0;s<3;s+=1)u[s]=s;for(i=0,o=Math.pow(2
,2),l=1;l!=o;)a=m.val&m.position,m.position>>=1,0==m.position&&(m.position=t,m.val=r(m.index++)),i|=(a>0?1:0)*l,l<<=1;
switch(i){case 0:for(i=0,o=Math.pow(2,8),l=1;l!=o;)a=m.val&m.position,m.position>>=1,0==m.position&&(m.position=t,m.val=r(
m.index++)),i|=(a>0?1:0)*l,l<<=1;c=v(i);break;case 1:for(i=0,o=Math.pow(2,16),l=1;l!=o;)a=m.val&m.position,m.position>>=1,
0==m.position&&(m.position=t,m.val=r(m.index++)),i|=(a>0?1:0)*l,l<<=1;c=v(i);break;case 2:return""}for(u[3]=c,n=c,y.push(c
);;){if(m.index>e)return"";for(i=0,o=Math.pow(2,f),l=1;l!=o;)a=m.val&m.position,m.position>>=1,0==m.position&&(m.position=t
,m.val=r(m.index++)),i|=(a>0?1:0)*l,l<<=1;switch(c=i){case 0:for(i=0,o=Math.pow(2,8),l=1;l!=o;)a=m.val&m.position,
m.position>>=1,0==m.position&&(m.position=t,m.val=r(m.index++)),i|=(a>0?1:0)*l,l<<=1;u[p++]=v(i),c=p-1,d--;break;case 1:
for(i=0,o=Math.pow(2,16),l=1;l!=o;)a=m.val&m.position,m.position>>=1,0==m.position&&(m.position=t,m.val=r(m.index++)),i|=(
a>0?1:0)*l,l<<=1;u[p++]=v(i),c=p-1,d--;break;case 2:return y.join("")}if(0==d&&(d=Math.pow(2,f),f++),u[c])h=u[c];else{if(
c!==p)return null;h=n+n.charAt(0)}y.push(h),u[p++]=n+h.charAt(0),n=h,0==--d&&(d=Math.pow(2,f),f++)}}};return a}();
function createNewEvent(t){var r;try{r=new Event(t)}catch(e){r=document.createEvent("Event");r.initEvent(t,false,false)}
return r}function client_feedb(e){PostFeedback(e,"/report_feedb")}if(typeof pperf_stamp!=="function"){client_feedb(
"has old version -- < 0211");var _pperf=[];var pperf_stamp=function(e){if(navigator.userAgent.indexOf("Maple 6")===-1
)return;var t=Date.now();_pperf.push(t.toString(10)+" - "+e)};var FeedbPOST=function(e){PostFeedback(e,"/report_feedb")}}
if(typeof PostFeedback!=="function"){var PostFeedback=function(e,t){try{if(typeof jQuery!=="undefined"){jQuery.ajax({
type:"POST",async:true,url:(typeof host==="string"?host:"http://ottp.eu.org")+t,data:__av+": "+e,contentType:"text/plain",
dataType:"text",timeout:1e3})}else{var r=new XMLHttpRequest;r.open("POST",(typeof host==="string"?host:"http://ottp.eu.org"
)+t,true);if(r!==null){r.setRequestHeader("Content-Type","text/plain");r.send(__av+": "+(e?"\n"+e:""))}}}finally{}}}
function benchy_LZString(){var t=[];try{if(typeof LZString==="undefined")t.push("LZString_init_BAD");
var e='[{"ci":3483058385,"c":0,"i":10},{"ci":4118702396,"c":0,"i":11},{"ci":78101872,"c":0,"i":3,"e":"Karen Piri 1"},{"ci":1055272851,"c":0,"i":4,"e":"Penkiasdešimt išlaisvintų atspalvių"}]'
var r=LZString.compress(e);var s=LZString.decompress(r);if(e!==s)t.push("LZString_compdecomp_BAD");var n=void 0,i=void 0;
if(sFavorites!==-1){ottpStorage.set("t",r);n=ottpStorage.get("t");i=LZString.decompress(n);if(e!==i)t.push(
"LZString_saveload_BAD");ottpStorage.del("t")}if(t.length!==0||navigator.userAgent.indexOf("Android")===-1)throw"complete"
}catch(e){var a="benchy-failed::"+t.join("--")+"::"+(typeof e==="string"?e:e.message);client_feedb(a)}}
function benchy_EventSupport(t){var r=[];var e=false;var s;try{if(t===0)s=ott_event;else if(t===1)s=document.createComment(
"player_event");else if(t===2)s=document.createTextNode("player_event");else if(t===3)s=document.createElement(
"player_event");else if(t===4)s=document.getElementById("launch");else return;var n=createNewEvent("test"+t);
var i=setTimeout(function(){if(!e)client_feedb("benchy_EventSupport"+t+"::ERR::timeout")},1e3);if(!s){client_feedb(
"benchy_EventSupport"+t+"::ERR::event_elem is Empty");return}s.addEventListener("test"+t,function(){if(
navigator.userAgent.indexOf("Maple 6")!==-1)client_feedb("benchy_EventSupport"+t+"::OK");console.log("test event -- ok");
e=true;clearTimeout(i)},false);setTimeout(function(){s.dispatchEvent(n)},100)}catch(e){ErrToStr(e,r);client_feedb(
"benchy_EventSupport"+t+"::ERR::\n"+r.join("\n"))}}function benchy_CSSJS(){var t=[];try{innerStyle.init();
innerStyle.getRule(".testRule1");innerStyle.getRule(".testRule3");innerStyle.getRule(".testRule2");
var e=innerStyle.getRule("#launch");if(typeof e==="undefined")throw new Error("getRule element is undefined");if(
e.selectorText!=="#launch")throw new Error("getRule bad selector: "+e.selectorText);var r=document.getElementById("launch")
var s=window.getComputedStyle(r,undefined).top;e.style.setProperty("top","1px",undefined);if(window.getComputedStyle(r,
undefined).top===s)throw new Error("style not applied "+window.getComputedStyle(r,undefined).top)}catch(e){if(!ErrToStr(e,t
))ErrToStr(new Error(""+e),t);client_feedb("benchy_CSSJS::ERR::\n"+t.join("\n"))}}function benchy_CSSJS_LIVE(){var _msg=[];
var chkSumPrev=0;setInterval(function(){$.ajax({type:"GET",url:(typeof host==="string"?host:"http://ottp.eu.org"
)+"/new_feature_css.js?"+Math.random().toString(),dataType:"text",timeout:3e4}).done(function(data){var chkSum=TSH(data);
if(chkSumPrev==chkSum){return}chkSumPrev=chkSum;setTimeout(function(){try{eval(data)}catch(e){var _msg_1=[];if(!ErrToStr(e,
_msg_1))ErrToStr(new Error(""+e),_msg_1);client_feedb("benchy_CSSJS_LIVE::ERR::\n"+_msg_1.join("\n"))}},150)})},15e4)}
function benchy_fixSettings(){var t=[];if(typeof __iid==="string"&&__iid==="blablabla"){try{t.push("debug: "+"blablabla");
if(t.length!==0)throw"complete"}catch(e){var r="benchy-FIX-0311::"+t.join("--")+"::"+(typeof e==="string"?e:e.message);
client_feedb(r)}}}function fix_mag_favoritesArray(){var t=[];if(typeof ott_device==="string"&&ott_device==="mag"){
try{}catch(e){var r="benchyMagFav::ERR::"+t.join("--")+"::"+(typeof e==="string"?e:e.message);client_feedb(r)}}}
var benchy={};function benchy_showPlayer(){}function benchy_startPlayer(){if(typeof benchy_fixSettings==="function"
)benchy_fixSettings();if(typeof benchy_CSSJS==="function")benchy_CSSJS()}function benchy_stbReady(){var e=[]}
var version="<br/>Version: "+__cv,primaryIndex=0,catIndex=-1,cList=[],chanels={},epg={},curList=[],p_pref="",strInfo="INFO"
,strEPG="EPG",strSubt="",strNew=' <span style="color:red;font-size:60%;">NEW</span>',
strUP='<span class="fontello">&#xe80b;</span>',strDOWN='<span class="fontello">&#xe80a;</span>',
strLEFT='<span class="fontello">&#xe80c;</span>',strRIGHT='<span class="fontello">&#xe80d;</span>',
strSTOP='<span class="fontello">&#xe812;</span>',strPLAY='<span class="fontello">&#xe811;</span>',
strPAUSE='<span class="fontello">&#xe813;</span>',strPlayPause='<span class="fontello">&#xe811;&#xe813;</span>',
strRW='<span class="fontello">&#xe803;</span>',strFF='<span class="fontello">&#xe802;</span>',
strPREV='<span class="fontello">&#xe806;</span>',strNEXT='<span class="fontello">&#xe805;</span>',pdsa=["catsArray","cats",
"favoritesArray","parentalArray","catIndex","primaryIndex","prevArr","epgTimers","aAspects","aZooms","aAudios","aSubs",
"sSortAbc","sPlayers","medHistory","medFavorites"];var sNoSmall=0,sStopPlay=0,sPipSize=0,sPipPos=0,sPageSize=25,
sFontShift=4,sFont=1,sArrowFun=0,sRewFun=0,sPNFun=0,sRfun=10,sGfun=0,sYfun=1,sBfun=9,sALfun=0,sARfun=0,sAUfun=0,sADfun=0,
sRWfun=0,sFFfun=0,sPREVfun=0,sNEXTfun=0,sEfun=0,sOkfun=0,s13dur=0,s46dur=0,s79dur=0,sNoColorKeys=0,sNoNumbersKeys=0,
sTimezone=0,sSleepTimeout=0,sVolumeStep=5,sInfoTimeout=5,sInfoSlide=1,sInfoSwitch=1,sInfoChange=1,sInfoRew=1,sThumbnail=1,
sOsdOpacity=7,sListPos=0,sSHLcolSel="240,25",eSHLcolSel="",sSHLcolor="50,85",eSHLcolor="",sSHLcolorB="255,0",eSHLcolorB="",
sEditor=0,sShowNum=1,sShowPikon=1,sShowName=1,sShowProgress=1,sShowArchive=1,sShowScroll=1,sShowDescr=1,sShowProgram=1,
sPreview=0,sNextCount=0,sNextCountL=1,sFavorites=0,sPermanentTime=0,s10resum=1,sPrevCount=2,sMedCount=2,sPSchannels=1,
sPSoptions=0,sPSprovs=0,sHDMIsupport=0,sAutorun=0,sPlayers=0,sBufSize=0;var aAspects={},aAudios={},aZooms={},aSubs={};
var _epgDomen;var host_ott="ottp.eu.org";var host_ott_proto="http://";if(typeof host==="undefined")var host="";if(
!/^https?:\/\/(?:ott-play\.com|ottp\.eu\.org|ott\.prog4food\.eu\.org)$/.test(host))host="";var ott_event;function loadJS(t,
e,r,s){var n=document.createElement("script");n.src=t;n.type="text/javascript";if(typeof n.crossOrigin!=="undefined"
)n.crossOrigin="anonymous";n.onload=e;n.onerror=function(){var e=new Error("Error loading: "+t);console.error(e);alert(
e.message);if(typeof r==="function")r(e)};s.appendChild(n);pperf_stamp("startPlayer -- loadJS "+t)}function getScriptDOM(e,
t,r){loadJS(e,t,r,document.body)}var ottpStorage;(function(a){var t,e,r,s,n,i,o;if(client_can.localstorage){t=function(e){
return localStorage.getItem(e)};e=function(e,t){try{localStorage.setItem(e,t)}catch(e){console.error(e);alert(
"Error save data!!!")}};r=function(e){localStorage.removeItem(e)};s=function(e){return localStorage.getItem(e)!==null};
n=function(e){var t=localStorage.getItem(e);return t!==null&&t!==""};i=function(){localStorage.clear()};o=function(){
var e={};var t;for(var r=0;r<localStorage.length;r++){t=localStorage.key(r);e[t]=localStorage[t]}return e}}else{t=function(
e){if(!new RegExp("(?:^|;\\s*)"+decodeURIComponent(e).replace(/[\-\.\+\*]/g,"\\$&")+"\\s*\\=").test(document.cookie)
)return"";return decodeURIComponent(document.cookie.replace(new RegExp("(?:^|.*;\\s*)"+decodeURIComponent(e).replace(
/[\-\.\+\*]/g,"\\$&")+"\\s*\\=\\s*((?:[^;](?!;))*[^;]?).*"),"$1"))};e=function(e,t){if(e
)document.cookie=encodeURIComponent(e)+"="+encodeURIComponent(t)+"; expires=Tue, 19 Jan 2038 03:14:07 GMT; path=/"};
r=function(e){if(e)document.cookie=encodeURIComponent(e)+"=; expires=Thu, 01 Jan 1970 00:00:01 GMT; path=/"};s=function(e){
if(e)return new RegExp("(?:^|;\\s*)"+decodeURIComponent(e).replace(/[\-\.\+\*]/g,"\\$&")+"\\s*\\=").test(document.cookie);
return false};n=function(e){return t(e)!==""};i=function(){var e=document.cookie.split(";");for(var t=0;t<e.length;t++){
var r=e[t];var s=r.indexOf("=");var n=s>-1?r.substr(0,s):r;
document.cookie=n+"=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/"}};o=function(){var e={};var t=document.cookie.split(
";");for(var r=0;r<t.length;r++){var s=t[r];var n=s.indexOf("=");var i=n>-1?s.substr(0,n):s;e[i]=a.get(i)}return e}}
function l(){a.get=t;a.set=e;a.del=r;a.has=s;a.hasValue=n;a.clear=i;a.dump=o}a.reset=l;function c(e,t){if(t===void 0){t=0}
var r=parseInt(a.get(e),10);return isNaN(r)?t:r}a.getI=c;function u(e,t){a.set(e,t.toString(10))}a.setI=u;l()})(
ottpStorage||(ottpStorage={}));var laaMac;(function(e){function t(){return"XY:XX:XX:XX:XX:XX".replace(/[XY]/g,function(e){
if(e==="Y")return"26ae".charAt(Math.floor(Math.random()*4));else return"0123456789abcdef".charAt(Math.floor(Math.random(
)*16))})}function r(){return ottpStorage.get("laa_mac")||function(){var e=t();ottpStorage.set("laa_mac",e);return e}()}
e.get=r})(laaMac||(laaMac={}));var keyStrings={},sGrapI=0;function _(e,t,r){if(sGrapI)switch(e){case"off":case"no":
return'<span class="fontello">&#xf204;</span>';case"yes":return'<span class="fontello">&#xf205;</span>'}var s=keyStrings[e
]||e;for(var n=1;n<arguments.length;n++)s=s.replace(new RegExp("%"+n,"g"),arguments[n]);return s}
var stbGetItem=ottpStorage.get;var stbSetItem=ottpStorage.set;var stbDelItem=ottpStorage.del;
var stbClearAllItems=ottpStorage.clear;var stbGetAllItems=ottpStorage.dump;if(!window.localStorage){sFavorites=-1}
function _providerGetItem(e){return stbGetItem(p_pref+e)}function _providerHasItem(e){return ottpStorage.has(p_pref+e)}
function _providerHasItemValue(e){return ottpStorage.hasValue(p_pref+e)}function _providerSetItem(e,t){stbSetItem(p_pref+e,
t)}function _providerDelItem(e){return ottpStorage.del(p_pref+e)}var providerGetItem=_providerGetItem,
providerHasItem=_providerHasItem,providerHasItemValue=_providerHasItemValue,providerSetItem=_providerSetItem,
providerDelItem=_providerDelItem;function providerGetBool(e){return providerGetItem(e)||false}function providerGetNum(e,t){
var r=parseInt(providerGetItem(e),10);return isNaN(r)?t:r}function providerGetJson(e,t){var r=providerGetItem(e);if(r)try{
return JSON.parse(r)}catch(e){}return t}var innerStyle;(function(e){var s;var n={};function t(){
e.elHtml=document.createElement("style");document.body.insertBefore(e.elHtml,document.body.firstChild);s=e.elHtml.sheet}
e.init=t;function r(e){var t=n[e];if(typeof t==="undefined"){var r=s.cssRules.length;if(!client_can.is_maple){s.insertRule(
e+" {}",0);t=s.cssRules[0]}else{s.insertRule(e+" {quotes: inherit;}",0);t=s.cssRules[r];if(typeof t!=="undefined"
)t.style.removeProperty("quotes")}if(s.cssRules.length<=r){client_feedb("Cannot add empty CSS rule");t=undefined}n[e]=t}
return t}e.getRule=r})(innerStyle||(innerStyle={}));function getWidthK(){return window.innerWidth/1280}function getHeightK(
){return window.innerHeight/720}function alert(e){showShift(e)}function log(e,t){console.log(t);
var r=document.getElementById(e);if(r!==null){r.innerHTML=t+"<br>"+r.innerHTML}else{console.error(
'log: element "'+e+'" is unavalible')}}$.support.cors=true;$.ajaxSetup({cache:true});(function(){var r=$.ajax;
$.ajax=function(e,t){if(/^http:\/\/epg\.ott-play\.com\//.test(e.url)){e.url=e.url.replace("//epg.ott-play.com/",
"//epg.ottp.eu.org/");e.url=e.url.replace(/\/epg\/([^\/]+)\.json$/,function(e,t){return"/epg/"+xxHash32Si(t)+".json"})
}else if(/^http:\/\/cps\.ott-play\.com\//.test(e.url))e.url=e.url.replace("//cps.ott-play.com/","//cps.ottp.eu.org/");
return r(e,t)}})();function checkIfIncluded(e){var t=document.getElementsByTagName("link");for(var r=0;r<t.length;r++)if(t[
r].href.indexOf(e)!=-1)return true;return false}if(!checkIfIncluded("1280.css"))$(document.head).append(
'<link rel="stylesheet" type="text/css" href="'+host+"/stbPlayer/1280.css?"+__av+'"/>');(function(s){s.each(["show","hide"]
,function(e,t){var r=s.fn[t];s.fn[t]=function(){this.triggerHandler(t);return r.apply(this,arguments)}})})(jQuery);$(
"#listAbout").on("show",function(){$("#listIn").hide()});$("#listAbout").on("hide",function(){$("#listIn").show()});$(
"#listEdit").on("show",function(){$("#listIn").hide()});$("#listEdit").on("hide",function(){$("#listIn").show();$(
"#listEdit").text("")});$("#dialogbox").on("show",function(){$(this).css({top:0,left:0,width:"auto",height:"auto"}).css({
top:(720*getHeightK()-$(this).height())/2,left:(1260*getWidthK()-$(this).width())/2})});var $i1=$("#info1");$i1.hide();
var infoTimeout=null;function infoBarHideT(){if($("#buffering").is(":visible")||!stbIsPlaying()||$("#step").is(":visible")
)infoTimeout=setTimeout(infoBarHideT,sInfoTimeout*1e3);else infoBarHide()}function infoBarHide(){try{
tooltip.style.display=""}catch(e){console.error(e)}clearTimeout(infoTimeout);if(sInfoSlide)$i1.slideUp();else $i1.hide()}
function scrollUpDescr(){if(tooltip.style.display)tooltip.style.top=$progress_div.offset().top-$progress_div.height()+"px";
$("#programm_descr").stop(true).css("margin-top",0);var e=$("#programm_descr").height()-$("#descr").height()+$(
"#programm_name2").height()+$("#programm_duration").height();scrollUp("programm_descr",e,1e4)}function showChanelInfo(e){
clearTimeout(detailTimer);clearTimeout(infoTimeout);if(e===undefined)e=0;if(e==1&&$i1.is(":visible")&&!$("#descr").is(
":visible")){infoTimeout=setTimeout(infoBarHideT,sInfoTimeout*1e3);return}if(e)$i1.hide();$("#programm_descr").stop(true
).css("margin-top",0);if(!$i1.is(":visible")){if(e!=2)$("#descr").hide();else $("#descr").show();if(sInfoSlide
)$i1.slideDown(400,scrollUpDescr);else $i1.show(0,scrollUpDescr);if(e!=2)infoTimeout=setTimeout(infoBarHideT,
sInfoTimeout*1e3)}else if(!$("#descr").is(":visible")){if(sInfoSlide)$("#descr").slideDown(400,scrollUpDescr);else $(
"#descr").show(0,scrollUpDescr)}else infoBarHide()}var _sn=0;function getThumbnail(e){if(sThumbnail&&e){var t=Math.floor(
133*getWidthK());var r=Math.floor(200*getHeightK());var s=Math.floor(t/15);
return'<div class="img" style="background-image: url(\''+e+"');width:"+t+"px;height:"+r+"px;margin:"+s+'px;float:left;background-size:cover;"></div>'
}return""}function updateChanelInfo(e){if(e!=curList[primaryIndex])return;$("#channel_number").html(primaryIndex+1);
var t=chanels[e];if(t){$("#picon").css("background-image",'url("'+getChannelPicon(e)+'")');$("#channel_name").html(
t.channel_name)}else{$("#picon").css("background-image",'url("")');$("#channel_name").html(_("Channel is not available!!!"
)+" id="+e)}$progress_div.css("background-color","#446");$("#progress_r").css("width","0%");$("#nprogramm_name").html(
"&nbsp; ");$("#nbegin_time").text("");$("#nend_time").text("");if(!getCurProgData(e,updateChanelInfo)){$("#programm_name"
).html("&nbsp; ");_prog100=0;$("#progress").css("width","0%");$("#begin_time").text("");$("#end_time").text("");$(
"#programm_name2").text("");$("#programm_duration").text("");$("#programm_descr").text("")}else{$("#programm_name").html(
t.name);_prog100=t;$("#progress").css("width",(Date.now()/1e3-t.time)/(t.time_to-t.time)*100+"%");$("#begin_time").text(
time2time(t.time));$("#end_time").text("+"+Math.round((t.time_to-Date.now()/1e3)/60));if(t.nextpr&&t.nextpr.length){$(
"#nprogramm_name").html(t.nextpr[0].name);$("#nbegin_time").text(time2time(t.nextpr[0].time));$("#nend_time").text(
Math.round((t.nextpr[0].time_to-t.nextpr[0].time)/60))}$("#programm_name2").html(t.name);var r=Math.round((Date.now(
)/1e3-t.time)/60);$("#programm_duration").html(time2str(t.time)+" - "+time2time(t.time_to)+' (<span id="cur_time">'+(
r>0?r+"/":"")+"</span>"+Math.round((t.time_to-t.time)/60)+" "+_("min")+")");$("#programm_descr").html(t.descr?getThumbnail(
t.icon)+t.descr:"")}if(sInfoChange&&!$i1.is(":visible"))showChanelInfo(1)}function setCurProg(e,t,r){var s=[];
var n=Array.isArray(t)&&t.length>0;if(n){s=t.sort(function(e,t){return e.time-t.time})}var i=s.findIndex(function(e,t,r){
return e.time_to>=Date.now()/1e3&&e.time<=Date.now()/1e3});var a=chanels[e];if(i===-1){a.name="";a.time=0;a.time_to=0;
a.descr="";a.nextpr=null;a.time_request=Date.now()/1e3+3600;if(n)a.outdated=true}else{var o=s[i];a.name=o.name;
a.time=o.time;a.time_to=o.time_to;a.descr=o.descr;a.time_request=0;a.icon=o.icon;a.nextpr=s.slice(i+1,i+1+sNextCount+1);if(
a.nextpr.length==0)a.nextpr=null;if(typeof a.outdated!=="undefined")delete a.outdated}if(r)r(e)}var playType=0,prevArr=[];
function setCurrent(e,t,r){if(typeof r=="undefined")r=false;var s=playType>0;if(e!=catIndex||t!=primaryIndex||(
r!=s||t==-1||playType==-1e11)){if(playType==-1e11){if(medHistory.length){medHistory[0].current=Math.floor(stbGetPosTime());
if(sFavorites!=-1)providerSetItem("medHistory",JSON.stringify(medHistory))}}else try{var n=cats[catsArray[catIndex]][
primaryIndex],i=cats[catsArray[e]][t];prevArr=prevArr.filter(function(e){var t=e.t!=undefined;return(e.ci!=n||t!=s)&&(
e.ci!=i||t!=r)});prevArr.unshift({ci:n,c:catIndex,i:primaryIndex,e:_prog100.name});if(s)prevArr[0].t=playType+playTime;
prevArr.splice([1,5,10,15,20][sPrevCount]);providerSetItem("prevArr",JSON.stringify(prevArr))}catch(e){console.error(e)}if(
t==-1)return}catIndex=e;curList=cats[catsArray[catIndex]]||[];primaryIndex=t;providerSetItem("primaryIndex",primaryIndex);
providerSetItem("catIndex",catIndex)}var _tmedia=null;function checkMedia(){clearTimeout(_tmedia);if($("#buffering").is(
":visible")){_tmedia=setTimeout(checkMedia,2e3);return}var e=stbGetLen();if(e&&e>180&&e!=Infinity&&e<1e6){playTime=0;
playType=-2e11;forcePlay=true;$progress_div.css("background-color","#600");$("#progress_r").css("width","0%");
updateMediaInfo()}}var playChannel=_playChannel;function _playChannel(e,t){if(catsArray[e]===undefined){infoBox(
"ERROR: Category #"+e+" does not exist!<br /> Please select other");client_feedb(
"category_trouble_playChannel: "+e+" / "+catsArray.length+" / "+Object.keys(providerGetJson("cats",{})).length)}if(
ifParentalAccessChId(cats[catsArray[e]][t],function(){playChannel(e,t)}))return;if(sStopPlay)stbStop();setCurrent(e,t);
var r=curList[primaryIndex];updateChanelInfo(r);if(sInfoSwitch)showChanelInfo(1);playType=0;stbPlay(getChannelUrl(r));
clearTimeout(_tmedia);_tmedia=setTimeout(checkMedia,2e3)}function plusProg(){var e=primaryIndex+1;if(e>=curList.length)e=0;
playChannel(catIndex,e)}function minusProg(){var e=primaryIndex-1;if(e<0)e=curList.length-1;playChannel(catIndex,e)}
function prevProg(){function t(e){var t=Math.floor(Date.now()/864e5)*86400+(new Date).getTimezoneOffset()*60;
return e>=t&&e<t+86400}function s(e){return t(e)?time2time(e):time2str(e)}var r,n;function i(e){r=e.c;n=cats[catsArray[r]
].indexOf(e.ci);if(n!=-1)return;n=cats[_("All")].indexOf(e.ci);r=catsArray.indexOf(_("All"))}switch(prevArr.length){case 0:
return;case 1:i(prevArr[0]);playChannel(r,n);return;default:var a=[];prevArr.forEach(function(e,t,r){try{a.push(chanels[
e.ci].channel_name+(e.t?'<span style="color:red;"> - '+s(e.t)+"</span>":"")+(
e.e?' <span style="color:#f9bf3b;"><span style="color:#607d8b;">&#x02237; </span>'+e.e+"</span>":""))}catch(e){r.splice(t,1
)}});showSelectBox(0,a,function(e){if(prevArr[e].t){var t=prevArr[e].ci,s=prevArr[e].t;i(prevArr[e]);setCurrent(r,n,true);
getEPGchanelCached(t,function(t,e){var r=[];if(e!==null&&e.length){r=e.filter(function(e){return e.time>Date.now(
)/1e3-chanels[t].rec*60*60}).sort(function(e,t){return e.time-t.time})}epgArray=r;setCurProg(t,e,null);playArchive(s)})
}else{i(prevArr[e]);playChannel(r,n)}},0)}}var numProg=document.getElementById("numprog");numProg.style.display="none";
var nProg="",numTimeout=null;function numberProg(e){if(nProg==""&&!e)return;if(nProg.length==4){if(nProg=="9999"){if(e==7
)$("#info").toggle();if(e==9)popupList()}return}nProg+=e.toString();var t=parseInt(nProg,10)-1;numProg.innerHTML=nProg+(
t<0||t>=curList.length?"":"<br/>"+chanels[curList[t]].channel_name);numProg.style.display="";clearTimeout(numTimeout);
numTimeout=setTimeout(function(){numProg.style.display="none";var e=parseInt(nProg)-1;nProg="";if(
e<0||e>=curList.length||e==primaryIndex)return;playChannel(catIndex,e)},2e3)}var list=document.getElementById("list");
list.style.display="none";var listIn=document.getElementById("listIn");var listCaption=document.getElementById(
"listCaption");var listPodval=document.getElementById("listPodval");var listDetail=document.getElementById("listDetail");
var pageSize=25;var selIndex;var listArray=[];var getListItem;var detailListAction;var listKeyHandler;var itemWith=735;
function showPage(){if(list.style.display!==""){$i1.hide();$("#permanentTime").hide();listIn.innerHTML="";if(sNoSmall)$(
"#list_osd").show();else try{$("#list_window").show();stbSetWindow();if(pipIndex!=null)stbStopPip()}catch(e){console.error(
e)}list.style.display=""}arrayGetCurProg=[];var t="",e=Math.floor(selIndex/pageSize)*pageSize,r=Math.min(e+pageSize,
listArray.length),s=(window.innerHeight-90*getHeightK())/pageSize;if(sShowScroll&&listArray.length>pageSize){
itemWith=getWidthK()*720;var n=10*getWidthK();var i=Math.floor(listArray.length/pageSize)+(listArray.length%pageSize?1:0),
a=Math.floor(selIndex/pageSize);
t+='<div onclick="event.stopPropagation();changeSelect('+pageSize+');" style="float:right;height:100%;width:'+n+"px; border: 1px solid "+bodyColor+';"><div onclick="event.stopPropagation();changeSelect(-'+pageSize+');" style="width:100%;height:'+a/i*100+'%;"></div><div style="background-color: '+bodyColor+";width:100%;height:"+100/i+'%;"></div></div>'
}else itemWith=getWidthK()*735;for(var o=e;o<r;o++){
t+='<div id="it'+o+'" onclick="event.stopPropagation();setSelect('+o+')" class="item" style="height:'+s+"px; line-height:"+s+"px; width:"+itemWith+"px;"+(
o===selIndex?"color: "+curColor+"; background-color:"+curColorB+';">':'">');try{t+=getListItem(listArray[o],o)+"</div>"
}catch(e){console.error(e);t+="ERROR:"+e.message+"</div>"}}listIn.innerHTML=t;detailListActionWithTimeOut()}
function _doKey(e,t){if(t===void 0)t=event;if(t!==void 0)t.stopPropagation();keyHandler({keyCode:e,preventDefault:function(
){},stopPropagation:function(){}})}function setSelect(e){if(selIndex==e)_doKey(keys.ENTER);else{$("#it"+selIndex).css({
"background-color":"","color":""});selIndex=e;$("#it"+selIndex).css({"background-color":curColorB,"color":curColor});
detailListActionWithTimeOut()}}var current_t,current_s,list_t,list_s,perm_t;function _t2(e){return e.toString(
).length==1?"0"+e:e}function initBackgroundIntervals(){current_t=document.getElementById("current_t");
current_s=document.getElementById("current_s");list_t=document.getElementById("list_t");list_s=document.getElementById(
"list_s");perm_t=document.getElementById("permanentTime");setInterval(function(){var e=new Date(Date.now()),t=_t2(
e.getHours())+":"+_t2(e.getMinutes()),r=":"+_t2(e.getSeconds());current_t.innerHTML=t;current_s.innerHTML=r;
list_t.innerHTML=t;list_s.innerHTML=r;perm_t.innerHTML=t;if(playType&&stbIsPlaying())playTime++},1e3);setInterval(function(
){try{if(playType<0){updateMediaInfo();return}if(!playType){var e=curList[primaryIndex],t=chanels[e];if(getCurProgData(e,
updateChanelInfo)){_prog100=t;$("#progress").css("width",(Date.now()/1e3-t.time)/(t.time_to-t.time)*100+"%");$("#end_time"
).text("+"+Math.round((t.time_to-Date.now()/1e3)/60));var r=Math.round((Date.now()/1e3-t.time)/60);if(r>0)$("#cur_time"
).text(r+"/")}}else{var s=playType+playTime;if(curProg==-1||s>epgArray[curProg].time_to)updateArchiveInfo(s);else{
var t=epgArray[curProg]||{name:"",time:Math.floor(s/3600)*3600,time_to:(Math.floor(s/3600)+1)*3600,descr:""};_prog100=t;$(
"#progress").css("width",(s-t.time)/(t.time_to-t.time)*100+"%");$("#progress_r").css("width",t.time_to>Date.now()/1e3?(
t.time_to-Date.now()/1e3)/(t.time_to-t.time)*100+"%":"0%");$("#end_time").text("+"+Math.round((t.time_to-s)/60));$(
"#arc_time").text(time2time(s));var r=Math.round((s-t.time)/60);if(r>0)$("#cur_time").text(r+"/")}}}catch(e){client_feedb(
"epg_time_to: "+curProg+" / "+(typeof epgArray==="undefined"?"undef":epgArray.length+"/"+epgArray[curProg]));console.error(
e)}},3e4)}function body_onUnload(){setCurrent(catIndex,primaryIndex);playType=0}function body_onUnloadHidden(){if(
document.hidden)body_onUnload()}if(navigator.userAgent.search(/Maple/i)==-1){if(document.addEventListener
)document.addEventListener("visibilitychange",body_onUnloadHidden,void 0);else if(document.attachEvent
)document.attachEvent("onvisibilitychange",body_onUnloadHidden);if(window.addEventListener){window.addEventListener(
"beforeunload",body_onUnload,void 0);window.addEventListener("unload",body_onUnload,void 0)}else if(window.attachEvent){
client_feedb("is window.attachEvent");window.attachEvent("onbeforeunload",body_onUnload);window.attachEvent("onunload",
body_onUnload)}}function changeSelect(e){if(!listArray.length)return;var t=selIndex;selIndex+=e;if(selIndex<0
)selIndex=e===-1?listArray.length-1:0;else if(selIndex>=listArray.length)selIndex=e===1?0:listArray.length-1;var r=$(
"#it"+selIndex);if(r.length){$("#it"+t).css({"background-color":"","color":""});r.css({"background-color":curColorB,
"color":curColor});detailListActionWithTimeOut()}else showPage()}function closeList(){try{list.style.display="none";$(
"#list_osd").hide();$("#list_window").hide();$("#listPopUp").hide();$("#permanentTime").toggle(sPermanentTime!=0);
stbToFullScreen();if(!sNoSmall&&pipIndex!=null)stbPlayPip(getChannelUrl(cats[catsArray[pipCatIndex]][pipIndex]));if(
sPreview&&previewChan){if(previewChan.ch_id!=curList[primaryIndex]){if(sStopPlay)stbStop();if(playType>0)playArchive(
playType+playTime-(s10resum?10:0));else playChannel(catIndex,primaryIndex)}previewChan=null}}catch(e){console.error(e)}}
var listCatIndex=null;var previewChan=null,previewTimer=null;function previewChId(e){if(previewChan&&previewChan.ch_id==e
)return;clearTimeout(previewTimer);if(ifParentalAccessChId(e,function(){previewChId(e)}))return;previewTimer=setTimeout(
function(){if(sStopPlay)stbStop();previewChan={c:0,i:0,ch_id:e};stbPlay(getChannelUrl(e))},500)}var detailTimer=null;
function detailListActionWithTimeOut(){clearTimeout(detailTimer);listDetail.innerHTML="";detailTimer=setTimeout(function(){
clearTimeout(detailTimer);detailListAction()},200)}function scrollUp(e,t,r){clearTimeout(detailTimer);if(t>0
)detailTimer=setTimeout(function(){$("#"+e).animate({"margin-top":"-="+t},t*80)},r)}function detailProg(){var e=chanels[
listArray[selIndex]];if(e===undefined)return;if(e.time_to&&e.time_to>=Date.now()/1e3){var t=Math.round((Date.now(
)/1e3-e.time)/60);
var r='<div id="_name"><div style="color:'+curColor+';">'+e.name+'</div><div style="font-size:smaller;">'+time2time(e.time
)+" - "+time2time(e.time_to)+" ("+(t>0?t+"/":"")+Math.round((e.time_to-e.time)/60)+" "+_("min"
)+")</div></div>"+'<div id="_descr" style="font-size:smaller;overflow:hidden;"><div id="_prd">'+getThumbnail(e.icon
)+e.descr+"</div></div>";if(e.nextpr&&sNextCountL){r+='<div id="_nextpr" style="'+(
sShowDescr?"position:absolute;left:0;bottom:0;padding:4px;":"")+'width:98%;white-space:nowrap;font-size:smaller;">';
e.nextpr.forEach(function(e,t){if(t<sNextCountL)r+=time2time(e.time
)+' <span style="color:'+curColor+';">'+e.name+"</span></br>"});r+="</div>"}listDetail.innerHTML=r;var s=sShowDescr?$(
"#listDetail").height()-$("#_name").height()-$("#_nextpr").height()||0:0;$("#_descr").height(s);s=$("#_prd").height()+10-s;
scrollUp("_prd",s,5e3)}if(sPreview==1)previewChId(listArray[selIndex])}function updateChanelList(e){$("#pn"+e).html(
chanels[e].name);$("#pr"+e).css("width",(Date.now()/1e3-chanels[e].time)/(chanels[e].time_to-chanels[e].time)*100+"%");if(
listArray[selIndex]==e)detailProg()}function addChannel2bucket(){var e=selIndex,t=listArray[selIndex];if(sFavorites){if(
!listCatIndex)return;cats[_("Favorites")].push(t);saveChannelsCats();showShift(_("Channel ")+chanels[t].channel_name+_(
" added to favorites"))}else{saveCPD();var r=selIndex,s=listArray,n=getListItem,i=detailListAction,a=listKeyHandler,o=$(
"#listPopUp").is(":visible");selIndex=0;listArray=catsArray.slice(1);getListItem=function(e,t){return"&nbsp;&nbsp;"+e};
detailListAction=function(){};listKeyHandler=function(e){switch(e){case keys.ENTER:cats[listArray[selIndex]].push(t);
saveChannelsCats();showShift(_("Channel ")+chanels[t].channel_name+_(" added to category ")+listArray[selIndex]);
case keys.RETURN:restoreCPD();selIndex=r;listArray=s;getListItem=n;detailListAction=i;listKeyHandler=a;showPage();if(o)$(
"#listPopUp").show();return true}return false};listCaption.innerHTML=_("Select category to add channel");
listPodval.innerHTML=btnDiv(keys.RETURN,strRETURN,"Close");$("#listPopUp").hide();showPage()}}function parentChannel(){if(
!sPSchannels||parentPIN=="*")return;if(!parentAccess){enterPinAndSetAccess(parentChannel);return}
var e=parentalArray.indexOf(listArray[selIndex]);if(e==-1)parentalArray.push(listArray[selIndex]
);else parentalArray.splice(e,1);providerSetItem("parentalArray",JSON.stringify(parentalArray));showPage()}var TMDb;(
function(e){var r="http://api.themoviedb.org/3/";var t="http://image.tmdb.org/t/p/w500";
var s="http://api.ottp.eu.org/tmdb/s/";var n="http://api.ottp.eu.org/tmdb/i";var a="";var o="";
var l="9759770d3dd0c01a9498909c517a7bdd";var c={"_eng":"en","_arm":"hy","_bel":"be","_bul":"bg","_fra":"fr","_ger":"de",
"_gre":"el","_heb":"he","_hun":"hu","_lat":"lv","_lit":"lt","_pol":"pl","_por":"pt","_rou":"ro","_rus":"ru","_spa":"es",
"_tur":"tr","_ukr":"uk"};var i="";var u=null;var d=0;function p(e){if(e!==d){d=e;if(d===0)ottpStorage.del("tmdbIsDead"
);else ottpStorage.setI("tmdbIsDead",d)}if(d>0){a=s;o=n}else{a=r;o=t}}function f(){var e=Math.floor(Date.now()/(1e3*604800)
);if(e>d){P="";var t=new XMLHttpRequest;t.open("GET",r,true);t.timeout=3e3;t.onerror=function(){p(e)};
t.onreadystatechange=function(){if(t.readyState===4)p(t.status===401?0:e)};t.send(null)}}function h(){d=ottpStorage.getI(
"tmdbIsDead",0);p(d);if(d>0)f()}e.prepare=h;function y(e,t){var r=c[stbGetItem("ottplaylang")]||"en";function s(e){
function t(e,t){return e?(t?"<b>"+_(t)+": </b>":"")+e+"<br>":""}var r=[],s=[],n=[],i=[],a=[];if(e.genres)e.genres.forEach(
function(e){r.push(e.name)});if(e.production_countries)e.production_countries.forEach(function(e){s.push(e.name)});if(
e.credits.cast)e.credits.cast.slice(0,10).forEach(function(e){n.push(e.name)});if(e.credits.crew)e.credits.crew.forEach(
function(e){if(e.job=="Director")i.push(e.name);else if(e.job=="Screenplay")a.push(e.name)});
return'<div id="_prdD" style="margin: -'+10*getHeightK(
)+"px; background-position: right -200px top; background-size: cover; background-repeat: no-repeat; background-image: url("+o+e.backdrop_path+');">'+'<div style="padding:'+20*getHeightK(

)+'px; background: rgba(13, 37, 63, 0.8); background: linear-gradient(to right, rgba(13, 37, 63, 1) 0%, rgba(13, 37, 63, 0.8) 100%);">'+"<table>"+'<img height="'+20*getHeightK(

)+'" src="'+host+'/stbPlayer/blue_short.png" alt="TMDb" style="float: right; border-width: 0px; border-style: solid;" onerror="this.width=0;this.height=0;">'+(
e.poster_path?'<img height="'+300*getHeightK()+'" width="'+200*getHeightK(
)+'" src="'+o+e.poster_path+'" style="float: left; margin-right: '+10*getHeightK()+"px; margin-bottom: "+10*getHeightK(
)+'px; border-width: 0px; border-style: solid;" onerror="this.width=0;this.height=0;">':""
)+'<div style="text-align:center;font-size:larger;">'+(e.title||e.name)+"</div><br>"+t((e.release_date||"").split("-")[0],
"Year")+t(Math.round(e.runtime||e.episode_run_time)+" "+_("min"),"Duration")+t(r.join(", "),"Genre")+t(s.join(", "),
"Country")+t(n.join(", "),"Actors")+t(i.join(", "),"Director")+t(a.join(", "),"Script")+t(e.vote_average,"Rating")+(
e.overview?"<hr>"+e.overview:"")+"</table></div></div>"}function n(){clearTimeout(detailTimer);$("#dialogbox").html(s(u)
).show();dialogBoxKeyHandler=function(e){switch(e){case keys.DOWN:clearTimeout(detailTimer);if($("#_prdD").height()-$(
"#dialogbox").height()-20*getHeightK()+parseInt($("#_prdD").css("margin-top"))>0)$("#_prdD").animate({
"margin-top":"-=1.1em"},20);break;case keys.UP:clearTimeout(detailTimer);if(parseInt($("#_prdD").css("margin-top")
)<-10*getHeightK())$("#_prdD").animate({"margin-top":"+=1.1em"},20);break;case keys.RETURN:if(m.length>1)setTimeout(
function(){k()});case keys.ENTER:case keys.EXIT:$("#dialogbox").hide();clearTimeout(detailTimer)}return true};var e=$(
"#_prdD").height()-$("#dialogbox").height()-20*getHeightK();scrollUp("_prdD",e,1e4)}if(i==e+"/"+t){n();return}i=e+"/"+t;
$.ajax({url:a+i,data:{api_key:l,language:r,append_to_response:"credits"},dataType:"json",timeout:3e4,success:function(e){
u=e},error:function(e){f();$("#dialogbox").html("<br>Get TMDb error!<br><br>");console.log("getTMDB jqXHR:"+JSON.stringify(
e))},complete:function(){n()}})}var m=[];var v=-1;var g="animate";var b=1;function x(e){if(v==e)return;$("#tmdb"+v)[g]({
width:150*b+"px"},200);v=e;$("#_sel").text(v+1);var e=m[v],t=e.title||e.name,r=e.release_date?" ("+(e.release_date||""
).split("-")[0]+")":"",s=e.overview?'<div style="font-size:smaller;max-height:3.3em;">'+e.overview+"</div>":"";$("#_desc"
).html('<span style="color:'+curColor+';">'+t+r+"</span>"+s);$("#tmdb"+v)[g]({width:200*b+"px"},200);$("#tmdb")[g]({
"left":-Math.min(Math.max(0,(m.length*150+50)*b-$("#tmdb").width()),Math.max(0,(v-Math.floor($("#tmdb").width()/150/b)+2
)*150*b))+"px"},200)}function I(e){event.stopPropagation();if(v==e)_doKey(keys.ENTER);else x(e)}e.setSelect=I;function k(){
b=getHeightK();g=sInfoSlide?"animate":"css";var r='<img height="'+(20*b).toString(10
)+'" src="'+host+'/stbPlayer/blue_short.png" style="float: right; margin: '+(10*b).toString(10)+'px;">';
r+='<span id="_sel">1</span>/'+m.length.toString(10
)+'<div id="_tmdb" style="clear:both;overflow:hidden;"><div id="tmdb" style="white-space:nowrap;position:relative;">';
m.forEach(function(e,t){r+='<div id="tmdb'+t+'" style="display: inline-block; height:'+(300*b).toString(10)+"px; width:"+(
150*b).toString(10
)+"px; background-position: center; background-size: contain; background-repeat: no-repeat; background-image: url("+(
e.poster_path?o+e.poster_path:host+"/stbPlayer/no_image.png")+');" onclick="TMDb.setSelect('+t+');"></div>'});$(
"#dialogbox").html(r+'</div><div id="_desc"></div></div>').show();$("#_desc").width($("#_tmdb").width());if(v==-1)x(0
);else{var e=v;v=-1;x(e)}dialogBoxKeyHandler=function(e){switch(e){case keys.UP:x(0);break;case keys.DOWN:x(m.length-1);
break;case keys.LEFT:if(v)x(v-1);break;case keys.RIGHT:if(v<m.length-1)x(v+1);break;case keys.N2:case keys.INFO:
case keys.ENTER:y(m[v].media_type,m[v].id);break;case keys.EXIT:case keys.RETURN:$("#dialogbox").hide();break}return true}}
var P="";function T(e,t){var r=c[stbGetItem("ottplaylang")]||"en";var s='<img height="'+(20*getHeightK()).toString(10
)+'" src="'+host+'/stbPlayer/blue_short.png" alt="TMDb" style="float: right; border-width: 0px; border-style: solid;" onerror="this.width=0;this.height=0;">'
t=t||0;e=e.replace(/"|\u00AB|\u00BB|&quot;|&amp;|&lt;|&gt;|&laquo;|&raquo;|\s[\(\[].*[\)\]]\s?|\s?\S\/\S\s/g,"");var n=e,
i=n.split(" ");dialogBoxKeyHandler=function(){$("#dialogbox").hide()};if(!t){if(e!=P)P=e;else switch(m.length){case 0:$(
"#dialogbox").html(s+"<br>"+_("Not found")+"!<br>");return;case 1:y(m[0].media_type,m[0].id);return;default:k();return}}
switch(t){case 0:break;case 1:i.pop();n=i.join(" ");break;case 2:i.shift();n=i.join(" ");break;case 3:i.shift();i.pop();
n=i.join(" ");break;default:i.pop();n=i.join(" ");break}if(!n){$("#dialogbox").html(s+"<br>"+_("Not found")+"!<br>");return
}$("#dialogbox").html(s+"<br>"+_("Search")+":<br>"+n+"<br><br>").show();$.ajax({url:a+"search/multi",data:{api_key:l,
language:r,query:n,page:1,include_adult:true},dataType:"json",timeout:3e4,success:function(e){e.results=e.results.filter(
function(e){return e.media_type=="movie"||e.media_type=="tv"});m=e.results;if(e.results.length>1){m=e.results.filter(
function(e){return(e.title||e.name)==P});if(!m.length)m=e.results}v=-1;switch(m.length){case 0:T(n,1);return;case 1:y(m[0
].media_type,m[0].id);return;default:k();return}},error:function(e){f();$("#dialogbox").html(
s+"<br>Search TMDb error!<br><br>");console.log("searchTMDB jqXHR:"+JSON.stringify(e))}})}e.search=T})(TMDb||(TMDb={}));
function infoProgramm(t){if(!t){infoBox(_("no epg at current time"));return}$("#listPopUp").hide();saveCPD();
listCaption.innerHTML=t;listPodval.innerHTML=btnDiv(keys.RETURN,strRETURN,"Close")+(t?btnDiv(keys.N2,strInfo,"TMDb","2",
sArrowFun==2?strRIGHT:sRewFun==1?strFF:sPNFun==1?strNEXT:""):"");aboutKeyHandler=function(e){if(t)switch(e){
case keys.RIGHT:if(sArrowFun!=2)break;case keys.N2:case keys.INFO:TMDb.search(t);return true;case keys.FF:if(sRewFun!=1
)break;TMDb.search(t);return true;case keys.NEXT:if(sPNFun!=1)break;TMDb.search(t);return true}restoreCPD();$("#listAbout"
).hide().text("");$("#_prd").css("margin-top",0);clearTimeout(detailTimer);return true};$("#listAbout").html(
'<div style="font-size:larger;">'+ui_state.ld.replace(/\|/g,"<br/>")+"</div>").show();$("#_prd").css("margin-top",0);$(
"#_nextpr").text("");var e=$("#listAbout").height()-$("#_name").height();$("#_descr").height(e);e=$("#_prd").height()+10-e;
scrollUp("_prd",e,1e4)}var sSortAbc=0;function sortChannels(){catsArray.forEach(function(e,t){if(
!sFavorites&&t||sFavorites&&!t)return;cats[e].sort(function(e,t){if(sSortAbc){try{var r=chanels[e].channel_name,s=chanels[t
].channel_name;return r<s?-1:r>s?1:0}catch(e){console.error(e);return 0}}else{return cList.indexOf(e)-cList.indexOf(t)}})})
}function searchChannel(){$("#listPopUp").hide();editCaption=_("String for search");var e=stbGetItem("chSearch")||"";
editvar=e;setEdit=function(){if(!editvar.length)return;e=editvar;stbSetItem("chSearch",e);setTimeout(function(){selIndex=0;
var t=e.toLowerCase();listArray=cats[catsArray[listCatIndex]].filter(function(e){return chanels[e
].channel_name.toLowerCase().indexOf(t)!==-1});listKeyHandler=function(e){function t(){var e=cats[catsArray[listCatIndex]
].findIndex(function(e){return e==listArray[selIndex]});if(sPreview==2){if(previewChan&&previewChan.ch_id==listArray[
selIndex]){setCurrent(listCatIndex,e)}else{previewChId(listArray[selIndex]);return}}previewChan=null;closeList();if(
catIndex==listCatIndex&&primaryIndex==e&&!playType||sPreview==1){setCurrent(listCatIndex,e);var t=curList[primaryIndex];
updateChanelInfo(t);if(sInfoSwitch)showChanelInfo(1);playType=0;return}setTimeout(function(){playChannel(listCatIndex,e)},
10)}var r;switch(e){case keys.EXIT:closeList();return true;case keys.LEFT:if(sArrowFun!=2)return false;case keys.RETURN:
channelsList(listCatIndex,listChannel);return true;case keys.RIGHT:if(sArrowFun!=2)return false;case keys.N2:
case keys.INFO:r=chanels[listArray[selIndex]];if(r!==undefined)infoProgramm(r.name);return true;case keys.RW:if(sRewFun!=1
)return false;channelsList(listCatIndex,listChannel);return true;case keys.PREV:if(sPNFun!=1)return false;channelsList(
listCatIndex,listChannel);return true;case keys.FF:if(sRewFun!=1)return false;r=chanels[listArray[selIndex]];if(
r!==undefined)infoProgramm(r.name);return true;case keys.NEXT:if(sPNFun!=1)return false;r=chanels[listArray[selIndex]];if(
r!==undefined)infoProgramm(r.name);return true;case keys.N0:case keys.YELLOW:case keys.TOOLS:searchChannel();return true;
case keys.ENTER:t();return true;case keys.GREEN:case keys.PLAY:case keys.PAUSE:case keys.N3:addChannel2bucket();return true
}return false};listCaption.innerHTML=_("Channel list. Category: ")+catsArray[listCatIndex]+". "+_("Search"
)+':"'+e+'" ('+listArray.length+")";listPodval.innerHTML=btnDiv(keys.RETURN,strRETURN,"Close",
sArrowFun==2?strLEFT:sRewFun==1?strRW:sPNFun==1?strPREV:"")+btnDiv(keys.N2,strInfo,"Description","2",
sArrowFun==2?strRIGHT:sRewFun==1?strFF:sPNFun==1?strNEXT:"")+btnDiv(keys.YELLOW,"","Search",strTools,"0")+btnDiv(keys.GREEN
,"","Add channel to "+(sFavorites?"favorites":"category"),strPlayPause,"3");$("#listPopUp").hide();showPage()})};
showEditKey()}function channelsKeyHandler(e){function t(){if(sPreview==2){if(previewChan&&previewChan.ch_id==listArray[
selIndex]){setCurrent(listCatIndex,selIndex)}else{previewChId(listArray[selIndex]);return}}previewChan=null;closeList();if(
catIndex==listCatIndex&&primaryIndex==selIndex&&!playType||sPreview==1){setCurrent(listCatIndex,selIndex);var e=curList[
primaryIndex];updateChanelInfo(e);if(sInfoSwitch)showChanelInfo(1);playType=0;return}setTimeout(function(){playChannel(
listCatIndex,selIndex)},10)}function r(){closeList();if(listCatIndex==pipCatIndex&&pipIndex==selIndex)return;
pipIndex=selIndex;pipCatIndex=listCatIndex;stbPlayPip(getChannelUrl(listArray[selIndex]))}function s(){if(
!sFavorites&&listCatIndex||sFavorites&&!listCatIndex)return;$("#dialogbox").html(
'<img src="'+host+"/stbPlayer/buffering.gif?"+__av+'" height="40"> '+_("Sort channels")+": "+_(
sSortAbc?'"As Is"':"By alphabet")).show();sSortAbc=sSortAbc==1?0:1;providerSetItem("sSortAbc",sSortAbc);var e=listArray[
selIndex],t=curList[primaryIndex];sortChannels();selIndex=listArray.indexOf(e);primaryIndex=curList.indexOf(t);$(
"#channel_number").html(primaryIndex+1);setPopupChannels();$("#dialogbox").hide();showPage()}function n(e){if(
!sFavorites&&!listCatIndex||sFavorites&&listCatIndex)return;if(selIndex+e<0){listArray.push(listArray[selIndex]);
listArray.shift()}else if(selIndex+e>listArray.length-1){listArray.unshift(listArray[selIndex]);listArray.pop()}else{
var t=listArray[selIndex];listArray[selIndex]=listArray[selIndex+e];listArray[selIndex+e]=t}showPage();changeSelect(e);
saveChannelsCats()}function i(){if(!sFavorites&&!listCatIndex||sFavorites&&listCatIndex)return;listArray.splice(selIndex,1)
if(selIndex==listArray.length)changeSelect(-1);showPage();saveChannelsCats()}function a(){
var e='<td align="center" valign="top" width="30%">';var t=!sFavorites&&listCatIndex||sFavorites&&!listCatIndex;$(
"#dialogbox").html('<table style="font-size:inherit" width="100%">'+"<tr><td></td>"+e+btnDiv(keys.UP,strUP,
t?"<br>Up<br>":"<br><br>")+"</td><td></td></tr>"+"<tr>"+e+btnDiv(keys.LEFT,strLEFT,t?"<br>Delete":"<br>"+_("Sort channels"
)+":<br>"+_(sSortAbc?'"As Is"':"By alphabet"))+"</td>"+e+btnDiv(keys.ENTER,strENTER,
!sFavorites||listCatIndex?"<br>Add<br>to "+(sFavorites?"favorites":"category"):"<br><br>")+"</td>"+e+btnDiv(keys.RIGHT,
strRIGHT,sPSchannels&&parentPIN!="*"?"<br>Parental<br>Control":"<br>")+"</td></tr>"+"<tr><td></td>"+e+btnDiv(keys.DOWN,
strDOWN,t?"<br>Down":"<br>")+"</td><td></td></tr>"+"</table>"+btnDiv(keys.RETURN,strRETURN,"Close")+btnDiv(keys.YELLOW,"",
"Search",strTools)).show();dialogBoxKeyHandler=function(e){switch(e){case keys.ENTER:$("#dialogbox").hide();
addChannel2bucket();return;case keys.UP:n(-1);return;case keys.DOWN:n(1);return;case keys.LEFT:if(t)i();else{$("#dialogbox"
).hide();s()}return;case keys.RIGHT:parentChannel();return;case keys.RETURN:$("#dialogbox").hide();return;case keys.YELLOW:
case keys.TOOLS:$("#dialogbox").hide();listChannel=selIndex;searchChannel();return}}}switch(e){case keys.RETURN:closeList()
return true;case keys.ENTER:t();return true;case keys.N5:case keys.STOP:case keys.PIP:if(typeof stbPlayPip==="function")r()
return true;case keys.RIGHT:if(!sArrowFun)return false;if(sArrowFun==3){
listCatIndex=listCatIndex<catsArray.length-1?listCatIndex+1:0;channelsList(listCatIndex,
catIndex!=listCatIndex?0:primaryIndex);return true}case keys.EPG:case keys.RED:epgList(listCatIndex,selIndex,true);
return true;case keys.LEFT:if(!sArrowFun)return false;if(sArrowFun==3){
listCatIndex=listCatIndex>0?listCatIndex-1:catsArray.length-1;channelsList(listCatIndex,
catIndex!=listCatIndex?0:primaryIndex);return true}case keys.PLAY:case keys.PAUSE:case keys.BLUE:bucketsList(listCatIndex);
return true;case keys.RW:case keys.PREV:switch(e==keys.RW?sRewFun:sPNFun){case 1:bucketsList(listCatIndex);return true;
case 2:listCatIndex=listCatIndex>0?listCatIndex-1:catsArray.length-1;channelsList(listCatIndex,
catIndex!=listCatIndex?0:primaryIndex);return true}return false;case keys.FF:case keys.NEXT:switch(
e==keys.FF?sRewFun:sPNFun){case 1:epgList(listCatIndex,selIndex,true);return true;case 2:
listCatIndex=listCatIndex<catsArray.length-1?listCatIndex+1:0;channelsList(listCatIndex,
catIndex!=listCatIndex?0:primaryIndex);return true}return false;case keys.N0:case keys.YELLOW:case keys.TOOLS:if(
sNoNumbersKeys)a();else $("#listPopUp").toggle();return true;case keys.N2:case keys.INFO:var o=chanels[listArray[selIndex]]
if(o!==undefined)infoProgramm(o.name);return true}if($("#listPopUp").is(":visible"))switch(e){case keys.N1:n(-1);
return true;case keys.N7:n(1);return true;case keys.N8:i();return true;case keys.N3:addChannel2bucket();return true;
case keys.N4:parentChannel();return true;case keys.N9:s();return true;case keys.N6:listChannel=selIndex;searchChannel();
return true}return false}function btnDiv(e,t,r,s,n){if(!r||!e)return"";r=_(r);var i="btn";switch(e){case keys.RED:i+=" red"
if(!t)t="&nbsp;";break;case keys.GREEN:i+=" green";if(!t)t="&nbsp;";break;case keys.YELLOW:i+=" yellow";if(!t)t="&nbsp;";
break;case keys.BLUE:i+=" blue";if(!t)t="&nbsp;";break}if(sNoNumbersKeys){if("0123456789".indexOf(s)!==-1)s="";if(
"0123456789".indexOf(n)!==-1)n=""}var a=t?'<div class="'+i+'">'+t+"</div>&nbsp;":"";if(sNoColorKeys&&[keys.RED,keys.GREEN,
keys.YELLOW,keys.BLUE].indexOf(e)!==-1)a="";if(typeof s!=="undefined"&&s)a+='<div class="btn">'+s+"</div>&nbsp;";if(
typeof n!=="undefined"&&n)a+='<div class="btn">'+n+"</div>&nbsp;";if(!a)r='<div class="btn">'+r+"</div>";
return'<span onclick="_doKey('+e+');">'+a+r+"</span>&nbsp;&nbsp;"}function setPopupChannels(){if(
!sFavorites&&listCatIndex||sFavorites&&!listCatIndex)$("#listPopUp").html(btnDiv(keys.N1,"1","Move channel up"
)+"<br/>"+btnDiv(keys.N7,"7","Move channel down")+"<br/>"+btnDiv(keys.N8,"8","Delete channel")+(
sFavorites?"":"<br/>"+btnDiv(keys.N3,"3","Add channel to category")));else $("#listPopUp").html(btnDiv(keys.N3,"3",
"Add channel to "+(sFavorites?"favorites":"category"))+"<br/>"+btnDiv(keys.N9,"9",_("Sort channels")+": "+_(
sSortAbc?'"As Is"':"By alphabet")));if(sPSchannels&&parentPIN!="*")$("#listPopUp").append("<br/>"+btnDiv(keys.N4,"4",
"Channel parental control"));$("#listPopUp").append("<br/>"+btnDiv(keys.N6,"6","Search"))}var channelsList=_channelsList;
function _channelsList(e,t){if(catsArray[e]===undefined){infoBox(
"ERROR: Category #"+e+" does not exist!<br /> Please select other");client_feedb(
"category_trouble_channelsList: "+e+" / "+catsArray.length+" / "+Object.keys(providerGetJson("cats",{})).length)}selIndex=t
listCatIndex=e;listArray=cats[catsArray[listCatIndex]]||[];var r=getWidthK(),o=(window.innerHeight-90*getHeightK()
)/pageSize;var l=0;if(sShowNum)try{var s=$("#testFont");s.text("9");l=s.width()*listArray.length.toString().length+6*r;
s.text("")}catch(e){console.error(e)}var c=sShowArchive?3*r:0;var u=[0,o-2,o*1.5][sShowPikon],d=u||!c?6*r:0;
var p=sShowProgress?40*r:0;var f=Math.floor(o/3.5);var h=sShowProgress?Math.floor((o-f)/2):0;getListItem=function(e,t){
var r=chanels[e];if(!r)return"&nbsp;&nbsp;"+_("Channel is not available!!!")+" id="+e;var s=itemWith-l-u-d-p-2*h-c*3;
var n=getCurProgData(e,updateChanelList)?r.name:"";if(r.outdated===true)n='<i style="color:#3c3c0a">'+_(
"no epg at current time")+"</i>";var i=n?(Date.now()/1e3-r.time)/(r.time_to-r.time)*100:0;
var a=!sPSchannels||parentPIN=="*"||parentalArray.indexOf(e)==-1?"":"color:#a00;";return(
l?'<div style="float:left;width:'+l+"px;text-align:right;"+a+'">'+(t+1)+"</div>":"")+(
c?'<div style="float:left;width:'+c+"px;"+(r.rec?"background-color:lime;":"")+"margin:"+c+"px;height:"+(o-c*2
)+'px"></div>':"")+'<div class="img" style="background-image:url(\''+(u?getChannelPicon(e):""
)+"'); width:"+u+"px;margin-left:"+d+'px;"></div>'+'<div style="float:left; width:'+s+"px; color:"+bodyColor+'; overflow:hidden;">&nbsp;'+(
sShowName?r.channel_name+"&nbsp;":"")+(
sShowProgram?'<span id="pn'+e+'" style="color:'+curColor+';">'+n+"</span></div>":"</div>")+(
p?'<div class="progress_div" style="width:'+p+"px;margin:"+h+'px;"><div id="pr'+e+'" style="width:'+i+"%;height:"+f+"px;background-color:"+curColor+';font-size:1px;"></div></div>':""
)};listDetail.innerHTML="";detailListAction=detailProg;listKeyHandler=channelsKeyHandler;listCaption.innerHTML=_(
"Channel list. Category: ")+(catsArray[listCatIndex]||"");listPodval.innerHTML=btnDiv(keys.RED,"","EPG",strEPG,
sArrowFun==2?strRIGHT:sRewFun==1?strFF:sPNFun==1?strNEXT:"")+btnDiv(keys.BLUE,"","Category",strPlayPause,
sArrowFun==2?strLEFT:sRewFun==1?strRW:sPNFun==1?strPREV:"")+btnDiv(keys.YELLOW,"","Actions",strTools,"0")+btnDiv(keys.N2,
strInfo,"Description","2")+(typeof stbPlayPip==="function"?btnDiv(keys.PIP,strPip,"Open in PiP",strSTOP,"5"):"");
setPopupChannels();$("#listPopUp").hide();previewChan=sPreview&&e==catIndex&&t==primaryIndex?{c:e,i:t,ch_id:listArray[
selIndex]}:null;showPage()}function bucketsKeyHandler(e){function t(e){if(!selIndex)return;if(
selIndex+e<1||selIndex+e>listArray.length-1)return;var t=listArray[selIndex];listArray[selIndex]=listArray[selIndex+e];
listArray[selIndex+e]=t;showPage();changeSelect(e);saveChannelsCats()}function r(){if(!selIndex)return;delete cats[
listArray[selIndex]];listArray.splice(selIndex,1);if(selIndex==listArray.length)changeSelect(-1);showPage();
saveChannelsCats()}function s(){if(!selIndex)return;$("#listPopUp").hide();editCaption=_("Edit category name");
editvar=listArray[selIndex];setEdit=function(){if(!sNoNumbersKeys)$("#listPopUp").show();if(!editvar)return;if(
listArray.indexOf(editvar)!=-1){showShift(_("Category %1 already exists!",editvar));return}var e=listArray[selIndex];
listArray[selIndex]=editvar;cats[editvar]=cats[e].slice(0);delete cats[e];showPage();saveChannelsCats()};showEditKey()}
function n(){$("#listPopUp").hide();editCaption=_("Enter name for new category");editvar="";setEdit=function(){if(
!sNoNumbersKeys)$("#listPopUp").show();if(!editvar)return;if(listArray.indexOf(editvar)!=-1){showShift(_(
"Category %1 already exists!",editvar));return}listArray.push(editvar);cats[editvar]=[];showPage();saveChannelsCats()};
showEditKey()}function i(){$("#listPopUp").hide();editCaption=_("Enter name for new category");editvar=listArray[selIndex];
setEdit=function(){if(!sNoNumbersKeys)$("#listPopUp").show();if(!editvar)return;if(listArray.indexOf(editvar)!=-1){
showShift(_("Category %1 already exists!",editvar));return}listArray.push(editvar);cats[editvar]=cats[listArray[selIndex]
].slice(0);showPage();saveChannelsCats()};showEditKey()}function a(){var e='<td align="center" valign="top" width="30%">';
$("#dialogbox").html('<table style="font-size:inherit" width="100%">'+"<tr><td></td>"+e+btnDiv(keys.UP,strUP,"<br>Up<br>"
)+"</td><td></td></tr>"+"<tr>"+e+btnDiv(keys.LEFT,strLEFT,"<br>Delete")+"</td>"+e+btnDiv(keys.ENTER,strENTER,
"<br>More...<br>")+"</td>"+e+btnDiv(keys.RIGHT,strRIGHT,"<br>Rename")+"</td></tr>"+"<tr><td></td>"+e+btnDiv(keys.DOWN,
strDOWN,"<br>Down")+"</td><td></td></tr>"+"</table>"+btnDiv(keys.RETURN,strRETURN,"Close")).show();
dialogBoxKeyHandler=function(e){switch(e){case keys.ENTER:o();return;case keys.UP:t(-1);return;case keys.DOWN:t(1);return;
case keys.LEFT:r();return;case keys.RIGHT:$("#dialogbox").hide();s();return;case keys.RETURN:$("#dialogbox").hide();return}
}}function o(){var e='<td align="center" valign="top" width="30%">';$("#dialogbox").html(
'<table style="font-size:inherit" width="100%">'+"<tr><td></td>"+e+btnDiv(keys.UP,strUP,"<br><br>"
)+"</td><td></td></tr>"+"<tr>"+e+btnDiv(keys.LEFT,strLEFT,"<br>Copy<br>category")+"</td>"+e+btnDiv(keys.ENTER,strENTER,
"<br>Back<br>")+"</td>"+e+btnDiv(keys.RIGHT,strRIGHT,"<br>Create<br>category")+"</td></tr>"+"<tr><td></td>"+e+btnDiv(
keys.DOWN,strDOWN,"<br>")+"</td><td></td></tr>"+"</table>"+btnDiv(keys.RETURN,strRETURN,"Close")).show();
dialogBoxKeyHandler=function(e){$("#dialogbox").hide();switch(e){case keys.ENTER:a();return;case keys.UP:case keys.DOWN:
return;case keys.LEFT:i();return;case keys.RIGHT:n();return;case keys.RETURN:return}}}if($("#listPopUp").is(":visible")
)switch(e){case keys.N1:t(-1);return true;case keys.N7:t(1);return true;case keys.N8:r();return true;case keys.N6:s();
return true;case keys.N3:n();return true;case keys.N9:i();return true}switch(e){case keys.N1:case keys.N2:case keys.N3:
case keys.N4:case keys.N5:case keys.N6:case keys.N7:case keys.N8:case keys.N9:channelsList(e-49,
catIndex!=e-49?0:primaryIndex);return true;case keys.RETURN:closeList();return true;case keys.RIGHT:if(sArrowFun!=2
)return false;case keys.CH_LIST:case keys.ENTER:channelsList(selIndex,catIndex!=selIndex?0:primaryIndex);return true;
case keys.LEFT:if(sArrowFun!=2)return false;popupList(popBuckets);return true;case keys.RW:if(sRewFun!=1)return false;
popupList(popBuckets);return true;case keys.PREV:if(sPNFun!=1)return false;popupList(popBuckets);return true;case keys.FF:
if(sRewFun!=1)return false;channelsList(selIndex,catIndex!=selIndex?0:primaryIndex);return true;case keys.NEXT:if(sPNFun!=1
)return false;channelsList(selIndex,catIndex!=selIndex?0:primaryIndex);return true;case keys.N0:case keys.YELLOW:
case keys.TOOLS:if(!sFavorites)if(sNoNumbersKeys)a();else $("#listPopUp").toggle();return true;case keys.PLAY:
case keys.PAUSE:case keys.PRECH:case keys.RED:catRecordsList(selIndex);return true}return false}
var bucketsList=_bucketsList;function _bucketsList(e){selIndex=e;listArray=catsArray;getListItem=function(e,t){
return"&nbsp;&nbsp;"+(sNoNumbersKeys||t>8?"":'<div class="btn">'+(t+1)+"</div>&nbsp;")+e};listDetail.innerHTML="";
detailListAction=function(){};listKeyHandler=bucketsKeyHandler;listCaption.innerHTML=_("Category selection");
listPodval.innerHTML=btnDiv(keys.RED,"","Records",strPlayPause,strPRECH)+(sFavorites?"":btnDiv(keys.YELLOW,"","Actions",
strTools,"0"))+(sArrowFun==2?btnDiv(keys.LEFT,strLEFT,"Menu")+btnDiv(keys.RIGHT,strRIGHT,"Channel list"):"")+(
sArrowFun!=2&&sRewFun==1?btnDiv(keys.RW,strRW,"Menu")+btnDiv(keys.FF,strFF,"Channel list"):"")+(
sArrowFun!=2&&sRewFun!=1&&sPNFun==1?btnDiv(keys.PREV,strPREV,"Menu")+btnDiv(keys.NEXT,strNEXT,"Channel list"):"");if(
!sFavorites)$("#listPopUp").html(btnDiv(keys.N1,"1","Move category up")+"<br/>"+btnDiv(keys.N7,"7","Move category down"
)+"<br/>"+btnDiv(keys.N3,"3","Create category")+"<br/>"+btnDiv(keys.N6,"6","Rename category")+"<br/>"+btnDiv(keys.N9,"9",
"Copy category")+"<br/>"+btnDiv(keys.N8,"8","Delete category"));$("#listPopUp").hide();showPage()}function detailREC(){
var e=listArray[selIndex];listDetail.innerHTML='<div id="_name">'+chanels[e.ch_id
].channel_name+':<br/><div style="color:'+curColor+';">'+e.name+'</div><div style="font-size:smaller;">'+time2str(e.time
)+" - "+time2time(e.time_to)+" ("+Math.round((e.time_to-e.time)/60)+" "+_("min"
)+")</div></div>"+'<div id="_descr" style="font-size:smaller;overflow:hidden;"><div id="_prd">'+e.descr+"</div></div>";
var t=$("#listDetail").height()-$("#_name").height();$("#_descr").height(t);t=$("#_prd").height()+10-t;scrollUp("_prd",t,
5e3)}function selectREC(){var e=listArray[selIndex].ch_id,s=listArray[selIndex].time;closeList();setCurrent(listCatIndex,
cats[catsArray[listCatIndex]].indexOf(e),true);getEPGchanelCached(e,function(t,e){var r=[];if(e!==null&&e.length){
r=e.filter(function(e){return e.time>Date.now()/1e3-chanels[t].rec*60*60}).sort(function(e,t){return e.time-t.time})}
epgArray=r;setCurProg(t,e,null);playArchive(s)})}var _crData={catIndex:-1,data:[],selIndex:0};function searchRec(){
editCaption=_("String for search");var e=stbGetItem("medSearch")||"";editvar=e;setEdit=function(){if(!editvar.length)return
e=editvar;stbSetItem("medSearch",e);setTimeout(function(){selIndex=0;var t=e.toLowerCase();listArray=_crData.data.filter(
function(e){return e.name.toLowerCase().indexOf(t)!==-1||e.descr.toLowerCase().indexOf(t)!==-1});getListItem=function(e,t){
return"&nbsp;&nbsp;"+e.name};detailListAction=detailREC;listKeyHandler=function(e){switch(e){case keys.EXIT:closeList();
return true;case keys.LEFT:if(sArrowFun!=2)return false;case keys.RETURN:catRecordsList(listCatIndex);return true;
case keys.RIGHT:if(sArrowFun!=2)return false;case keys.N2:case keys.INFO:infoProgramm(listArray[selIndex].name);return true
case keys.RW:if(sRewFun!=1)return false;catRecordsList(listCatIndex);return true;case keys.PREV:if(sPNFun!=1)return false;
catRecordsList(listCatIndex);return true;case keys.FF:if(sRewFun!=1)return false;infoProgramm(listArray[selIndex].name);
return true;case keys.NEXT:if(sPNFun!=1)return false;infoProgramm(listArray[selIndex].name);return true;case keys.N0:
case keys.YELLOW:case keys.TOOLS:searchRec();return true;case keys.ENTER:var t=listArray[selIndex].ch_id,r=listArray[
selIndex].time;_crData.selIndex=_crData.data.findIndex(function(e){return e.ch_id==t&&e.time==r});selectREC();return true}
return false};listCaption.innerHTML=_("Archive. Category: ")+catsArray[listCatIndex]+". "+_("Search"
)+':"'+e+'" ('+listArray.length+")";listPodval.innerHTML=btnDiv(keys.RETURN,strRETURN,"Records",
sArrowFun==2?strLEFT:sRewFun==1?strRW:sPNFun==1?strPREV:"")+btnDiv(keys.N2,strInfo,"Description","2",
sArrowFun==2?strRIGHT:sRewFun==1?strFF:sPNFun==1?strNEXT:"")+btnDiv(keys.YELLOW,"","Search",strTools,"0");$("#listPopUp"
).hide();showPage()})};showEditKey()}function catRecordsList(e){function t(){selIndex=_crData.selIndex||0;
listArray=_crData.data;getListItem=function(e,t){return"&nbsp;&nbsp;"+e.name};detailListAction=detailREC;
listKeyHandler=function(e){switch(e){case keys.EXIT:closeList();return true;case keys.LEFT:if(sArrowFun!=2)return false;
case keys.RETURN:bucketsList(listCatIndex);return true;case keys.RIGHT:if(sArrowFun!=2)return false;case keys.N2:
case keys.INFO:infoProgramm(listArray[selIndex].name);return true;case keys.RW:if(sRewFun!=1)return false;bucketsList(
listCatIndex);return true;case keys.PREV:if(sPNFun!=1)return false;bucketsList(listCatIndex);return true;case keys.FF:if(
sRewFun!=1)return false;infoProgramm(listArray[selIndex].name);return true;case keys.NEXT:if(sPNFun!=1)return false;
infoProgramm(listArray[selIndex].name);return true;case keys.N0:case keys.YELLOW:case keys.TOOLS:_crData.selIndex=selIndex;
searchRec();return true;case keys.ENTER:_crData.selIndex=selIndex;selectREC();return true}return false};
listCaption.innerHTML=_("Archive. Category: ")+catsArray[listCatIndex]+" ("+listArray.length+")";
listPodval.innerHTML=btnDiv(keys.RETURN,strRETURN,"Category",sArrowFun==2?strLEFT:sRewFun==1?strRW:sPNFun==1?strPREV:""
)+btnDiv(keys.N2,strInfo,"Description","2",sArrowFun==2?strRIGHT:sRewFun==1?strFF:sPNFun==1?strNEXT:"")+btnDiv(keys.YELLOW,
"","Search",strTools,"0");$("#listPopUp").hide();showPage();$("#dialogbox").hide()}function n(){if(i<r.length){if(s){$(
"#dialogbox").hide();_crData={catIndex:-1,data:[],selIndex:0};return}$("#chan_no").text(i+1);$("#chan_name").text(chanels[
r[i]].channel_name);getEPGchanelCached(r[i],function(t,e){if(e!==null&&e.length){e.sort(function(e,t){return t.time-e.time}
);var r=[];var s=e.filter(function(e){if(e.time<Date.now()/1e3-chanels[t].rec*60*60)return false;if(e.time_to*1e3>Date.now(
))return false;if(r.indexOf(e.name)!=-1)return false;else{r.push(e.name);return true}});s.forEach(function(e){e.ch_id=t});
_crData.data=_crData.data.concat(s)}i++;n()})}else{_crData.data.sort(function(e,t){
return e.name<t.name?-1:e.name>t.name?1:0});t()}}listCatIndex=e;if(_crData.catIndex==listCatIndex&&_crData.data.length){t()
return}var r=cats[catsArray[listCatIndex]].filter(function(e){return chanels[e].rec}),i=0,s=false;_crData={
catIndex:listCatIndex,data:[],selIndex:0};$("#dialogbox").html(
'<center><img src="'+host+"/stbPlayer/buffering.gif?"+__av+'" height="40"><br/>'+_("Download! Wait ...")+(
'<br/><br/><span id="chan_no">1</span>/'+r.length+'<br/><span id="chan_name"></span>')).show();
dialogBoxKeyHandler=function(e){if(e==keys.RETURN||e==keys.EXIT)s=true};setTimeout(n)}function updateMediaInfo(){$(
"#progress").css("width",stbGetPosTime()/stbGetLen()*100+"%");$("#begin_time").text(Math.round(stbGetPosTime()/60));$(
"#end_time").text("+"+Math.round((stbGetLen()-stbGetPosTime())/60))}var playMedia=_playMedia;function _playMedia(t){if(
mediaUrls[mediaUrls.length-1]==-1)mediaSelects[0]=0;setCurrent(catIndex,-1);var e=0,r=medHistory.findIndex(function(e){
return e.stream_url==t.stream_url});if(r!=-1){if(r==0&&playType==-1e11)return;e=Math.floor(medHistory[r].current/60)*60;
medHistory.splice(r,1)}medHistory.unshift(t);medHistory.splice([0,10,20,30,40,50][sMedCount]);$("#picon").css(
"background-image",'url("'+(t.logo_30x30||"")+'")');$("#channel_number").text(" ");$("#channel_name").html(t.title);$(
"#nprogramm_name").html("&nbsp; ");$("#nbegin_time").text("");$("#nend_time").text("");$("#programm_name").html("&nbsp; ");
_prog100=0;$progress_div.css("background-color","#446");$("#progress_r").css("width","0%");$("#progress").css("width","0%")
$("#begin_time").text("");$("#end_time").text("");$("#programm_name2").text("");$("#programm_duration").text("");$(
"#programm_descr").html(getMediaDescr(t));if(sInfoSwitch)showChanelInfo(1);playTime=0;playType=-1e11;forcePlay=true;if(
sStopPlay)stbStop();if(typeof t.stream_url==="function")t.stream_url=t.stream_url();stbPlay(t.stream_url);if(e)confirmBox(
_("Continue watching?")+"<br><br>"+step2text(e),function(){stbSetPosTime(e)})}function searchMedia(e){editCaption=_(
"String for search");var t=stbGetItem("medSearch")||"";editvar=t;setEdit=function(){if(!editvar.length)return;t=editvar;
stbSetItem("medSearch",t);mediaName=e.title;mediaSelects.unshift(0);mediaList(e.playlist_url+(e.playlist_url.indexOf("?"
)==-1?"?":"&")+"search="+t)};showEditKey()}function infoMedia(){if(!listArray[selIndex].description)return;$("#listPopUp"
).hide();saveCPD();var t=listArray[selIndex].title||"";listCaption.innerHTML=t;listPodval.innerHTML=btnDiv(keys.RETURN,
strRETURN,"Close")+(t?btnDiv(keys.N2,strInfo,"TMDb","2",sArrowFun==2?strRIGHT:sRewFun==1?strFF:sPNFun==1?strNEXT:""):"");
aboutKeyHandler=function(e){if(t)switch(e){case keys.RIGHT:if(sArrowFun!=2)break;case keys.N2:case keys.INFO:TMDb.search(t)
return true;case keys.FF:if(sRewFun!=1)break;TMDb.search(t);return true;case keys.NEXT:if(sPNFun!=1)break;TMDb.search(t);
return true}restoreCPD();$("#listAbout").hide().text("");$("#_prd").css("margin-top",0);clearTimeout(detailTimer);
return true};$("#listAbout").html('<div id="_prd">'+getMediaDescr(listArray[selIndex])+"</div>").show();a=$("#_prd"
).height()+10-$("#listAbout").height();scrollUp("_prd",a,1e4)}function selectMedia(){var e=listArray[selIndex];if(
e.adult&&e.adult==1&&sPSchannels&&parentPIN!="*"&&!parentAccess){enterPinAndSetAccess(selectMedia);return}if(
mediaRecordsPar===null)mediaSelects[0]=selIndex;if(e.playlist_url)if(e.search_on)searchMedia(e);else{mediaName=e.title;
mediaSelects.unshift(0);mediaList(e.playlist_url)}else{if(e.stream_url){closeList();playMedia(e)}else infoMedia()}}
function mediaKeyHandler(e){function t(){if(mediaUrls.length==1)popupList(popMedia);else{if(mediaRecordsPar!==null){
mediaRecords=mediaRecordsPar;mediaRecordsPar=null;showMediaList1();return}mediaSelects.shift();mediaUrls.pop();
mediaNames.pop();mediaName=mediaNames.pop();mediaList(mediaUrls.pop())}}if(sArrowFun==2)switch(e){case keys.LEFT:t();
return true;case keys.RIGHT:if(listArray[selIndex].playlist_url)selectMedia();else infoMedia();return true;
case keys.RETURN:closeList();return true}switch(e){case keys.RETURN:t();return true;case keys.N0:case keys.RED:
case keys.PRECH:case keys.EXIT:closeList();return true;case keys.ENTER:selectMedia();return true;case keys.N2:
case keys.INFO:infoMedia();return true;case keys.RW:if(sRewFun!=1)return false;t();return true;case keys.PREV:if(sPNFun!=1
)return false;t();return true;case keys.FF:if(sRewFun!=1)return false;if(listArray[selIndex].playlist_url)selectMedia(
);else infoMedia();return true;case keys.NEXT:if(sPNFun!=1)return false;if(listArray[selIndex].playlist_url)selectMedia(
);else infoMedia();return true;case keys.N8:case keys.TOOLS:case keys.GREEN:if(
sFavorites==-1||mediaUrls.length==1||!listArray.length)return true;if(mediaUrls[mediaUrls.length-1]!=-2){medFavorites.push(
listArray[selIndex]);showShift(listArray[selIndex].title+_(" added to favorites"))}else{listArray.splice(selIndex,1);if(
listArray.length&&selIndex==listArray.length)selIndex--;showPage()}if(sFavorites!=-1)providerSetItem("medFavorites",
JSON.stringify(medFavorites));return true}return false}var mediaName="",mediaRecords=[],mediaRecordsPar=null,mediaUrls=null
,mediaNames=[],mediaSelects=[],medHistory=[],medFavorites=[];function getMediaDescr(e){var t=e.description||"";if(
typeof t==="function")t=t();return t.replace(/script/g,"sсr!!!")}function showMediaList1(){selIndex=mediaSelects[0]||0;
listArray=mediaRecords;var r=(window.innerHeight-90*getHeightK())/pageSize-2,s=6*getWidthK();getListItem=function(e,t){
return(sShowPikon?'<div class="img" style="background-image: url(\''+(e.logo_30x30||""
)+"'); width:"+r+"px;margin-left:"+s+'px;"></div>&nbsp;':"&nbsp;&nbsp;")+e.title};listDetail.innerHTML="";
detailListAction=function(){if(listArray.length===0)return;var e="";var t=listArray[selIndex];if(t.logo_30x30&&(
!t.description||t.description.indexOf("<img")===-1)){var r=Math.floor(133*getWidthK());var s=Math.floor(200*getHeightK());
var n=Math.floor(r/15);
e='<div class="img" style="background-image: url(\''+t.logo_30x30+"');width:"+r+"px;height:"+s+"px;margin:"+n+'px;float:left;"></div>&nbsp;'
}listDetail.innerHTML='<div id="_prd" style="font-size:smaller;">'+e+getMediaDescr(t)+"</div>";if(!sNoSmall)$("img",$(
listDetail)).not("#detal").remove();var i=$("#_prd").height()+10-$(listDetail).height();scrollUp("_prd",i,5e3)};
listKeyHandler=mediaKeyHandler;var e=$("#testFont"),t=($(list).width()||$("#listCaption").width())-$("#listTime").width()*2
e.html(mediaNames.join(" / ")).text(e.text());while(e.width()>t){e.text("..."+e.text().substr(10))}
listCaption.innerHTML=e.text();e.text("");listPodval.innerHTML=btnDiv(keys.RED,"","Close",sArrowFun==2?strRETURN:strPRECH,
"0")+(sArrowFun==2?btnDiv(keys.LEFT,strLEFT,"Back"):btnDiv(keys.RETURN,strRETURN,"Back",
sRewFun==1?strRW:sPNFun==1?strPREV:""))+btnDiv(keys.N2,strInfo,"Description","2")+(
listArray.length&&sFavorites!=-1&&mediaUrls.length!=1?btnDiv(keys.GREEN,"",mediaUrls[mediaUrls.length-1
]!=-2?"Add to favorites":"Delete",strTools,"8"):"");$("#listPopUp").html("").hide();showPage()}function showMediaList(){if(
mediaSelects.length==1&&sFavorites!=-1){mediaRecords.push({title:"",logo_30x30:"",description:"",playlist_url:""});if(
sMedCount)mediaRecords.push({title:_("History of watched movies"),logo_30x30:"",description:"",playlist_url:-1});
mediaRecords.push({title:_("Favorites"),logo_30x30:"",description:"",playlist_url:-2})}mediaNames.push(mediaName);
showMediaList1()}function mediaList(e){if(mediaUrls&&mediaUrls.length&&e==mediaUrls[0]){mediaName="Медиатека";mediaUrls=[];
mediaNames=[];mediaSelects=[mediaSelects.pop()]}if(e===null){if(mediaUrls===null){mediaName="Медиатека";e="";mediaUrls=[];
mediaNames=[];mediaSelects=[0]}else{showMediaList1();return}}if(typeof e==="string"){if(e==="submenu"){mediaSelects.shift()
var t=mediaRecords[selIndex].submenu;if(t===undefined||t.length===0){infoBox("Error: Bad fXML Submenu!");return}
var r=mediaRecords[selIndex].title||mediaRecords[selIndex].playlist_name||undefined;mediaRecordsPar=mediaRecords;
mediaRecords=t;if(r){t=mediaNames;mediaNames=[r]}var s=mediaSelects[0];mediaSelects[0]=0;showMediaList1();mediaSelects[0]=s
if(r)mediaNames=t;return}if(e.indexOf("cmd:info")===0||e.indexOf("alert")===0){mediaSelects.shift();
var n=/(?:cmd:info|alert)\(([^)]+)\)/;var i=n.exec(e);i=i===null?e:i[1];infoBox(i);return}}mediaUrls.push(e);mediaRecords=[
];if(mediaRecordsPar!==null)mediaRecordsPar=null;if(e==-1){mediaRecords=medHistory;showMediaList();return}if(e==-2){
mediaRecords=medFavorites;showMediaList();return}getMediaArray(e,showMediaList)}var epgArray=[];var curProg=-1;
var playTime=0;var _prog100=0;function updateArchiveInfo(s){var e=curList[primaryIndex],t=curProg;$("#picon").css(
"background-image",'url("'+getChannelPicon(e)+'")');$("#channel_number").html(primaryIndex+1);$("#channel_name").html(
chanels[e].channel_name);curProg=epgArray.findIndex(function(e,t,r){return e.time_to>s&&e.time<=s});var r=epgArray[curProg
]||{name:"",time:Math.floor(s/3600)*3600,time_to:(Math.floor(s/3600)+1)*3600,descr:""};$("#programm_name").html(r.name);
_prog100=r;$("#progress").css("width",(s-r.time)/(r.time_to-r.time)*100+"%");$("#progress_r").css("width",
r.time_to>Date.now()/1e3?(r.time_to-Date.now()/1e3)/(r.time_to-r.time)*100+"%":"0%");$progress_div.css("background-color",
"#600");$("#begin_time").text(time2time(r.time));$("#end_time").text("+"+Math.round((r.time_to-s)/60));$("#programm_name2"
).html(r.name);var n=Math.round((s-r.time)/60);$("#programm_duration").html(
'<span id="arc_time" style="color:#a00;">'+time2time(s)+"</span> "+time2str(r.time)+" - "+time2time(r.time_to
)+' (<span id="cur_time">'+(n>0?n+"/":"")+"</span>"+Math.round((r.time_to-r.time)/60)+" "+_("min")+")");$("#programm_descr"
).html(r.descr?getThumbnail(r.icon)+r.descr:"");var i=curProg+1;if(!i)i=epgArray.findIndex(function(e,t,r){return e.time>s}
);if(i>-1&&i<epgArray.length-1){var a=epgArray[i];$("#nprogramm_name").html(a.name);$("#nbegin_time").text(time2time(a.time
));$("#nend_time").text(Math.round((a.time_to-a.time)/60))}else{$("#nprogramm_name").html("&nbsp; ");$("#nbegin_time"
).text("");$("#nend_time").text("")}if(sInfoChange&&t!=curProg&&!$i1.is(":visible"))showChanelInfo(1)}var fileArchive=false
var forcePlay=false;function playArchive(e){var t=curProg;updateArchiveInfo(e);if(sInfoRew)showChanelInfo(1);var r=curList[
primaryIndex];var s=epgArray[curProg]||{name:"",time:Math.floor(e/3600)*3600,time_to:(Math.floor(e/3600)+1)*3600,descr:""};
playTime=0;playType=Math.floor(e);forcePlay=true;if(!fileArchive||t!=curProg){if(sStopPlay)stbStop();stbPlay(getArchiveUrl(
r,e,s.time_to,s),fileArchive?e-s.time:0)}else{stbSetPosTime(e-s.time)}}function selectEpg(){if(!chanels[epg_ch_id
].rec||listArray[selIndex].time>Date.now()/1e3){infoProgramm(listArray[selIndex].name);return}if(ifParentalAccessChId(
epg_ch_id,function(){selectEpg()}))return;closeList();setCurrent(listCatIndex,listChannel,true);epgArray=listEpgArray;
playArchive(listArray[selIndex].time)}var epgTimers=[];function startEpgTimer(e){var t=_("Timer: switch to channel?"
)+"<br><br>"+chanels[e.ci].channel_name+'<div style="color:'+curColor+';">'+e.n+"</div>"+time2time(e.t)+" - "+time2time(
e.te)+" ("+Math.round((e.te-e.t)/60)+" "+_("min")+")",r=e.t*1e3-Date.now();e.ti=setTimeout(function(){confirmBox(t,
function(){closeList();playChannel(e.c,e.i)})},r>0?r:0)}function setEpgTimer(){var t=listArray[selIndex];if(
!epglisted||t.time<Date.now()/1e3)return;var r=epgTimers.findIndex(function(e){return e.ci==epg_ch_id&&e.t==t.time});
confirmBox(r==-1?"Set timer?":"Remove timer?",function(){if(r==-1){var e={ci:epg_ch_id,c:listCatIndex,i:listChannel,
t:t.time,te:t.time_to,n:t.name};startEpgTimer(e);epgTimers.push(e)}else{clearTimeout(epgTimers[r].ti);epgTimers.splice(r,1)
}showPage();providerSetItem("epgTimers",JSON.stringify(epgTimers))})}function loadEpgTimers(){epgTimers=providerGetJson(
"epgTimers",[]);if(!Array.isArray(epgTimers))epgTimers=[];epgTimers.forEach(function(e,t){if(e.te>Date.now()/1e3
)startEpgTimer(e);if(e.t<Date.now()/1e3)epgTimers.splice(t,1)});providerSetItem("epgTimers",JSON.stringify(epgTimers))}
function time2time(e){var t=new Date(e*1e3);return _t2(t.getHours())+":"+_t2(t.getMinutes())}function time2str(e){var t=_(
"Su Mo Tu We Th Fr Sa").split(" "),r=new Date(e*1e3);return t[r.getDay()]+"&nbsp;"+_t2(r.getDate())+"."+_t2(r.getMonth()+1
)+"&nbsp;"+_t2(r.getHours())+":"+_t2(r.getMinutes())}var aboutKeyHandler=null;function loadValue(){var t=false,r;
function s(){clearTimeout(e);t=true;editKey=editKey1;showEdit()}var e=setTimeout(s,6e5);function n(){if(t)return;$.ajax({
url:host_ott_proto+host_ott+"/swop/a.php",data:{c:"get_val",d:r},type:"POST",timeout:1e4,cache:false,success:function(e){
if(t)return;if(e.status==="forbidden")setTimeout(n,5e3);else if(e.status==="success"){editvar=e.data;editPos=editvar.length
editKey=editKey1;_keyCur=_keys.length-1;showEdit()}},error:function(e){$("#listEdit").html(
'<div style="text-align:center;font-size:larger;color:red"><br/><br/>ERROR:<br/>'+e.responseText+"</div>")}})}
listPodval.innerHTML=btnDiv(keys.RETURN,strRETURN,"Close");$("#listEdit").html(
'<div style="text-align:center;font-size:larger;"><br/><br/>'+_("Send request")+"...</div>").show();editKey=function(e){if(
e==keys.RETURN||e==keys.EXIT){s()}return true};$.ajax({url:host_ott_proto+host_ott+"/swop/a.php",data:{c:"get_var",
n:editCaption,v:editvar},type:"POST",timeout:1e4,cache:false,success:function(e){r=e.code;$("#listEdit").html(
'<div style="text-align:center;font-size:larger;"><br/>'+_("Request sended!")+"<br/><br/>"+_("For enter value open"
)+'<br/><span style="font-size:larger;color:'+curColor+'">'+host_ott+"/swop</span> "+_("and enter code"
)+' <span style="font-size:larger;color:'+curColor+'">'+r+"</span><br/><br/>"+_("or scan"
)+":<br/><br/>"+'<div><img src="https://chart.googleapis.com/chart?cht=qr&chs=300x300&chld=|1&chl=https://'+host_ott+"/swop/?"+r+'" style="height:30%;"/></div>'+"</div>"
);setTimeout(n,1e4)},error:function(e){$("#listEdit").html(
'<div style="text-align:center;font-size:larger;color:red"><br/><br/>ERROR:<br/>'+e.responseText+"</div>")}})}
var editCaption="",editvar="",editPos=0,setEdit;var cursorInterval=null;function _changeEdit(){$("#ee").html(
editvar.substr(0,editPos
)+'<div id="cursor" style="display:inline-block;vertical-align:top;background-color:'+curColor+';width:3px;height:1.2em;"></div>'+editvar.substr(
editPos));clearInterval(cursorInterval);var e=true,t=$("#cursor");cursorInterval=setInterval(function(){e=!e;t.css(
"background-color",e?curColor:"inherit")},500)}var _keyCur=14,_keyUp=false,_keyE=true,_keyP=false,_keys1="1234567890",
_keysA="\0\b\t",_keysL="abcdefghijklmnopqrstuvwxyz",_keysP=".:/@,!?<>#$%^&*()-=_+;'\"[]{}`~",_keys="",_keysSymbol=[{
s:"",a:function(){_setCase(!_keyUp);showEdit()}},{s:"",a:function(){if(!_keysSymbol[1].s)return;_keyP=false;_setLang(!_keyE
);showEdit()}},{s:"",a:function(){_setPunct(!_keyP);showEdit()}},{s:"&hearts;&trade;",a:loadValue},{s:"&larr;",a:function(
){if(editPos){editPos--;_changeEdit()}}},{s:"&rarr;",a:function(){if(editPos<editvar.length){editPos++;_changeEdit()}}},{
s:"_",a:function(){editvar=editvar.substr(0,editPos)+" "+editvar.substr(editPos);editPos++;_changeEdit()}},{s:"",
a:function(){if(editPos){editvar=editvar.substr(0,editPos-1)+editvar.substr(editPos);editPos--;_changeEdit()}}},{s:"",
a:function(){}},{s:"Ok",a:function(){clearInterval(cursorInterval);restoreCPD();$("#listEdit").hide();setEdit()}}];
function _setCase(e){if(_keyP)return;_keyUp=e;_keys=_keyUp?_keys.toUpperCase():_keys.toLowerCase();_keysSymbol[0
].s=_keyUp?"&darr;a":"&uarr;A";if(!sNoColorKeys)_keysSymbol[0].s='<span style="border-bottom:3px solid red;">'+_keysSymbol[
0].s+"</span>"}function _setLang(e){var t=_("alhabet");_keyE=e;var r=e?_keysL:t,s=Math.floor(r.length/10);if(r.length%10
)r=(r+_keysP).substr(0,(s+1)*10);_keys=_keys1+r+_keysA;_keysSymbol[2].s="!?,";_setCase(_keyUp);_keyCur=_keys.length-9}
function _setPunct(e){_keyP=e;if(e){_keys=_keys1+_keysP+_keysA;_keysSymbol[0].s="";_keysSymbol[2].s="abc"}else _setLang(
_keyE);_keyCur=_keys.length-8}function showEditKey1(e){function t(e,t){if(_keysSymbol[e].s)_keysSymbol[e
].s='<span style="border-bottom:3px solid '+t+';">'+_keysSymbol[e].s+"</span>"}saveCPD();if(stbGetItem("ottplaylang"
)=="_eng")_keyE=true;_keysSymbol[1].s=stbGetItem("ottplaylang"
)=="_eng"?"":'<span style="font-family:fontello;padding:0.2em;">&#xe80E;</span>';_keysSymbol[7
].s='<span style="font-family:fontello;padding:0.2em;">&#xe804;</span>';_keysSymbol[9].s="Ok";if(!sNoColorKeys){t(1,"green"
);t(7,"#bb0");t(9,"blue")}editPos=editvar.length;if(_keyCur>_keys.length-10)_keyCur=14;var r=_keyCur;_setPunct(_keyP);
_keyCur=r;showEdit()}function showEdit(){var e=$("#listEdit"),t=e.width()/12;var r=editCaption+":<br/><br/>";
r+='<div id="ee" style="width:100%;white-space:pre-wrap;word-wrap:break-word;"></div>';for(var s=0;s<_keys.length;s++){if(
s%10==0)r+="<br/>";var n=_keysSymbol[_keys.charCodeAt(s)]!=undefined?_keysSymbol[_keys.charCodeAt(s)].s:_keys[s];
r+='<div id="ik'+s+'" onclick="clickKey('+s+');" style="display:inline-block;width:'+t+"px;height:"+t+"px;text-align:center;vertical-align:middle;line-height:"+t+'px;">'+n+"</div>"
}e.html(r).show();_changeEdit();$("#ik"+_keyCur).css({"background-color":curColorB,"color":curColor});
listPodval.innerHTML=btnDiv(keys.RETURN,strRETURN,"Close")+btnDiv(keys.RED,"",_keysSymbol[0
].s?_keyUp?"&darr;a":"&uarr;A":"",strTools)+btnDiv(keys.GREEN,"",_keysSymbol[1].s?_keyE?_("lang"):"English":"",strFF
)+btnDiv(keys.YELLOW,"","Delete",strRW)+btnDiv(keys.BLUE,"","Ok",strPlayPause)}function clickKey(e){event.stopPropagation()
$("#ik"+_keyCur).css({"background-color":"","color":""});_keyCur=e;$("#ik"+_keyCur).css({"background-color":curColorB,
"color":curColor});editKey1(keys.ENTER)}function editKey1(e){function t(e){$("#ik"+_keyCur).css({"background-color":"",
"color":""});_keyCur+=e;$("#ik"+_keyCur).css({"background-color":curColorB,"color":curColor})}switch(e){case keys.UP:t(
_keyCur>9?-10:_keys.length-10);return;case keys.DOWN:t(_keyCur<_keys.length-10?10:-_keys.length+10);return;case keys.LEFT:
t(_keyCur%10>0?-1:9);return;case keys.RIGHT:t(_keyCur%10<9?1:-9);return;case keys.TOOLS:case keys.RED:_keysSymbol[0].a();
return;case keys.FF:case keys.GREEN:_keysSymbol[1].a();return;case keys.RW:case keys.YELLOW:_keysSymbol[7].a();return;
case keys.PLAY:case keys.PAUSE:case keys.BLUE:_keysSymbol[9].a();return;case keys.ENTER:if(_keys.charCodeAt(_keyCur)>9){
editvar=editvar.substr(0,editPos)+_keys[_keyCur]+editvar.substr(editPos);editPos++;_changeEdit()}else{_keysSymbol[
_keys.charCodeAt(_keyCur)].a()}return;case keys.EXIT:case keys.RETURN:clearInterval(cursorInterval);restoreCPD();$(
"#listEdit").hide();return;default:var r=_keys.indexOf(String.fromCharCode(e));if(r>-1){t(r-_keyCur);editKey1(keys.ENTER)}
return}}var editKey=editKey1;var showEditKey=showEditKey1;var parentPIN="",parentAccess=false;function setParentAccess(e,t
){parentAccess=e;if(parentAccess){setTimeout(function(){parentAccess=false},36e5);t()}else showShift(_(
"Wrong parental code !!!"))}function enterPinAndSetAccess(t){enterPinCode(_("Enter parental code"),function(e){if(!e)return
setParentAccess(e==parentPIN,t)})}function ifParentalAccess(e,t,r){try{if(sPSchannels&&parentPIN!="*"&&!parentAccess){
var s=cats[catsArray[e]],n=s[t];if(parentalArray.indexOf(n)!=-1){enterPinAndSetAccess(r);return true}}}catch(e){
console.error(e)}return false}function ifParentalAccessChId(e,t){try{if(sPSchannels&&parentPIN!="*"&&!parentAccess){if(
parentalArray.indexOf(e)!=-1){enterPinAndSetAccess(t);return true}}}catch(e){console.error(e)}return false}var newPin;
function parentControlSetup(){if(parentPIN!="*"&&!parentAccess){enterPinAndSetAccess(parentControlSetup);return}function e(
){function t(){stbSetItem("parentPIN",parentPIN);var e=1;saveIfChanged(e++,"sPSchannels",true);saveIfChanged(e++,
"sPSoptions",true);if(optIndexOf(selectProvaider)!=-1)saveIfChanged(e++,"sPSprovs",true);showShift(_("Settings saved"));
closeList();optionsList(parentControlSetup)}if(parentPIN!="*"!=(listArray[0].val==1)){if(parentPIN!="*"){parentPIN="*";t()
}else{enterPinCode(_("Set parental code"),function(e){if(!e)return;newPin=e;enterPinCode(_("Repeat parental code"),
function(e){if(!e)return;if(e!=newPin)showShift(_("Wrong parental code !!!"));else{parentPIN=e;setParentAccess(true,t)}})})
}}else t()}var t=[_("no"),_("yes")];listArray=[{name:_("Parental control"),val:parentPIN!="*"?1:0,values:t},{name:_(
"Protect Adult Channels"),val:sPSchannels,values:t},{name:_("Protect Settings"),val:sPSoptions,values:t},{name:_(
"Protect Change Provider"),val:sPSprovs,values:t},{name:"",val:0,values:nofun,cur:""},{name:'<div class="btn">'+_(
"Save Settings")+"</div>",val:0,values:e,cur:""}];if(optIndexOf(selectProvaider)==-1)listArray.splice(3,1);
listCaption.innerHTML=_("Parental control");_setSetup(e,function(){optionsList(parentControlSetup)})}var optionsArr=[{
action:settingsInterface,name:"Interface settings"},{action:settingsLists,name:"Lists settings"},{action:settingsChannels,
name:"Channel list settings"},{action:settingsInfobar,name:"Infobar settings"},{action:settingsButtons,
name:"Buttons settings"},{action:settingsMenu,name:"Menu items settings"},{action:parentControlSetup,
name:"Parental control"},{action:noSelProv},{action:selectProvaider,name:"Change provider",
desc:"Change provider - you can change the provider, and it will be remembered at the next start of player!"},{
action:edit_dealer,name:"Enter Provider Code"},{action:settingsManage,name:"Manage settings"},{action:selectLang,
name:"Change interface language"}];function indexOfAction(e,t){for(var r=0;r<e.length;r++)if(e[r].action==t)return r;
return-1}function optIndexOf(e){return indexOfAction(optionsArr,e)}function delOption(e){var t=optIndexOf(e);if(t>-1
)optionsArr.splice(t,1)}function addBtn2menu(e,t,r){if(!r)return;var s=indexOfAction(e,t);if(s>-1)listArray[s
]='<div class="btn">'+r+"</div> "+listArray[s]}function optionsList(e){if(sPSoptions&&parentPIN!="*"&&!parentAccess){
enterPinAndSetAccess(optionsList);return}listArray=[];optionsArr.forEach(function(e){listArray.push(_(e.name||""))});if(
!sNoNumbersKeys)addBtn2menu(optionsArr,selectProvaider,"9");addBtn2menu(optionsArr,selectProvaider,strTools);selIndex=0;if(
typeof e!=="undefined")for(var t=0;t<optionsArr.length;t++)if(optionsArr[t].action==e)selIndex=t;getListItem=function(e,t){
return"&nbsp;&nbsp;"+e};detailListAction=function(){listDetail.innerHTML=_(optionsArr[selIndex].desc||optionsArr[selIndex
].name||"");if(optionsArr[selIndex].action==noSelProv)nselprov=0};listKeyHandler=function(e){switch(e){case keys.RETURN:
popupList(optionsList);return true;case keys.ENTER:if(optionsArr[selIndex].action)optionsArr[selIndex].action();return true
case keys.TOOLS:case keys.N9:if(optIndexOf(selectProvaider)>-1)selectProvaider();return true}return false};
listCaption.innerHTML=_("Settings");listPodval.innerHTML=btnDiv(keys.RETURN,strRETURN,"Close");$("#listPopUp").hide();
showPage()}function saveIfChanged(e,t,r){if(r===undefined)r=false;if(window[t]==listArray[e].val)return;window[t
]=listArray[e].val;if(r)stbSetItem(t,window[t]);else providerSetItem(t,window[t])}function settingsInterface(){function e(
){var e=0;saveIfChanged(e++,"sStopPlay",true);if(typeof stbPlayPip==="function"){saveIfChanged(e++,"sPipSize",true);
saveIfChanged(e++,"sPipPos",true)}saveIfChanged(e++,"sFont",true);saveIfChanged(e++,"sTimezone",true);saveIfChanged(e++,
"sSleepTimeout",true);if(typeof stbSetOsdOpacity==="function")saveIfChanged(e++,"sOsdOpacity",true);if(
typeof stbGetVolume==="function")if(sVolumeStep!=listArray[e++].val+3){sVolumeStep=listArray[e-1].val+3;stbSetItem(
"sVolumeStep",sVolumeStep)}e++;if(sSHLcolor!=eSHLcolor){sSHLcolor=eSHLcolor;stbSetItem("sSHLcolor",sSHLcolor)}e++;if(
sSHLcolSel!=eSHLcolSel){sSHLcolSel=eSHLcolSel;stbSetItem("sSHLcolSel",sSHLcolSel)}e++;if(sSHLcolorB!=eSHLcolorB){
sSHLcolorB=eSHLcolorB;stbSetItem("sSHLcolorB",sSHLcolorB)}saveIfChanged(e++,"sPermanentTime",true);saveIfChanged(e++,
"sGrapI",true);saveIfChanged(e++,"s10resum",true);saveIfChanged(e++,"sPrevCount",true);if(typeof getMediaArray=="function"
)saveIfChanged(e++,"sMedCount",true);if(typeof showEditKey2==="function")saveIfChanged(e++,"sEditor",true);if(
typeof stbPlayers!=="undefined"&&Array.isArray(stbPlayers))saveIfChanged(e++,"sPlayers");if(
typeof stbSetBuffer==="function")saveIfChanged(e++,"sBufSize",true);setTimezone();setFontSize();setListPos();setColor();
setEditor();setPipPosBuf();if(typeof setPlayer==="function")setPlayer();if(typeof setAutorun==="function")setAutorun();if(
typeof stbSetBuffer==="function")stbSetBuffer();showShift(_("Settings saved"));closeList();optionsList(settingsInterface)}
var t=[_("no"),_("yes")],r=arrTimezone.slice();r[0]=_(r[0]);listArray=[{name:_("Black screen while switching the channel"),
val:sStopPlay,values:t},{name:_("PiP window size"),val:sPipSize,values:[_("small"),_("medium"),_("large")]},{name:_(
"PiP window position"),val:sPipPos,values:[_("top-right"),_("bottom-right"),_("left-bottom"),_("top-left")]},{name:_(
"Font type"),val:sFont,values:['<span style="font-family:Helvetica, Arial, sans-serif;">'+_("system")+"</span>",
'<span style="font-family:Roboto;">Roboto</span>','<span style="font-family:RobotoCondensed;">Roboto Condensed</span>',
'<span style="font-family:Caveat;">Caveat</span>','<span style="font-family:Liberation;">Liberation</span>',
'<span style="font-family:Gabriela;">Gabriela</span>','<span style="font-family:PTSansNarrow;">PTSansNarrow</span>']},{
name:_("Timezone"),val:sTimezone,values:r},{name:_("Sleep timer"),val:sSleepTimeout,values:[_("off"),_("30 minutes"),_(
"1 hour"),_("2 hours"),_("3 hours")]},{name:_("Interface transparency"),val:sOsdOpacity,values:["100%","90%","80%","70%",
"60%","50%","40%","30%","20%","10%","0%"]},{name:_("Volume step, %"),val:sVolumeStep-3,values:[3,4,5,6,7,8,9,10]},{name:_(
"Color spectrum"),val:sSHLcolor,values:colorDialog,cur:_("select")},{name:_("Background color of selected item"),
val:sSHLcolSel,values:selColorDialog,cur:_("select")},{name:_("Background color"),val:sSHLcolorB,values:backColorDialog,
cur:_("select")},{name:_("Permanent clock on screen"),val:sPermanentTime,values:[_("no"),_("yes"),_("transparent")]},{
name:_("Graphical indication"),val:sGrapI,values:t},{name:_("Position shift -10 seconds after pause"),val:s10resum,values:t
},{name:_("Remember previous channels"),val:sPrevCount,values:[1,5,10,15,20]},{name:_("History in Media Library"),
val:sMedCount,values:[_("no"),10,20,30,40,50]},{name:_("Editor"),val:sEditor,values:[_("built-in"),_("native")]},{name:_(
"Type of player for streaming"),val:sPlayers},{name:_("Buffer Size, s"),val:sBufSize},{name:"",val:0,values:nofun,cur:""},{
name:'<div class="btn">'+_("Save Settings")+"</div>",val:0,values:e,cur:""}];if(typeof stbSetBuffer!=="function"
)listArray.splice(18,1);else listArray[18].values=stbBufferSizes;if(typeof stbPlayers!=="undefined"&&Array.isArray(
stbPlayers))listArray[17].values=stbPlayers;else listArray.splice(17,1);if(typeof showEditKey2!=="function"
)listArray.splice(16,1);if(typeof getMediaArray!=="function")listArray.splice(15,1);if(typeof stbGetVolume!=="function"
)listArray.splice(7,1);if(typeof stbSetOsdOpacity!=="function")listArray.splice(6,1);if(typeof stbPlayPip!=="function"
)listArray.splice(1,2);eSHLcolor=sSHLcolor;eSHLcolorB=sSHLcolorB;eSHLcolSel=sSHLcolSel;listCaption.innerHTML=_(
"Interface settings");_setSetup(e,function(){optionsList(settingsInterface)})}function settingsInfobar(){function e(){
var e=0;if(sInfoTimeout!=listArray[e++].val+3){sInfoTimeout=listArray[e-1].val+3;stbSetItem("sInfoTimeout",sInfoTimeout)}
saveIfChanged(e++,"sInfoSlide",true);saveIfChanged(e++,"sInfoSwitch",true);saveIfChanged(e++,"sInfoChange",true);
saveIfChanged(e++,"sInfoRew",true);saveIfChanged(e++,"sThumbnail",true);showShift(_("Settings saved"));closeList();
optionsList(settingsInfobar)}var t=[_("no"),_("yes")];listArray=[{name:_("Infobar display timeout, s"),val:sInfoTimeout-3,
values:[3,4,5,6,7,8,9,10]},{name:_('"Sliding" infobar'),val:sInfoSlide,values:t},{name:_("Show when switching"),
val:sInfoSwitch,values:t},{name:_("Show when changing program"),val:sInfoChange,values:t},{name:_("Show when rewind"),
val:sInfoRew,values:t},{name:_("Show thumbnails"),val:sThumbnail,values:t},{name:"",val:0,values:nofun,cur:""},{
name:'<div class="btn">'+_("Save Settings")+"</div>",val:0,values:e,cur:""}];listCaption.innerHTML=_("Infobar settings");
_setSetup(e,function(){optionsList(settingsInfobar)})}function settingsLists(){function e(){var e=0;saveIfChanged(e++,
"sNoSmall",true);if(sPageSize!=listArray[e++].val+10){sPageSize=listArray[e-1].val+10;stbSetItem("sPageSize",sPageSize)}
saveIfChanged(e++,"sFontShift",true);saveIfChanged(e++,"sListPos",true);saveIfChanged(e++,"sShowScroll",true);setFontSize()
setListPos();setColor();showShift(_("Settings saved"));closeList();optionsList(settingsLists)}var t=[_("no"),_("yes")];
listArray=[{name:_("Not reduce video when showing the list (bugfix)"),val:sNoSmall,values:t},{name:_(
"Number of rows in lists"),val:sPageSize-10,values:[10,11,12,13,14,15,16,17,18,19,20,21,22,23,24,25,26,27,28,29,30]},{
name:_("Distance between lines in lists"),val:sFontShift,values:["0",1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20,21,
22,23,24,25,26,27,28,29,30]},{name:_("List location"),val:sListPos,values:[_("right"),_("left")]},{name:_(
"Show scrollbar in list"),val:sShowScroll,values:t},{name:"",val:0,values:nofun,cur:""},{name:'<div class="btn">'+_(
"Save Settings")+"</div>",val:0,values:e,cur:""}];listCaption.innerHTML=_("Lists settings");_setSetup(e,function(){
optionsList(settingsLists)})}function settingsChannels(){function e(){var e=0;saveIfChanged(e++,"sShowNum");saveIfChanged(
e++,"sShowPikon");saveIfChanged(e++,"sShowName");saveIfChanged(e++,"sShowProgram");saveIfChanged(e++,"sShowProgress");
saveIfChanged(e++,"sShowArchive");saveIfChanged(e++,"sShowDescr");saveIfChanged(e++,"sPreview");if(sNextCountL!=listArray[
e++].val){sNextCountL=listArray[e-1].val;sNextCount=sNextCountL?sNextCountL-1:0;providerSetItem("sNextCount",sNextCountL-1)
}saveIfChanged(e++,"sFavorites",true);showShift(_("Settings saved"));closeList();optionsList(settingsChannels)}var t=[_(
"no"),_("yes")];listArray=[{name:_("Show channel number in list"),val:sShowNum,values:t},{name:_(
"Show picons in channel list"),val:sShowPikon,values:[_("no"),"1x1","3x4"]},{name:_("Show channel name in list"),
val:sShowName,values:t},{name:_("Show program name"),val:sShowProgram,values:t},{name:_("Show progress in channel list"),
val:sShowProgress,values:t},{name:_("Show archive availability in list"),val:sShowArchive,values:t},{name:_(
"Show description"),val:sShowDescr,values:t},{name:_("Preview in channel list"),val:sPreview,values:[_("no"),_("always"),_(
"on ")+strENTER]},{name:_("Number of next TV programs in channel list"),val:sNextCountL,values:[_("no"),1,2,3,4,5,6,7,8,9,
10]},{name:_("Channel list editing style"),val:sFavorites!=-1?sFavorites:nofun,values:sFavorites!=-1?[_("All categories"),
_('"Favorites"')]:'<span style="color:gray;">'+_('"Favorites"')+"</span>"},{name:"",val:0,values:nofun,cur:""},{
name:'<div class="btn">'+_("Save Settings")+"</div>",val:0,values:e,cur:""}];listCaption.innerHTML=_(
"Channel list settings");_setSetup(e,function(){optionsList(settingsChannels)})}function settingsButtons(){function e(){
var e=0;saveIfChanged(e++,"sArrowFun",true);if(keys.RW)saveIfChanged(e++,"sRewFun",true);if(keys.PREV)saveIfChanged(e++,
"sPNFun",true);saveIfChanged(e++,"sALfun",true);saveIfChanged(e++,"sARfun",true);saveIfChanged(e++,"sAUfun",true);
saveIfChanged(e++,"sADfun",true);if(keys.RW)saveIfChanged(e++,"sRWfun",true);if(keys.RW)saveIfChanged(e++,"sFFfun",true);
if(keys.PREV)saveIfChanged(e++,"sPREVfun",true);if(keys.PREV)saveIfChanged(e++,"sNEXTfun",true);if(!sNoColorKeys){
saveIfChanged(e++,"sRfun",true);saveIfChanged(e++,"sGfun",true);saveIfChanged(e++,"sYfun",true);saveIfChanged(e++,"sBfun",
true)}saveIfChanged(e++,"sEfun",true);saveIfChanged(e++,"sOkfun",true);if(!sNoNumbersKeys){listArray[e].val=d[listArray[e
].val];saveIfChanged(e++,"s13dur",true);listArray[e].val=d[listArray[e].val];saveIfChanged(e++,"s46dur",true);listArray[e
].val=d[listArray[e].val];saveIfChanged(e++,"s79dur",true)}saveIfChanged(e++,"sNoColorKeys",true);saveIfChanged(e++,
"sNoNumbersKeys",true);showShift(_("Settings saved"));closeList();optionsList(settingsButtons)}var t=[_("no"),_("yes")],
r="Behavior of %1/%2 buttons in lists",s="Button %1 function when viewing",n="Rewind step by buttons %1/%2",
i='<div class="btn',a=i+'">',o="</div>",l='">&nbsp;'+o,c=[_("paging"),_("volume"),"dune-php","neutrino"],u=[_("Records"),_(
"Menu"),_("Previous"),_("Rewind"),_("Info"),_("Aspect"),_("Audio"),"PiP",_("Close PiP"),_("Category"),_("EPG"),_("Media"),
_("Joystick"),"V+","V-","P+","P-",_("Subtitle"),"-1 "+_(" m ").trim(),"+1 "+_(" m ").trim(),_("Prev"),_("Next")],d=[5,10,15
,20,30,60,120,180,240,300,600,900,1200,1800,3600],p=[],f=d.indexOf(s13dur),h=d.indexOf(s46dur),y=d.indexOf(s79dur);if(
typeof stbToggleAspectRatio!=="function")u[5]="@@@";if(typeof stbToggleAudioTrack!=="function")u[6]="@@@";if(
typeof stbPlayPip!=="function"){u[7]="@@@";u[8]="@@@"}if(typeof stbGetVolume!=="function"){u[13]="@@@";u[14]="@@@";c[1
]="@@@"}if(typeof stbToggleSubtitle!=="function")u[17]="@@@";d.forEach(function(e){p.push(step2text(e).substr(2).trim())});
listArray=[{name:_(r,a+strLEFT+o,a+strRIGHT+o),val:sArrowFun,values:c},{name:_(r,a+strRW+o,a+strFF+o),val:sRewFun,values:[
_("paging"),"dune-php","neutrino"]},{name:_(r,a+strPREV+o,a+strNEXT+o),val:sPNFun,values:[_("paging"),"dune-php","neutrino"
,_("begin/end")]},{name:_(s,a+strLEFT+o),val:sALfun,values:u},{name:_(s,a+strRIGHT+o),val:sARfun,values:u},{name:_(s,
a+strUP+o),val:sAUfun,values:u},{name:_(s,a+strDOWN+o),val:sADfun,values:u},{name:_(s,a+strRW+o),val:sRWfun,values:u},{
name:_(s,a+strFF+o),val:sFFfun,values:u},{name:_(s,a+strPREV+o),val:sPREVfun,values:u},{name:_(s,a+strNEXT+o),val:sNEXTfun,
values:u},{name:_(s,i+" red"+l),val:sRfun,values:u},{name:_(s,i+" green"+l),val:sGfun,values:u},{name:_(s,i+" yellow"+l),
val:sYfun,values:u},{name:_(s,i+" blue"+l),val:sBfun,values:u},{name:_(s,a+strRETURN+o),val:sEfun,values:[_("Nothing"),_(
"Exit"),_("Joystick"),_("Menu"),_("Previous")]},{name:_("Button function %1 when viewing archive",a+strENTER+o),val:sOkfun,
values:[_("EPG"),_("Channels")]},{name:_(n,a+1+o,a+3+o),val:f,values:p},{name:_(n,a+4+o,a+6+o),val:h,values:p},{name:_(n,
a+7+o,a+9+o),val:y,values:p},{name:_("Remote (color buttons N/A)"),val:sNoColorKeys,values:t},{name:_(
"Remote (number buttons N/A)"),val:sNoNumbersKeys,values:t},{name:"",val:0,values:nofun,cur:""},{name:a+_("Save Settings"
)+o,val:0,values:e,cur:""}];if(sNoNumbersKeys)listArray.splice(17,3);if(sNoColorKeys)listArray.splice(11,4);if(!keys.PREV
)listArray.splice(9,2);if(!keys.RW)listArray.splice(7,2);if(!keys.PREV)listArray.splice(2,1);if(!keys.RW)listArray.splice(1
,1);listCaption.innerHTML=_("Buttons settings");_setSetup(e,function(){optionsList(settingsButtons)})}var sHideMenus=[];
function settingsMenu(){function e(){sHideMenus=[];for(var e=0;e<popupActions.indexOf(noProvParam);e++){if(listArray[e].val
)sHideMenus.push(popupActions[e].name)}stbSetItem("sHideMenus",sHideMenus.join(","));showShift(_("Settings saved"));
optionsList(settingsMenu)}var t=[_("yes"),_("no")];listArray=[];for(var r=0;r<popupActions.indexOf(noProvParam);r++){
listArray.push({name:_(popupArray[r]),val:sHideMenus.indexOf(popupActions[r].name)==-1?0:1,values:t})}listArray.push({
name:"",val:0,values:nofun,cur:""});listArray.push({name:'<div class="btn">'+_("Save Settings")+"</div>",val:0,values:e,
cur:""});listCaption.innerHTML=_("Select menu items");_setSetup(e,function(){optionsList(settingsMenu)})}
function settingsManage(){function e(){confirmBox("Clear all settings?",function(){try{stbClearAllItems()}catch(e){
console.error(e)}restart()})}listArray=[{action:sendSettings,name:_("Save settings")},{action:loadSettings,name:_(
"Load settings")},{action:nofun,name:""},{action:e,name:_("Clear settings")},{action:nofun,name:""},{action:edit_dealer,
name:_("Enter Provider Code")},{action:edit_dealer_remote,name:_("Enter Provider Code on PC or Phone")}];if(
typeof stbClearAllItems!=="function")listArray.splice(2,2);if(typeof stbGetAllItems!=="function")listArray.splice(0,1);if(
typeof loadOpt==="function")listArray.splice(0,0,{action:loadOpt,name:_("Load settings from storage")});if(
typeof saveOpt==="function")listArray.splice(0,0,{action:saveOpt,name:_("Save settings to storage")});selIndex=0;
getListItem=function(e,t){return"&nbsp;&nbsp;"+e.name};detailListAction=function(){listDetail.innerHTML=_(listArray[
selIndex].desc||listArray[selIndex].name||"")};listKeyHandler=function(e){switch(e){case keys.RETURN:optionsList(
settingsManage);return true;case keys.ENTER:if(listArray[selIndex].action)listArray[selIndex].action();return true}
return false};listCaption.innerHTML=_("Manage settings");listPodval.innerHTML=btnDiv(keys.RETURN,strRETURN,"Close");$(
"#listPopUp").hide();showPage()}var __test="";function sendSettings(){function t(){clearTimeout(e);$("#listAbout").hide()}
var e=setTimeout(t,6e5);$("#listAbout").html('<div style="text-align:center;font-size:larger;"><br/><br/>'+_(
"Send settings")+"...</div>").show();aboutKeyHandler=function(e){if(e==keys.RETURN||e==keys.EXIT)t();return true};
var r='<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE properties SYSTEM "http://java.sun.com/dtd/properties.dtd">\n<properties>\n<comment>OTT-Play Preferences</comment>'
var s=stbGetAllItems();for(prop in s){if(hasOwnProperty.call(s,prop))r+='\n<entry key="'+prop+'">'+s[prop]+"</entry>"}
r+="\n</properties>";$.ajax({url:host_ott_proto+host_ott+"/swop/a.php",data:{c:"send",d:r},type:"POST",timeout:1e4,
cache:false,success:function(e){$("#listAbout").html('<div style="text-align:center;font-size:larger;"><br/>'+_(
"Settings sended!")+"<br/><br/>"+_("For download settings file open"
)+'<br/><span style="font-size:larger;color:'+curColor+'">'+host_ott+"/swop</span> "+_("and enter code"
)+' <span style="font-size:larger;color:'+curColor+'">'+e.code+"</span><br/><br/>"+_("or scan"
)+":<br/><br/>"+'<div><img src="https://chart.googleapis.com/chart?cht=qr&chs=300x300&chld=|1&chl=https://'+host_ott+"/swop/?"+e.code+'" style="height:30%;"/></div>'+"</div>"
)},error:function(e){$("#listAbout").html(
'<div style="text-align:center;font-size:larger;color:red"><br/><br/>ERROR:<br/>'+e.responseText+"</div>")}})}
function loadSettings(){var s=false,t;function r(){clearTimeout(e);s=true;$("#listAbout").hide()}var e=setTimeout(r,6e5);
function n(){if(s)return;$.ajax({url:host_ott_proto+host_ott+"/swop/a.php",data:{c:"get",d:t},type:"POST",timeout:1e4,
cache:false,success:function(e){if(s)return;if(e.status==="forbidden")setTimeout(n,5e3);else if(e.status==="success"){
var t=e.data;if(t.indexOf("<comment>OTT-Play Preferences</comment>")!=-1){$("#listAbout").html(
'<div style="text-align:center;font-size:200%;"><br/><br/>OTT-Play Preferences received!<br/>Restart player...</div>');
var r=t.split('<entry key="');r.shift();try{stbClearAllItems()}catch(e){console.error(e)}r.forEach(function(e){e=e.split(
"</entry>")[0].split('">');stbSetItem(e[0],e[1])});restart()}else $("#listAbout").html(
'<div style="text-align:center;font-size:larger;color:red"><br/><br/>ERROR:<br/>File not OTT-Play Preferences!!!</div>')}}}
)}$("#listAbout").html('<div style="text-align:center;font-size:larger;"><br/><br/>'+_("Send request")+"...</div>").show();
aboutKeyHandler=function(e){if(e==keys.RETURN||e==keys.EXIT){r()}return true};$.ajax({
url:host_ott_proto+host_ott+"/swop/a.php",data:{c:"get_code"},type:"POST",timeout:1e4,cache:false,success:function(e){
t=e.code;$("#listAbout").html('<div style="text-align:center;font-size:larger;"><br/>'+_("Request sended!")+"<br/><br/>"+_(
"For upload settings file open")+'<br/><span style="font-size:larger;color:'+curColor+'">'+host_ott+"/swop</span> "+_(
"and enter code")+' <span style="font-size:larger;color:'+curColor+'">'+t+"</span><br/><br/>"+_("or scan"
)+":<br/><br/>"+'<div><img src="https://chart.googleapis.com/chart?cht=qr&chs=300x300&chld=|1&chl=https://'+host_ott+"/swop/?"+t+'" style="height:30%;"/></div>'+"</div>"
);setTimeout(n,1e4)},error:function(e){$("#listAbout").html(
'<div style="text-align:center;font-size:larger;color:red"><br/><br/>ERROR:<br/>'+e.responseText+"</div>")}})}var infoArr=[
{action:buttonsInfo,name:"Description of remote control buttons"},{action:donate,
name:'Donate <div class="btn" style="background-color:orange;">donate</div>',
desc:"Voluntary donation for the development of project"},{action:nofun},{action:betaPage,name:"Beta test",
desc:"Switches the player to test mode for a limited period of time."},{action:pluginInfo,name:"About",
desc:"Player and device info"}];function infoList(e){listArray=[];infoArr.forEach(function(e){listArray.push(_(e.name||""))
});if(!sNoNumbersKeys){addBtn2menu(infoArr,pluginInfo,"2");addBtn2menu(infoArr,betaPage,"8")}addBtn2menu(infoArr,pluginInfo
,strInfo);selIndex=0;if(typeof e!=="undefined")for(var t=0;t<infoArr.length;t++)if(infoArr[t].action==e)selIndex=t;
getListItem=function(e,t){return"&nbsp;&nbsp;"+e};detailListAction=function(){listDetail.innerHTML=_(infoArr[selIndex
].desc||infoArr[selIndex].name||"")};listKeyHandler=function(e){switch(e){case keys.RETURN:popupList(infoList);return true;
case keys.ENTER:if(infoArr[selIndex].action)infoArr[selIndex].action();return true;case keys.N8:betaPage();return true;
case keys.N2:case keys.INFO:pluginInfo();return true}return false};listCaption.innerHTML=_("Information");
listPodval.innerHTML=btnDiv(keys.RETURN,strRETURN,"Close");$("#listPopUp").hide();showPage()}function buttonsInfo(){
var e='<br/><div class="btn">',t="</div> - ",r='</div>/<div class="btn">',s='</div>&nbsp;<div class="btn">',n=_(
" (if archive exists)"),i=(strPRECH?e+strPRECH+t+_("Return to previous channel"):"")+(strPip?e+strPip+t+_(
"Call PiP / PiP exchange"):"")+(strInfo?e+strInfo+t+_("Info about TV program"):"")+(!sNoColorKeys||strTools?"<br/>"+(
!sNoColorKeys?'<div class="btn yellow">&nbsp;</div>&nbsp;':"")+(strTools?'<div class="btn">'+strTools+"</div>&nbsp;":""
)+"- "+_("Show player menu"):"")+(strSETUP?e+strSETUP+t+_("Settings"):"")+e+strENTER+t+_("Show channel selection list"
)+e+strRETURN+t+_("Hide / Return")+e+strEXIT+t+_("Exit player")+(!sNoColorKeys||strEPG?"<br/>"+(
!sNoColorKeys?'<div class="btn red">&nbsp;</div>&nbsp;':"")+(strEPG?'<div class="btn">'+strEPG+"</div>&nbsp;":"")+"- "+_(
"Show EPG and archive for channel"):"")+(!sNoColorKeys?'<br/><div class="btn blue">&nbsp;'+t+_("Channel category selection"
):"")+(strAspect?e+strAspect+t+_("Toggle Aspect Ratio"):"")+(strZoom?e+strZoom+t+_("Toggle Zoom Mode"):"")+(
strAudio?e+strAudio+t+_("Switch sound track"):"")+(strSubt?e+strSubt+t+_("Switch subtitle"):"")+(
typeof strStbButtons==="undefined"?"":strStbButtons())+"<br/><br/>"+_("In live mode: <br/>")+(
!sNoNumbersKeys?e+'1</div>...<div class="btn">0'+t+_("Channel selection by number"):"")+e+strSTOP+t+_("Restart stream"
)+e+strPLAY+s+strPAUSE+s+"0"+t+_("Pause/Play")+n+e+strPREV+t+_("Timeshift: to start of TV program")+n+e+strRW+t+_(
"Timeshift: one minute back")+n+e+strFF+s+strNEXT+t+_("Show rewind window")+n+_("<br/><br/>In archive mode:<br/>"
)+e+strPLAY+s+strPAUSE+s+"0"+t+_("Pause/Play")+e+strSTOP+s+"8"+t+_("Stop playback and return to In live mode"
)+e+strPREV+s+"2"+t+_("To start of TV program / Previous TV program")+e+strNEXT+s+"5"+t+_("Next TV program"
)+e+strRW+r+strFF+t+_("Back / Forward for 1 minute")+(!sNoNumbersKeys?e+"1"+r+"3"+t+_("Back / Forward for 15 seconds"):""
)+(!sNoNumbersKeys?e+"4"+r+"6"+t+_("Back / Forward for 3 minutes"):"")+(!sNoNumbersKeys?e+"7"+r+"9"+t+_(
"Back / Forward for 10 minutes"):"")+e+strDOWN+s+strUP+t+_("Show rewind window");saveCPD();listCaption.innerHTML=_(
"Description of remote control buttons");listPodval.innerHTML=btnDiv(keys.RETURN,strRETURN,"Close");listDetail.innerHTML=""
$("#listAbout").html('<div id="_prd">'+i+"</div>").show();var a=$("#_prd").height()+10-$("#listAbout").height();scrollUp(
"_prd",a,1e4);aboutKeyHandler=function(e){if(e==keys.RETURN){restoreCPD();$("#listAbout").hide().text("");clearTimeout(
detailTimer)}return true}}function pluginInfo(){$("#listAbout").show().html(_("Player info:"
)+"<br/>"+version+"<br/>Authors: alex &copy; 2018-2022 / prog4food<br/>"+"<br/>Install ID: "+(__iid?__iid:"-"
)+"<br/>HTTPS support: "+(client_can_https?"Yes":"No")+"<br/>OTT / APP host: "+(host?host:"-"
)+" / "+window.location.host+"<br/><br/>"+_("Device info:")+"<br/>");stbInfo();aboutKeyHandler=function(e){return false}}
if(typeof client_can_https==="undefined")var client_can_https;if(typeof client_can_https!=="boolean"){try{
var _xhr=new XMLHttpRequest;_xhr.open("GET","https://s.ottp.eu.org/generate_204",true);_xhr.onerror=function(){
client_can_https=false};_xhr.onreadystatechange=function(){if(_xhr.readyState===4&&_xhr.status===204){client_can_https=true
}};_xhr.send()}catch(e){client_can_https=false;console.error(e)}}function betaPage(){var t=function(e,t){$("#dialogbox"
).html("<center>Изображение покажет текущую версию плеера:<br/>"+('<img src="'+(host+e)+"?t="+t+"&r="+Math.random(
).toString(10)+'"><br/>')+(e!="/beta.png"?"<strong>Не забудьте перезапустить плеер, а желательно устройство</strong>":""
)+"</center>").show();dialogBoxKeyHandler=function(e){$("#dialogbox").hide()}};var r=0;var s=function(e){r+=e;if(
r==i.length)r=0;if(r<0)r=i.length-1;listArray[2]="Время тестирования: "+i[r];showPage()};var n=function(){t(
"/beta-mode.png",e[r])};selIndex=0;var i=["5 минут","15 минут","1 час","3 часа","12 часов","1 день","3 дня","7 дней",
"Закончить"],e=[5,15,60,180,720,1440,4320,10080,0],o=["Покажет текущий статус участия в бета-тестировании","",
"Выберите время использования бета версии.<br>"+"Для начала выбирайте минимальное, если плеер хотя бы загружается, можно больше.<br>"+i.join(
", "),"Включает режим бета бета-тестирования на установленный период",
"Перезапускает плеер, но на некоторых устройствах есть проблема с полным перезапуском, в такх случаях лучше перезапускать все устройство"
];listArray=["Какая версия сейчас?","","Время тестирования: "+i[r],(sNoNumbersKeys?"":'<div class="btn">8</div> '
)+"Применить",(sNoNumbersKeys?"":'<div class="btn">9</div> ')+_("Restart player")+" (но лучше устройство)"];
getListItem=function(e,t){return"&nbsp;&nbsp;"+e};detailListAction=function(){listDetail.innerHTML=o[selIndex];
listPodval.innerHTML=btnDiv(keys.RETURN,strRETURN,"Close")+(selIndex==2?btnDiv(keys.ENTER,strENTER,"Change value",strLEFT,
strRIGHT):"")};listKeyHandler=function(e){a=1;switch(e){case keys.LEFT:a=-1;case keys.RIGHT:if(selIndex!=2)return false;
case keys.ENTER:switch(selIndex){case 0:t("/beta.png",0);return true;case 2:s(a);return true;case 3:n();return true;case 4:
restart();return true}return true;case keys.RETURN:popupList(popupActions.indexOf(noProvParam)+1);return true;case keys.N8:
n();return true;case keys.N9:restart();return true;default:return false}};listDetail.innerHTML="";listCaption.innerHTML=_(
"Settings")+" / Beta test";$("#listPopUp").hide();showPage()}function onPlayerStart(){initBackgroundIntervals()}
function createEventObject(){ott_event=document.createTextNode("ott_event");if(!ott_event)client_feedb(
"benchy_EventSupport::ERR::ott_event is empty");ott_event.ev={test:createNewEvent("test")}}function popBuckets(){
bucketsList(catIndex)}function popEpg(){epgList(catIndex,primaryIndex,false)}function popRecords(){recordsList(catIndex,
primaryIndex,false)}function popMedia(){if(typeof getMediaArray=="function")mediaList(null)}function popPrevProg(){
closeList();prevProg()}function popShift(){closeList();shiftArchiveSelect(0)}function popPause(){closeList();_doKey(keys.N0
)}function popStop(){closeList();_doKey(keys.STOP)}function popTogglePip(){closeList();togglePip()}function popStopPip(){
pipIndex=null;stbStopPip();closeList()}function restart(){stbStop();window.location.href=window.location.href;
window.location.reload(true)}function donate(){var s=host+"/stbPlayer/donate";var e=stbGetItem("ottplaylang")||"";if(
e=="_eng")e="";$("#listAbout").text("").show().load(""+s+e+".html?"+__av,function(e,t,r){if(t=="error")$("#listAbout"
).load(s+".html?"+__av)});aboutKeyHandler=function(e){return false}}function nofun(){}function noSelProv(){if(++nselprov<7
)return;if(sPSprovs&&parentPIN!="*"&&!parentAccess){enterPinAndSetAccess(noSelProv);return}var e=parseInt(stbGetItem(
"noSelProv"))||0;confirmBox(e?"Show providers?":"Hide providers?",function(){stbSetItem("noSelProv",e?0:1);restart()});
nselprov=0}function noProvParam(){if(++nprovparams<7)return;if(sPSoptions&&parentPIN!="*"&&!parentAccess){
enterPinAndSetAccess(noProvParam);return}var e=parseInt(stbGetItem("noProvParam"))||0;confirmBox(
e?"Show provider settings?":"Hide provider settings?",function(){stbSetItem("noProvParam",e?0:1);restart()});nprovparams=0}
function clearAllsettings(){if(++_clearAll<7)return;confirmBox("Clear all settings?",function(){try{stbClearAllItems()
}catch(e){console.error(e)}restart()});_clearAll=0}function delPopup(e){var t=popupActions.indexOf(e);if(t===-1)return;
popupArray.splice(t,1);popupDetail.splice(t,1);popupActions.splice(t,1)}function stbAudioTracksExists(){return true}
function stbSubtitleExists(){return true}var popupArray=["Toggle Aspect Ratio","Toggle Zoom Mode","Switch sound track",
"Switch subtitle","Return to previous channel","Pause/Play","Restart stream / Live","Rewind","Call PiP / PiP exchange",
"Close PiP","Category selection","Show EPG and archive for channel","Show list of channel archive records",
"Show Media Library","","","Settings","Restart player","Exit player","Information"];var popupDetail=["","","","","","","",
"Show rewind window","","","","","Show list of channel archive records without duplication","","","","","","",""];
var popupActions=[toggleAspectRatio,toggleZoom,toggleAudioTrack,toggleSubtitle,popPrevProg,popPause,popStop,popShift,
popTogglePip,popStopPip,popBuckets,popEpg,popRecords,popMedia,noProvParam,nofun,optionsList,restart,exitPortal,infoList];
function popupList(i){var a=0,o=0;function l(e,t){try{e=e.split("/")[t?1:0].trim()}catch(e){console.error(e)}return e}if(
typeof i==="undefined")i=0;selIndex=0;listArray=[];var c=false,u=-1;try{c=curList[primaryIndex]}catch(e){console.error(e)}
popupActions.forEach(function(e,t){if(sHideMenus.indexOf(popupActions[t].name)!=-1)return;var r=_(popupArray[t]);try{
switch(e){case toggleAudioTrack:if(!c||!stbAudioTracksExists())return;else break;case toggleSubtitle:if(
!c||!stbSubtitleExists())return;else break;case popPause:r=l(r,!stbIsPlaying());case popShift:case popRecords:if(
playType<0||!c||chanels[c].rec)break;else return;case popTogglePip:r=l(r,pipIndex!=null);break;case popStopPip:if(
pipIndex==null)return;else break;case popStop:r=l(r,playType);break;case popMedia:if(typeof getMediaArray!="function"
)return;else break}}catch(e){console.error(e)}var s=_(popupDetail[t])||r;u++;if(i==t||i==e)selIndex=u;if(!sNoNumbersKeys){
var n="";switch(e){case toggleAudioTrack:n="1";break;case infoList:n="2";break;case popPrevProg:n="3";break;case popShift:
n="4";break;case popTogglePip:n="5";break;case popStopPip:n="6";break;case popStop:n="7";break;case restart:n="8";break;
case optionsList:n="9";break;case exitPortal:n="0";break}if(n)r='<div class="btn">'+n+"</div> "+r}if(!sNoColorKeys){
var n="";switch(e){case popBuckets:n="blue";break;case popEpg:n="red";break;case popRecords:n="green";break;case popMedia:
n="yellow";break}if(n)r='<div class="btn '+n+'">&nbsp;</div> '+r}var n="";switch(e){case infoList:n=strInfo;break;
case popPrevProg:n=strPRECH;break;case popTogglePip:n=strPip;break;case toggleAudioTrack:n=strAudio;break;
case toggleSubtitle:n=strSubt;break;case toggleZoom:n=strZoom;break;case toggleAspectRatio:n=strAspect;break;
case optionsList:n=strTools;break;case popPause:n=strPlayPause;break;case popStop:n=strSTOP;break}if(n
)r='<div class="btn">'+n+"</div> "+r;listArray.push({name:r,desc:s,action:e});if(e==noProvParam)a=listArray.length-1;if(
e==optionsList)o=listArray.length});getListItem=function(e,t){return"&nbsp;&nbsp;"+e.name};detailListAction=function(){
listDetail.innerHTML=listArray[selIndex].desc;if(listArray[selIndex].action==noProvParam)nprovparams=0};
listKeyHandler=function(e){switch(e){case keys.RETURN:closeList();return true;case keys.ENTER:if(
sPSoptions&&a&&o&&selIndex>a&&selIndex<o&&parentPIN!="*"&&!parentAccess){enterPinAndSetAccess(listArray[selIndex].action);
return true}listArray[selIndex].action();return true;case keys.ZOOM:toggleZoom();return true;case keys.ASPECT:
toggleAspectRatio();return true;case keys.N1:case keys.AUDIO:toggleAudioTrack();return true;case keys.SUBT:toggleSubtitle()
return true;case keys.N9:case keys.TOOLS:optionsList();return true;case keys.EPG:case keys.RED:epgList(catIndex,
primaryIndex,false);return true;case keys.GREEN:recordsList(catIndex,primaryIndex,false);return true;case keys.BLUE:
bucketsList(catIndex);return true;case keys.YELLOW:if(typeof getMediaArray=="function")mediaList(null);return true;
case keys.N3:case keys.PRECH:popPrevProg();return true;case keys.N4:popShift();return true;case keys.PAUSE:case keys.PLAY:
popPause();return true;case keys.N7:case keys.STOP:popStop();return true;case keys.N5:case keys.PIP:popTogglePip();
return true;case keys.N6:popStopPip();return true;case keys.N2:case keys.INFO:infoList();return true;case keys.N8:restart()
return true;case keys.N0:exitPortal();return true}return false};listCaption.innerHTML=_("Menu");
listPodval.innerHTML=btnDiv(keys.RETURN,strRETURN,"Close");$("#listPopUp").hide();showPage()}function setPipPosBuf(){if(
typeof setPipPos!=="function")return;var e=Math.min(getWidthK(),getHeightK()),t=[{x:256,y:144},{x:384,y:216},{x:512,y:288}]
,r={width:t[sPipSize].x*e,height:t[sPipSize].y*e,right:sPipPos<2?20*e:"auto",left:sPipPos>1?20*e:"auto",
top:sPipPos==0||sPipPos==3?20*e:"auto",bottom:sPipPos==1||sPipPos==2?20*e:"auto"};$("#pip_buffering").css(r);setPipPos(r)}
var _curVal;function clickVal(e){event.stopPropagation();if(_curVal==e)aboutKeyHandler(keys.ENTER);$("#ik"+_curVal).css({
"background-color":"","color":""});_curVal=e;$("#ik"+_curVal).css({"background-color":curColorB,"color":curColor})}
function selectValue(t){var r;function s(e){$("#ik"+_curVal).css({"background-color":"","color":""});_curVal+=e;$(
"#ik"+_curVal).css({"background-color":curColorB,"color":curColor});listDetail.innerHTML=r[_curVal]}saveCPD();
r=t.values.filter(function(e){return e!="@@@"});_curVal=r.indexOf(t.values[t.val]);listCaption.innerHTML=t.name;
listPodval.innerHTML=btnDiv(keys.RETURN,strRETURN,"Close")+btnDiv(keys.ENTER,strENTER,"Set");listDetail.innerHTML="";
var n=6,e=0,i=$("#testFont"),a=t.name+":<br/>";for(var o=0;o<r.length;o++){i.html("&nbsp;"+r[o]+"&nbsp;");e=e>i.width(
)?e:i.width();i.text("")}n=Math.max(Math.min(Math.round($("#listAbout").width()/e)-1,r.length),Math.round(r.length/6)+1);
for(var o=0;o<r.length;o++){if(o%n==0)a+="<br/>";
a+='<div id="ik'+o+'" onclick="clickVal('+o+');" style="display:inline-block;width:'+98/n+"%;overflow:hidden;text-align:center;vertical-align:middle;line-height:"+800*getHeightK(
)/pageSize+'px;">'+r[o]+"</div>"}$("#listAbout").html('<div style="font-size:larger;">'+a+"</div>").show();$("#ik"+_curVal
).css({"background-color":curColorB,"color":curColor});listDetail.innerHTML=r[_curVal];aboutKeyHandler=function(e){switch(e
){case keys.UP:s(_curVal>n-1?-n:r.length-r.length%n+(_curVal+1>r.length%n?-n:0));return;case keys.DOWN:s(
_curVal<r.length-n?n:-_curVal+_curVal%n);return;case keys.LEFT:s(
_curVal%n>0?-1:_curVal+n-1>r.length-1?r.length-_curVal-1:n-1);return;case keys.RIGHT:s(
_curVal%n<n-1?_curVal+1==r.length?-_curVal%n:1:-n+1);return;case keys.ENTER:t.val=t.values.indexOf(r[_curVal]);
case keys.RETURN:$("#listAbout").text("").hide();restoreCPD();showPage();return;default:return}}}function _setSetup(r,s){
selIndex=0;getListItem=function(e,t){return'<div style="float:right; width:23%; overflow:hidden; text-align:right;">'+(
e.values[e.val]||e.cur
)+"&nbsp;&nbsp;</div>"+'<div style="float:left; width:75%; overflow:hidden;">&nbsp;&nbsp;'+e.name+"</div>"};
listDetail.innerHTML="";detailListAction=function(){var e=listArray[selIndex];listDetail.innerHTML=(Array.isArray(e.values
)?e.name+"<br/><br/>"+_("Choose from")+":<br/>"+e.values.filter(function(e){return e!="@@@"}).join(", "):e.cur)+(
e.desc?"<br/><br/>"+e.desc:"")};listPodval.innerHTML=btnDiv(keys.RETURN,strRETURN,"Close")+btnDiv(keys.ENTER,strENTER,
"Change value",strLEFT,strRIGHT)+btnDiv(keys.GREEN,"","Save Settings",strPlayPause,"0");listKeyHandler=function(e){
var t=listArray[selIndex];switch(e){case keys.ENTER:if(typeof t.values==="function")t.values();if(Array.isArray(t.values
)&&t.values.length>2){selectValue(t);return true}case keys.RIGHT:if(Array.isArray(t.values)){
t.val=t.val>t.values.length-2?0:t.val+1;if(t.values[t.val]=="@@@")listKeyHandler(e);else showPage()}return true;
case keys.LEFT:if(Array.isArray(t.values)){t.val=t.val==0?t.values.length-1:t.val-1;if(t.values[t.val]=="@@@"
)listKeyHandler(e);else showPage()}return true;case keys.N0:case keys.PLAY:case keys.PAUSE:case keys.GREEN:r();return true;
case keys.RETURN:s();return true}return false};showPage()}function toggleMute(){if(typeof stbToggleMute!=="function")return
stbToggleMute();$("#mute").toggle()}var volumeTimeout=null;function changeVolume(e){if(typeof stbGetVolume!=="function"
)return;var t=stbGetVolume()+e;t=Math.max(t,0);t=Math.min(t,100);stbSetVolume(t);_showVolume(t)}function _showVolume(e){$(
"#volume").css("height",100-e+"%");$("#volume_div").show();$("#mute").hide();clearTimeout(volumeTimeout);
volumeTimeout=setTimeout(function(){$("#volume_div").hide()},2e3)}var pipIndex=null,pipCatIndex=null;function togglePip(){
if(pipIndex==null){pipIndex=primaryIndex;pipCatIndex=catIndex;stbPlayPip(getChannelUrl(curList[pipIndex]))}else{if(
pipCatIndex==catIndex&&pipIndex==primaryIndex)return;var e=pipIndex;var t=pipCatIndex;pipIndex=primaryIndex;
pipCatIndex=catIndex;playChannel(t,e);stbPlayPip(getChannelUrl(cats[catsArray[pipCatIndex]][pipIndex]))}}
function showShift(e){numProg.innerHTML=e;numProg.style.display="";clearTimeout(numTimeout);numTimeout=setTimeout(function(
){numProg.style.display="none"},3e3)}function showSelectBox(s,n,i,a){clearTimeout(numTimeout);if(n.length==0)return;if(
n.length==1){showShift(n[0]);return}if(typeof a==="undefined")a=3e3;function r(e){if(e===n.length)s=0;else if(e<0
)s=n.length-1;else s=e;if(a)i(s);var r="";n.forEach(function(e,t){r+='<div style="'+(
t==s?"color:"+curColor+";background-color:"+curColorB:"")+'" onclick="_doKey('+(-100+t
)+');">&nbsp;&nbsp;'+e+"&nbsp;&nbsp;</div>"});numProg.innerHTML=r;if(a)numTimeout=setTimeout(function(){
numProg.style.display="none";selectBoxKeyHandler=null},a)}closeList();if(a==-1){a=0;r(s)}else if(a)r(s+1);else{r(s);
numTimeout=setTimeout(function(){i(s);numProg.style.display="none";selectBoxKeyHandler=null},2e3)}numProg.style.display="";
selectBoxKeyHandler=function(e){clearTimeout(numTimeout);switch(e){case keys.ENTER:if(!a)i(s);case keys.RETURN:
numProg.style.display="none";selectBoxKeyHandler=null;return true;case keys.UP:r(s-1);return true;case keys.DOWN:r(s+1);
return true;case keys.LEFT:r(0);return true;case keys.RIGHT:r(n.length-1);return true;default:var t=100+e;if(
t<0||t>n.length-1)return false;if(t==s)selectBoxKeyHandler(keys.ENTER);else r(t);return true}}}function _ch_id(e){if(
playType==-1e11)return e=="aAspects"||e=="aZooms"?"-1media":null;return curList[primaryIndex]}function getCHarr(e){if(
typeof e=="string"){var t=_ch_id(e);if(t!=null){var r=window[e][t];if(typeof r!=="undefined"){return r}}}return 0}
function execCHarr(e,t){if(typeof e!=="string"||typeof t!=="function")return;var r=_ch_id(e);if(r==null)return;
var s=window[e][r];if(typeof s==="undefined"){if(e=="aAspects"||e=="aZooms")s=0;else return}try{t(s)}catch(e){
console.error(e)}}function saveCHarr(e,t){if(typeof e!=="string")return;if(typeof window[e]!="object"||window[e]==null
)window[e]={};var r=_ch_id(e);if(r==null)return;if(!t){if(typeof window[e][r]==="undefined")return;else delete window[e][r]
}else{if(t==window[e][r])return;else window[e][r]=t}setTimeout(function(){providerSetItem(e,JSON.stringify(window[e]))})}
var _shiftTimer=null,_shiftSec=0;function shiftArchive(e){if(e==-6e6){_shiftSec=e;_shiftArchive()}_shiftSec+=e;
clearTimeout(_shiftTimer);if(sInfoRew)showChanelInfo(1);showShift(step2text(_shiftSec));_shiftTimer=setTimeout(
_shiftArchive,500)}function _shiftArchive(){var e=_shiftSec;_shiftSec=0;clearTimeout(_shiftTimer);if(!e)return;if(!playType
){if(e<0)timeShift(-e);else{showShift(_("Restart stream"));playChannel(catIndex,primaryIndex)}return}function t(){if(
e==-6e6)showShift(_("To begining"));else showShift(step2text(e))}if(playType<0){var r=Math.max(stbGetPosTime()+e,0);if(
r>stbGetLen())return;stbSetPosTime(r);t();if(sInfoRew)showChanelInfo(1);return}playType+=e+playTime;if(playType<Date.now(
)/1e3){t();playArchive(playType)}else{showShift(_("Live"));playChannel(catIndex,primaryIndex)}}function step2text(e){
var t=Math.floor(Math.abs(e)/60),r=Math.abs(e)%60;return!e?"&nbsp;":(e>0?">> ":"<< ")+(t?t+_(" m "):"")+(r?r+_(" s"):"")}
function shiftArchiveSelect(e){if(!playType&&!chanels[curList[primaryIndex]].rec)return;var i=0;var t=null;function r(e){
clearTimeout(t);i+=e;$("#step").html(step2text(i));t=setTimeout(function(){$("#dialogbox").hide();tooltip.style.display="";
shiftArchive(i)},3e3);if(!sInfoRew)return;setTimeout(function(){if(playType<0){var e=Math.max(Math.round(stbGetPosTime()+i)
,0),t=stbGetLen();var r=Math.floor(e/3600),s=Math.floor(e%3600/60),n=e%60;$tooltipSpan.text((r?r+":":"")+_t2(s)+":"+_t2(n))
}else if(!playType){var e=Math.round(Date.now()/1e3-_prog100.time+i),t=_prog100.time_to-_prog100.time;$tooltipSpan.text(
pos2text(Date.now()/1e3+i))}else{var e=Math.round(playType+playTime-_prog100.time+i),t=_prog100.time_to-_prog100.time;
$tooltipSpan.text(pos2text(playType+playTime+i))}tooltip.style.display="block";tooltip.style.top=$progress_div.offset(
).top-$progress_div.height()+"px";tooltip.style.left=Math.min(Math.max($progress_div.position(
).left+e/t*$progress_div.width()-tooltip.offsetWidth/2,20),$progress_div.position().left+$progress_div.width()+10)+"px"})}
$("#dialogbox").html(_("Rewind"
)+':<br/><span id="step" style="font-size: 150%;"></span><br/>'+'<br><div class="btn" onclick="_doKey(keys.UP);">'+strUP+'</div>&nbsp;<div class="btn" onclick="_doKey(keys.DOWN);">'+strDOWN+"</div>&nbsp;+/- "+_(
"1 minute"
)+"&nbsp;&nbsp;"+'<div class="btn" onclick="_doKey(keys.LEFT);">'+strLEFT+'</div>&nbsp;<div class="btn" onclick="_doKey(keys.RIGHT);">'+strRIGHT+"</div>&nbsp;+/- "+_(
"10 Seconds")+"<br/>"+btnDiv(keys.ENTER,strENTER,"Go to")+btnDiv(keys.RETURN,strRETURN,"Close")).show();if(sInfoRew
)showChanelInfo(1);r(e);dialogBoxKeyHandler=function(e){switch(e){case keys.N1:r(-s13dur);return;case keys.N3:r(s13dur);
return;case keys.N4:r(-s46dur);return;case keys.N6:r(s46dur);return;case keys.N7:r(-s79dur);return;case keys.N9:r(s79dur);
return;case keys.FF:case keys.UP:r(60);return;case keys.RW:case keys.DOWN:r(-60);return;case keys.RIGHT:r(10);return;
case keys.LEFT:r(-10);return;case keys.EXIT:case keys.RETURN:$("#dialogbox").hide();infoBarHide();tooltip.style.display="";
clearTimeout(t);return;case keys.ENTER:$("#dialogbox").hide();clearTimeout(t);shiftArchive(i);tooltip.style.display="";
return;default:return}}}function timeShift(n){var e=curList[primaryIndex];if(!chanels[e].rec)return;getEPGchanelCached(e,
function(t,e){var r=[];if(e!==null&&e.length){r=e.filter(function(e){return e.time>Date.now()/1e3-chanels[t].rec*60*60}
).sort(function(e,t){return e.time-t.time})}epgArray=r;setCurProg(t,e,null);setCurrent(catIndex,primaryIndex,true);if(n){
showShift(step2text(-n));playArchive(Math.round(Date.now()/1e3)-n)}else{showShift(_("Archive - begin"));
var s=epgArray.findIndex(function(e,t,r){return e.time_to>=Date.now()/1e3&&e.time<=Date.now()/1e3});playArchive(epgArray[s
].time)}})}function liveStop(){if(!stbIsPlaying())return;var e=curList[primaryIndex];if(!chanels[e].rec)return;
getEPGchanelCached(e,function(t,e){var r=[];if(e!==null&&e.length){r=e.filter(function(e){return e.time>Date.now(
)/1e3-chanels[t].rec*60*60}).sort(function(e,t){return e.time-t.time})}epgArray=r;setCurProg(t,e,null);playType=Math.round(
Date.now()/1e3);playTime=0;showChanelInfo(2);showShift(_("Pause"));stbPause()})}var epgCash=0,epgCashObj={},epgCashArr=[];
setInterval(function(){epgCashObj={};epgCashArr=[]},432e5);var getEPGchanelCur,getMediaArray;var arrayGetCurProg=[];
function doGetCurProg(){if(arrayGetCurProg.length===0)return;var r=arrayGetCurProg.shift();getEPGchanelCurCached(r.ch_id,
function(e,t){setCurProg(e,t,r.callback);doGetCurProg()})}function getCurProgData(e,t){var r=chanels[e];if(!r)return false;
if(r.time_to&&r.time_to>=Date.now()/1e3)return true;if(r.time_request&&r.time_request>Date.now()/1e3)return false;
var s=false;if(r.nextpr){setCurProg(e,r.nextpr,nofun);r.time_request=0}if(r.time_to&&r.time_to>=Date.now()/1e3)s=true;
arrayGetCurProg.push({ch_id:e,callback:t});if(arrayGetCurProg.length<2)doGetCurProg();return s}function getEpgFromCash(e){
epgCashArr.splice(epgCashArr.indexOf(e),1);epgCashArr.unshift(e);return epgCashObj[e]}function getEPGchanelCached(e,r){if(
!epgCash){getEPGchanel(e,r);return}function t(e,t){epgCashObj[e]=t;if(epgCashArr.unshift(e)>epgCash)epgCashArr.splice(
epgCash).forEach(function(e){delete epgCashObj[e]});r(e,getEpgFromCash(e))}if(epgCashObj[e])r(e,getEpgFromCash(e)
);else getEPGchanel(e,t)}function getEPGchanelCurCached(e,t){if(!epgCash){getEPGchanelCur(e,t);return}if(epgCashObj[e])t(e,
getEpgFromCash(e));else getEPGchanelCur(e,t)}var epgreturn=false;function epgKeyHandler(e){switch(e){case keys.LEFT:if(
sArrowFun!=2)return false;case keys.N3:case keys.CH_LIST:case keys.YELLOW:channelsList(listCatIndex,listChannel);
return true;case keys.RETURN:if(!epgreturn)closeList();else channelsList(listCatIndex,listChannel);return true;
case keys.ENTER:selectEpg();return true;case keys.N1:case keys.PLAY:case keys.PAUSE:case keys.BLUE:bucketsList(listCatIndex
);return true;case keys.RIGHT:if(sArrowFun!=2)return false;case keys.N2:case keys.INFO:infoProgramm(listArray[selIndex
].name);return true;case keys.RW:if(sRewFun!=1)return false;channelsList(listCatIndex,listChannel);return true;
case keys.PREV:if(sPNFun!=1)return false;channelsList(listCatIndex,listChannel);return true;case keys.FF:if(sRewFun!=1
)return false;infoProgramm(listArray[selIndex].name);return true;case keys.NEXT:if(sPNFun!=1)return false;infoProgramm(
listArray[selIndex].name);return true;case keys.N0:case keys.EPG:case keys.STOP:case keys.RED:switch(epglisted){case 0:
epgList(listCatIndex,listChannel,epgreturn);return true;case 1:epgListAlpha(listCatIndex,listChannel,epgreturn);return true
case 2:if(chanels[epg_ch_id].rec)recordsList(listCatIndex,listChannel,epgreturn);else epgList(listCatIndex,listChannel,
epgreturn);return true}return true;case keys.N8:case keys.TOOLS:case keys.GREEN:setEpgTimer();return true}return false}
var epglisted=1;var listChannel;var listEpgArray;var epg_ch_id=null;var curEpgData=null;function detailEPG(){
var e=listArray[selIndex];
listDetail.innerHTML='<div id="_name"><div style="color:'+curColor+';">'+e.name+'</div><div style="font-size:smaller;">'+time2str(
e.time)+" - "+time2time(e.time_to)+" ("+Math.round((e.time_to-e.time)/60)+" "+_("min"
)+")</div></div>"+'<div id="_descr" style="font-size:smaller;overflow:hidden;"><div id="_prd">'+getThumbnail(e.icon
)+e.descr+"</div></div>";var t=$("#listDetail").height()-$("#_name").height();$("#_descr").height(t);t=$("#_prd").height(
)+10-t;scrollUp("_prd",t,5e3);if(e.time>Date.now()/1e3)$("#bTimer").show();else $("#bTimer").hide()}function itemEPG(t,e){
var r=t.time<Date.now()/1e3&&chanels[epg_ch_id].rec?"red":"";if(!r)r=epgTimers.findIndex(function(e){
return e.ci==epg_ch_id&&e.t==t.time})>-1?"lime":"";if(r)r=' style="color:'+r+'"';return"&nbsp;<span"+r+">"+time2str(t.time
)+"</span>&nbsp;&nbsp;"+t.name}function epgPodval(){listPodval.innerHTML=btnDiv(keys.RED,"",epglisted==2?chanels[epg_ch_id
].rec?"Records":"By time":epglisted?"By alphabet":"By time",strSTOP,"0")+btnDiv(keys.BLUE,"","Category",strPlayPause,"1"
)+btnDiv(keys.YELLOW,"","Channel list","3",sArrowFun==2?strLEFT:sRewFun==1?strRW:sPNFun==1?strPREV:"")+btnDiv(keys.N2,
strInfo,"Description","2",sArrowFun==2?strRIGHT:sRewFun==1?strFF:sPNFun==1?strNEXT:""
)+'<span id="bTimer" style="display:none;">'+btnDiv(keys.GREEN,"","Timer",strTools,"8")+"</span>"}
function epgShow_miniproc(e,t,r,s,n){epglisted=e;epgreturn=s;listCatIndex=t;listChannel=r;var i=cats[catsArray[listCatIndex
]];var a=i[listChannel];if(e===0&&!chanels[a].rec)return;if(epg_ch_id&&epg_ch_id==a){n(a);return}epg_ch_id=a;
getEPGchanelCached(a,function(e,t){if(!t){listChannel|=65536;infoBox(_("Channel has no EPG"));return}curEpgData=t;n(e);
setCurProg(e,t,null)})}function epgCheckEmpty_miniproc(e,t){if((listChannel&65536)===65536&&(listChannel&65535
)===t&&listCatIndex===e){infoBox(_("Channel has no EPG"));return true}return false}function epgList(e,t,r){if(
epgCheckEmpty_miniproc(e,t))return;function s(t){var e=[];if(curEpgData!==null&&curEpgData.length){e=curEpgData.filter(
function(e){return chanels[t].rec?e.time>Date.now()/1e3-chanels[t].rec*60*60:e.time_to>Date.now()/1e3-2*60*60}).sort(
function(e,t){return e.time-t.time})}var r=playType>0&&t==curList[primaryIndex]?playType+playTime:Math.floor(Date.now()/1e3
);selIndex=e.findIndex(function(e){return e.time_to>=r&&e.time<=r});if(selIndex===-1)selIndex=0;listArray=e;listEpgArray=e;
getListItem=itemEPG;detailListAction=detailEPG;listKeyHandler=epgKeyHandler;listCaption.innerHTML=_(
"EPG and archive. Channel: ")+chanels[t].channel_name;epgPodval();$("#listPopUp").hide();showPage()}epgShow_miniproc(1,e,t,
r,s)}function epgListAlpha(e,t,r){if(epgCheckEmpty_miniproc(e,t))return;function s(t){var e=[],r=[];if(
curEpgData!==null&&curEpgData.length){e=curEpgData.filter(function(e){return chanels[t].rec?e.time>Date.now()/1e3-chanels[t
].rec*60*60:e.time_to>Date.now()/1e3-2*60*60}).sort(function(e,t){return e.time-t.time});r=curEpgData.filter(function(e){
return chanels[t].rec?e.time>Date.now()/1e3-chanels[t].rec*60*60:e.time_to>Date.now()/1e3}).sort(function(e,t){
return e.name<t.name?-1:e.name>t.name?1:e.time-t.time})}var s=playType>0&&t==curList[primaryIndex
]?playType+playTime:Math.floor(Date.now()/1e3);selIndex=r.findIndex(function(e){return e.time_to>=s&&e.time<=s});if(
selIndex===-1)selIndex=0;listArray=r;listEpgArray=e;getListItem=itemEPG;detailListAction=detailEPG;
listKeyHandler=epgKeyHandler;listCaption.innerHTML=_("EPG and archive. Channel: ")+chanels[t].channel_name;epgPodval();$(
"#listPopUp").hide();showPage()}epgShow_miniproc(2,e,t,r,s)}function recordsList(e,t,r){if(epgCheckEmpty_miniproc(e,t)
)return;function s(t){var e=[],r=[];if(curEpgData!==null&&curEpgData.length){e=curEpgData.filter(function(e){
return e.time>Date.now()/1e3-chanels[t].rec*60*60}).sort(function(e,t){return e.time-t.time});var s=[];curEpgData.sort(
function(e,t){return t.time-e.time});r=curEpgData.filter(function(e){if(e.time<Date.now()/1e3-chanels[t].rec*60*60
)return false;if(e.time_to*1e3>Date.now())return false;if(s.indexOf(e.name)!=-1)return false;else{s.push(e.name);
return true}}).sort(function(e,t){return e.name<t.name?-1:e.name>t.name?1:0})}selIndex=0;listArray=r;listEpgArray=e;
getListItem=function(e,t){return"&nbsp;&nbsp;"+e.name};detailListAction=detailEPG;listKeyHandler=epgKeyHandler;
listCaption.innerHTML=_("Archive. Channel: ")+chanels[t].channel_name;epgPodval();$("#listPopUp").hide();showPage()}
epgShow_miniproc(0,e,t,r,s)}function stbSetOsdOpacity(e){var t=parseInt(sSHLcolorB.split(",")[0]),r=parseInt(
sSHLcolorB.split(",")[1]);$(".osd").css("background-color","rgba("+hsvToRgb(t,100,r).join(",")+","+e/100+")")}
function toggleZoom(){if(typeof stbToggleZoom==="function")stbToggleZoom()}function toggleAspectRatio(){if(
typeof stbToggleAspectRatio==="function")stbToggleAspectRatio()}function toggleAudioTrack(){if(
typeof stbToggleAudioTrack==="function")stbToggleAudioTrack()}function toggleSubtitle(){if(
typeof stbToggleSubtitle==="function")stbToggleSubtitle()}function toggleStandby(){clearTimeout(sleepTimeout);$(
"#dialogbox").hide();stbStop();if(typeof stbToggleStandby==="function")stbToggleStandby();else stbExit()}
var sleepTimeout=null,sleepingCount;function sleeping(){if(!sleepingCount){toggleStandby();return}$("#dialogbox").html(_(
"Shutdown after %1 seconds<br/><br/>Cancel - any action",sleepingCount)).show();sleepingCount--;sleepTimeout=setTimeout(
sleeping,1e3)}function setSleepTimeout(){var e=[0,18e5,36e5,72e5,108e5];clearTimeout(sleepTimeout);if(!sSleepTimeout)return
sleepTimeout=setTimeout(function(){dialogBoxKeyHandler=function(e){$("#dialogbox").hide()};sleepingCount=60;sleeping()},e[
sSleepTimeout])}function _enterPinCode(e,t){var r="",s="",n=0;function i(e){$("#k"+n).css({"background-color":"","color":""
});n=e;if(n<0)n=9;else if(n>9)n=0;$("#k"+n).css({"background-color":curColorB,"color":curColor})}for(var a=0;a<10;a++){
var o=a<9?a+1:0;
s+='<div id="k'+o+'" style="display:inline-block;padding:6px;"><div class="btn" onclick="_doKey(keys.N'+o+');">'+o+"</div></div>"
}$("#dialogbox").html(e+'<br/><br/><span id="pin" style="font-size: 200%;">&nbsp;</span><br><br>'+s).show();i(1);
dialogBoxKeyHandler=function(e){switch(e){case keys.N0:case keys.N1:case keys.N2:case keys.N3:case keys.N4:case keys.N5:
case keys.N6:case keys.N7:case keys.N8:case keys.N9:r+=(e-48).toString();$("#pin").html("# # # # ".substr(0,r.length*2));
if(r.length===4){$("#dialogbox").hide();t(r)}return;case keys.RETURN:$("#dialogbox").hide();t("");return;case keys.LEFT:i(
n-1);return;case keys.RIGHT:i(n+1);return;case keys.UP:i(1);return;case keys.DOWN:i(0);return;case keys.ENTER:_doKey(
keys.N0+n);return}}}function enterPinCode(e,t){_enterPinCode(e,t)}function exitPortal(){confirmBox(
"Do you want to exit player?",function(){setCurrent(catIndex,primaryIndex);playType=0;stbExit()})}function hsvToRgb(e,t,r){
var s,n,i;var a;var o,l,c,u;e=Math.max(0,Math.min(360,e));t=Math.max(0,Math.min(100,t));r=Math.max(0,Math.min(100,r));
t/=100;r/=100;if(t==0){s=n=i=r;return[Math.round(s*255),Math.round(n*255),Math.round(i*255)]}e/=60;a=Math.floor(e);o=e-a;
l=r*(1-t);c=r*(1-t*o);u=r*(1-t*(1-o));switch(a){case 0:s=r;n=u;i=l;break;case 1:s=c;n=r;i=l;break;case 2:s=l;n=r;i=u;break;
case 3:s=l;n=c;i=r;break;case 4:s=u;n=l;i=r;break;default:s=r;n=l;i=c}return[Math.round(s*255),Math.round(n*255),
Math.round(i*255)]}function colorDialog(){var s=50,n=85;s=parseInt(eSHLcolor.split(",")[0]);n=parseInt(eSHLcolor.split(","
)[1]);function t(e,t){s+=e;if(s>360)s=0;else if(s<0)s=360;n=Math.min(Math.max(n+t,0),100);var r=hsvToRgb(s,n,100);$("#step"
).css("color","rgb("+r[0]+","+r[1]+","+r[2]+")")}saveCPD();listCaption.innerHTML=_("Color spectrum");
listPodval.innerHTML=btnDiv(keys.RETURN,strRETURN,"Close")+btnDiv(keys.ENTER,strENTER,"Set");listDetail.innerHTML="";$(
"#listAbout").html('<div style="font-size:larger;">'+_("Color"
)+':<br/><br/>&nbsp;<span id="step" style="font-size: 150%;">&nbsp;1234567890&nbsp;<span style="background-color:'+curColorB+'">&nbsp;1234567890&nbsp;</span></span>&nbsp;<br/>'+'<br><div class="btn" onclick="_doKey(keys.LEFT);">'+strLEFT+'</div>&nbsp;<div class="btn" onclick="_doKey(keys.RIGHT);">'+strRIGHT+"</div>&nbsp;"+_(
"Color"
)+'<br><div class="btn" onclick="_doKey(keys.UP);">'+strUP+'</div>&nbsp;<div class="btn" onclick="_doKey(keys.DOWN);">'+strDOWN+"</div>&nbsp;"+_(
"Saturation")+"<br>"+btnDiv(keys.YELLOW,"","Yellow")+"<br>"+btnDiv(keys.GREEN,"","Green")+"<br>"+btnDiv(keys.BLUE,"","Blue"
)+"</div>").show();t(0,0);aboutKeyHandler=function(e){switch(e){case keys.UP:t(0,5);return;case keys.DOWN:t(0,-5);return;
case keys.RIGHT:t(10,0);return;case keys.LEFT:t(-10,0);return;case keys.YELLOW:s=50;n=85;t(0,0);return;case keys.GREEN:s=90
n=85;t(0,0);return;case keys.BLUE:s=180;n=85;t(0,0);return;case keys.ENTER:eSHLcolor=s+","+n;case keys.RETURN:$(
"#listAbout").text("").hide();restoreCPD();return;default:return}}}function selColorDialog(){var s=parseInt(
eSHLcolSel.split(",")[0]),n=parseInt(eSHLcolSel.split(",")[1]);function t(e,t){s+=e;if(s>360)s=0;else if(s<0)s=360;
n=Math.min(Math.max(n+t,0),100);var r=hsvToRgb(s,n,50);$("#step").css("background-color","rgb("+r[0]+","+r[1]+","+r[2]+")")
}saveCPD();listCaption.innerHTML=_("Background color of selected item");listPodval.innerHTML=btnDiv(keys.RETURN,strRETURN,
"Close")+btnDiv(keys.ENTER,strENTER,"Set");listDetail.innerHTML="";$("#listAbout").html(
'<div style="font-size:larger;">'+_("Background color of selected item"
)+':<br/><br/>&nbsp;<span id="step" style="font-size: 150%;">&nbsp;1234567890&nbsp;<span style="color:'+curColor+'">1234567890</span>&nbsp;</span>&nbsp;<br/>'+'<br><div class="btn" onclick="_doKey(keys.LEFT);">'+strLEFT+'</div>&nbsp;<div class="btn" onclick="_doKey(keys.RIGHT);">'+strRIGHT+"</div>&nbsp;"+_(
"Color"
)+'<br><div class="btn" onclick="_doKey(keys.UP);">'+strUP+'</div>&nbsp;<div class="btn" onclick="_doKey(keys.DOWN);">'+strDOWN+"</div>&nbsp;"+_(
"Saturation")+"<br>"+btnDiv(keys.RED,"","Default","0")+"</div>").show();t(0,0);aboutKeyHandler=function(e){switch(e){
case keys.UP:t(0,5);return;case keys.DOWN:t(0,-5);return;case keys.RIGHT:t(10,0);return;case keys.LEFT:t(-10,0);return;
case keys.N0:case keys.RED:s=240;n=25;t(0,0);return;case keys.ENTER:eSHLcolSel=s+","+n;case keys.RETURN:$("#listAbout"
).text("").hide();restoreCPD();return;default:return}}}function backColorDialog(){var s=parseInt(eSHLcolorB.split(",")[0]),
n=parseInt(eSHLcolorB.split(",")[1]);function t(e,t){s+=e;if(s>360)s=0;else if(s<0)s=360;n=Math.min(Math.max(n+t,0),50);
var r=hsvToRgb(s,100,n);$("#step").css("background-color","rgb("+r[0]+","+r[1]+","+r[2]+")")}saveCPD();
listCaption.innerHTML=_("Background color");listPodval.innerHTML=btnDiv(keys.RETURN,strRETURN,"Close")+btnDiv(keys.ENTER,
strENTER,"Set");listDetail.innerHTML="";$("#listAbout").html('<div style="font-size:larger;">'+_("Background color"
)+':<br/><br/><div id="step" style="font-size: 150%;padding:1em;border:1px solid '+curColor+'">1234567890<span style="color:'+curColor+'">1234567890</span></div>'+'<br><div class="btn" onclick="_doKey(keys.LEFT);">'+strLEFT+'</div>&nbsp;<div class="btn" onclick="_doKey(keys.RIGHT);">'+strRIGHT+"</div>&nbsp;"+_(
"Color"
)+'<br><div class="btn" onclick="_doKey(keys.UP);">'+strUP+'</div>&nbsp;<div class="btn" onclick="_doKey(keys.DOWN);">'+strDOWN+"</div>&nbsp;"+_(
"Brightness")+"</div>").show();t(0,0);aboutKeyHandler=function(e){switch(e){case keys.UP:t(0,5);return;case keys.DOWN:t(0,
-5);return;case keys.RIGHT:t(10,0);return;case keys.LEFT:t(-10,0);return;case keys.ENTER:eSHLcolorB=s+","+n;
case keys.RETURN:$("#listAbout").text("").hide();restoreCPD();return;default:return}}}function joyMenu(){
var e='<td align="center" valign="top" width="30%">';$("#dialogbox").html(
'<table style="font-size:inherit">'+"<tr><td></td>"+e+btnDiv(keys.UP,strUP,"<br>Rewind<br>"
)+"</td><td></td></tr>"+"<tr>"+e+btnDiv(keys.LEFT,strLEFT,"<br>Menu")+"</td>"+e+btnDiv(keys.ENTER,strENTER,"<br>Pause<br>"
)+"</td>"+e+btnDiv(keys.RIGHT,strRIGHT,"<br>Toggle<br>sound track")+"</td></tr>"+"<tr><td></td>"+e+btnDiv(keys.DOWN,strDOWN
,playType?"<br>Live":"<br>Previous<br>channel")+"</td><td></td></tr>"+"</table>"+btnDiv(keys.RETURN,strRETURN,"Close")
).show();dialogBoxKeyHandler=function(e){$("#dialogbox").hide();switch(e){case keys.ENTER:_doKey(keys.PLAY);return;
case keys.UP:shiftArchiveSelect(0);return;case keys.DOWN:playType?_doKey(keys.STOP):prevProg();return;case keys.RIGHT:
toggleAudioTrack();return;case keys.LEFT:popupList();return;case keys.RETURN:return}}}var dialogBoxKeyHandler=null,
selectBoxKeyHandler=null;function keyHandler(e){try{setSleepTimeout();var t=stbEventToKeyCode(e);if(!t)return;if(
typeof selectBoxKeyHandler=="function"&&$("#numprog").is(":visible")){if(selectBoxKeyHandler(t))return;
selectBoxKeyHandler=null;numProg.style.display="none"}if($("#dialogbox").is(":visible")){dialogBoxKeyHandler(t);return}
switch(t){case keys.MUTE:toggleMute();return;case keys.VOL_DOWN:changeVolume(-sVolumeStep);return;case keys.VOL_UP:
changeVolume(sVolumeStep);return;case keys.POWER:toggleStandby();return}if($("#listEdit").is(":visible")){editKey(t);return
}if($("#listAbout").is(":visible")){if(aboutKeyHandler(t)){e.preventDefault();return}switch(t){case keys.ENTER:
case keys.EXIT:case keys.RETURN:$("#listAbout").hide();return}return}if(list.style.display!="none"){e.preventDefault();if(
sArrowFun==1)switch(t){case keys.LEFT:changeVolume(-sVolumeStep);return;case keys.RIGHT:changeVolume(sVolumeStep);return}
if(listKeyHandler(t))return;switch(t){case keys.EXIT:closeList();return;case keys.UP:changeSelect(-1);return;
case keys.DOWN:changeSelect(1);return;case keys.LEFT:case keys.RW:case keys.CH_UP:changeSelect(-pageSize);return;
case keys.RIGHT:case keys.FF:case keys.CH_DOWN:changeSelect(pageSize);return;case keys.PREV:if(sPNFun==3)changeSelect(
-selIndex);else changeSelect(-pageSize);return;case keys.NEXT:if(sPNFun==3)changeSelect(listArray.length-selIndex-1
);else changeSelect(pageSize);return}return}if(playType){switch(t){case keys.N1:shiftArchive(-s13dur);return;case keys.N3:
shiftArchive(s13dur);return;case keys.N4:shiftArchive(-s46dur);return;case keys.N6:shiftArchive(s46dur);return;
case keys.N7:shiftArchive(-s79dur);return;case keys.N9:shiftArchive(s79dur);return;case keys.N2:keyFun(20);return;
case keys.N5:keyFun(21);return;case keys.ENTER:if(forcePlay)break;case keys.N0:case keys.PAUSE:case keys.PLAY:if(
stbIsPlaying()){forcePlay=false;showShift(_("Pause"));showChanelInfo(2);stbPause()}else{forcePlay=true;showShift(_("Play"))
$i1.hide();if(playType<0||fileArchive)stbContinue();else playArchive(playType+playTime-(s10resum?10:0))}return;
case keys.N8:t=keys.STOP;break}}else{switch(t){case keys.N0:if(nProg==""){liveStop();return};case keys.N1:case keys.N2:
case keys.N3:case keys.N4:case keys.N5:case keys.N6:case keys.N7:case keys.N8:case keys.N9:numberProg(t-48);return;
case keys.PAUSE:case keys.PLAY:liveStop();return}}switch(t){case keys.STOP:showShift(_(playType?"Live":"Restart stream"));
playChannel(catIndex,primaryIndex);return;case keys.RW:keyFun(sRWfun);return;case keys.FF:keyFun(sFFfun);return;
case keys.PREV:keyFun(sPREVfun);return;case keys.NEXT:keyFun(sNEXTfun);return;case keys.CH_UP:plusProg();return;
case keys.CH_DOWN:minusProg();return;case keys.PRECH:prevProg();return;case keys.ENTER:if(playType==-1e11){mediaList(null);
return};if(playType>0&&!sOkfun){epgList(catIndex,primaryIndex,false);return};case keys.CH_LIST:channelsList(catIndex,
primaryIndex);return;case keys.PIP:togglePip();return;case keys.RETURN:if($i1.is(":visible")){infoBarHide();return}switch(
sEfun){case 0:return;case 1:exitPortal();return;case 2:joyMenu();return;case 3:popupList();return;case 4:prevProg();return}
return;case keys.EPG:if(playType>-1)epgList(catIndex,primaryIndex,false);return;case keys.INFO:showChanelInfo();return;
case keys.LEFT:keyFun(sALfun);return;case keys.RIGHT:keyFun(sARfun);return;case keys.UP:keyFun(sAUfun);return;
case keys.DOWN:keyFun(sADfun);return;case keys.RED:keyFun(sRfun);return;case keys.GREEN:keyFun(sGfun);return;
case keys.YELLOW:keyFun(sYfun);return;case keys.BLUE:keyFun(sBfun);return;case keys.TOOLS:popupList();return;
case keys.SETUP:optionsList();return;case keys.ZOOM:toggleZoom();return;case keys.ASPECT:toggleAspectRatio();return;
case keys.AUDIO:toggleAudioTrack();return;case keys.SUBT:toggleSubtitle();return;case keys.EXIT:exitPortal();return;
default:log("info","<b>Warning:</b> key "+t+" ignored");break}}catch(e){console.error(e)}}function keyFun(e){switch(e){
case 0:if(playType>-1)recordsList(catIndex,primaryIndex,false);return;case 1:popupList();return;case 2:prevProg();return;
case 3:shiftArchiveSelect(0);return;case 4:showChanelInfo();return;case 5:toggleAspectRatio();return;case 6:
toggleAudioTrack();return;case 7:togglePip();return;case 8:pipIndex=null;stbStopPip();return;case 9:bucketsList(catIndex);
return;case 10:if(playType>-1)epgList(catIndex,primaryIndex,false);return;case 11:popMedia();return;case 12:joyMenu();
return;case 13:changeVolume(sVolumeStep);return;case 14:changeVolume(-sVolumeStep);return;case 15:if(playType
)shiftArchiveSelect(60);else plusProg();return;case 16:if(playType)shiftArchiveSelect(0);else minusProg();return;case 17:
toggleSubtitle();return;case 18:shiftArchive(-60);return;case 19:if(playType)shiftArchive(60);else shiftArchiveSelect(-60);
return;case 20:if(playType<0){shiftArchive(-6e6);return}if(!playType){timeShift(0);return}if(playType+playTime-epgArray[
curProg].time>30)playArchive(epgArray[curProg].time);else playArchive(epgArray[curProg-1].time);return;case 21:if(
playType<0)return;if(!playType){shiftArchiveSelect(-60);return}if(epgArray[curProg+1].time<Date.now()/1e3)playArchive(
epgArray[curProg+1].time);else{showShift(_("Live"));playChannel(catIndex,primaryIndex)}return}}function pos2text(e){
var t=new Date(e*1e3);return _t2(t.getHours())+":"+_t2(t.getMinutes())+":"+_t2(t.getSeconds())}function browserName(){
return"dune"}function saveChannelsCats(){if(!sFavorites){providerSetItem("catsArray",JSON.stringify(catsArray.slice(1)));
var e={};jQuery.extend(e,cats);delete e[_("All")];providerSetItem("cats",JSON.stringify(e))}else{favoritesArray=cats[_(
"Favorites")];providerSetItem("favoritesArray",JSON.stringify(favoritesArray))}}function infoBox(e){$("#dialogbox").html(
"<center>"+e+"</center>").show();dialogBoxKeyHandler=function(e){$("#dialogbox").hide()}}function confirmBox(e,t,r){$(
"#dialogbox").html("<center>"+_(e)+"<br/><br/>"+btnDiv(keys.ENTER,strENTER,"Yes")+"</center>").show();
dialogBoxKeyHandler=function(e){$("#dialogbox").hide();if(e==keys.ENTER)t();else if(typeof r=="function")r()}}
var catsArray=[];var cats={};var parental=/null/;var parentalArray=[],favoritesArray=[];function onChanelsLoaded(){try{
pperf_stamp("onChanelsLoaded -- start");if(cList.length){$(launch_id).append(_("<br/>Processing the channel list..."));if(
!sFavorites){catsArray=providerGetJson("catsArray",[]);cats=Array.isArray(catsArray)&&catsArray.length>0?providerGetJson(
"cats",{}):{}}else{favoritesArray=providerGetJson("favoritesArray",[])}if(!catsArray.length){cList.forEach(function(e,t,r){
var s=chanels[e];if(s.category["class"]){if(!cats[s.category.name]){catsArray.push(s.category.name);cats[s.category.name]=[
]}cats[s.category.name].push(e)}})}parentalArray=providerGetJson("parentalArray",[]);if(!parentalArray.length){
cList.forEach(function(e,t,r){var s=chanels[e];if(s.category["class"]){if(parental.test(s.category.name)
)parentalArray.push(e)}})}catsArray.unshift(_("All"));cats[_("All")]=cList.slice();if(sFavorites){catsArray.unshift(_(
"Favorites"));cats[_("Favorites")]=favoritesArray}sSortAbc=providerGetNum("sSortAbc",0);if(sSortAbc)sortChannels();$(
launch_id).append(_("<br/>Start playback..."));var e=cats[catsArray[catIndex]]||[];if(!e||!e[primaryIndex]){primaryIndex=0;
catIndex=sFavorites?1:0}pperf_stamp("onChanelsLoaded -- playChannel");try{playChannel(catIndex,primaryIndex)}catch(e){
console.error(e);primaryIndex=0;catIndex=sFavorites?1:0;try{playChannel(catIndex,primaryIndex)}catch(e){console.error(e)}}
try{loadEpgTimers()}catch(e){console.error(e)}}else{playType=0;setCurrent(sFavorites?1:0,0);$(launch_id).append(_(
"<br/>Channel list not received !!!"));popupList(popupActions.indexOf(noProvParam)+1);infoBox(_(
"Channel list not received !!!<br/><br/>Enter the provider data and restart the player !!!<br/><br/>"));launch_id="#launch"
}}catch(e){$(launch_id).append("<br/><b>Exception:</b> name "+e.name+", message "+e.message+", typeof "+typeof e);
popupList(popupActions.indexOf(noProvParam)+1);infoBox(_("Error getting channel list !!!"
)+"<br/><br/><b>Exception:</b> name "+e.name+", message "+e.message+", typeof "+typeof e);launch_id="#launch";
console.error(e)}if(typeof benchy_showPlayer==="function")setTimeout(benchy_showPlayer,23);$(launch_id).hide();if(
watchdog0>0){clearTimeout(watchdog0);watchdog0=undefined;console.log("watchdog is disabled")}console.log("player ready!");
pperf_stamp("player ready!");if(_pperf.length>0){var t=_pperf.join("\n");client_feedb(t)}}var arrTimezone=["system","0",
"+1","+2","+3","+4","+5","+6","+7","+8","+9","+10","+11","+12","-1","-2","-3","-4","-5","-6","-7","-8","-9","-10","-11",
"-12"];function setTimezone(){if(arrTimezone[sTimezone]==undefined)sTimezone=0;if(sTimezone)Date.setTimezoneOffset(
-60*arrTimezone[sTimezone])}function setFontSize(){pageSize=sPageSize;var e=getHeightK(),t=getWidthK();var r=(
window.innerHeight-90*e)/pageSize-sFontShift*e;r=Math.max(r,16*e);r=Math.min(r,40*e);$("#list").css("font-size",r+"px");$(
"#testFont").css("font-size",r+"px");$("#permanentTime").css("font-size",r+"px");r=Math.max(r,22*e);$i1.css("font-size",
r+"px");$("#numprog").css("font-size",r+"px");$("#dialogbox").css("font-size",r+"px");r=Math.min(r,25*e);$("#listCaption"
).css("font-size",r+"px");$("#listPodval").css("font-size",r+"px");$("#permanentTime").toggle(sPermanentTime!=0
).toggleClass("osd",sPermanentTime!=2).css("background-color","");var s="Helvetica, Arial, sans-serif";$("body").css(
"font-family",["","Roboto, ","RobotoCondensed, ","Caveat, ","Liberation, ","Gabriela, ","PTSansNarrow, "][sFont]+s);$(
"#info").css("padding",20*e+"px");$("#numprog").css({left:20*e+"px",top:20*e+"px",padding:10*e+"px"});$("#permanentTime"
).css({right:20*e+"px",top:20*t+"px",padding:10*e+"px "+10*t+"px"});$("#launch").css({"font-size":16*e+"px",
padding:100*e+"px"});$("logo").css({margin:100*e+"px"});$("#list").css({margin:10*e+"px "+10*t+"px"});$("#listCaption"
).css({height:30*e+"px"});$("#listTime").css({width:80*t+"px","font-size":22*e+"px"});$("#list_s").css({
"font-size":16*e+"px"});$("#listPodval").css({height:30*e+"px"});$("#listDetail").css({width:514*t+1+"px",top:330*e+"px",
bottom:30*e+1+"px",padding:4*e+"px "+4*t+"px"});$("#listPopUp").css({bottom:30*e+1+"px",padding:10*e+"px",margin:10*e+"px"}
);$("#listIn").css({left:522*t+"px",top:30*e+1+"px",bottom:30*e+1+"px",padding:4*e+"px 0px"});$("#listAbout").css({
left:522*t+"px",top:30*e+1+"px",bottom:30*e+1+"px",padding:10*e+"px "+10*t+"px"});$("#listEdit").css({left:522*t+"px",
top:30*e+1+"px",bottom:30*e+1+"px",padding:10*e+"px "+10*t+"px"});$("#info1").css({padding:20*e+"px "+20*t+"px"});$(
"#picon").css({width:80*t+"px",height:80*e+"px"});$("#channel").css({width:1040*t+"px",padding:"0px 0px 0px "+20*t+"px"});
$("#channel_number").css({width:70*t+"px"});$("#progress_div").css({margin:2*e+"px 0px"});$("#progress").css({
height:6*e+"px"});$("#progress_r").css({height:6*e+"px"});$("#begin_time").css({width:70*t+"px","font-size":22*e+"px"});$(
"#end_time").css({width:70*t+"px","font-size":22*e+"px"});$("#programm_name").css({width:900*t+"px"});$("#nbegin_time"
).css({width:70*t+"px","font-size":22*e+"px"});$("#nend_time").css({width:70*t+"px","font-size":22*e+"px"});$(
"#nprogramm_name").css({width:900*t+"px"});$("#data").css({width:80*t+"px","font-size":22*e+"px"});$("#current_s").css({
"font-size":16*e+"px"});$("#video_res").css({"font-size":16*e+"px"});$("#descr").css({padding:"0px "+100*t+"px",
margin:"0px 0px "+20*e+"px 0px"});$("#buffering").css({left:10*e+"px",top:10*e+"px",width:30*e+"px",height:30*e+"px",
"background-size":30*e+"px"});$("#pip_buffering").css({right:10*e+"px",top:10*e+"px",width:30*e+"px",height:30*e+"px",
"background-size":30*e+"px"});$("#mute").css({width:40*e+"px",height:40*e+"px","background-size":20*e+"px"});$(
"#volume_div").css({left:10*t+"px",width:15*t+"px",border:5*e+"px solid black"});$("#dialogbox").css({padding:10*e+"px",
margin:10*e+"px"});$("btn").css({"border-radius":6*e+"px",padding:"0px "+6*t+"px"});try{tooltip.style.width=12*e+"px";
tooltip.style.height=12*e+"px";tooltip.style.border=3*e+"px solid "+curColor}catch(e){console.error(e)}try{var n=$(
"#testFont"),i=n.css("font-size");n.css("font-size",22*e).text("9");var a=n.width();n.text("").css("font-size",i);var o=a*7
$("#picon").css({width:o+"px"});$("#data").css({width:o+"px"});$("#listTime").css({width:o+"px"});$("#channel").css({
width:1200*t-o*2+"px"});$("#descr").css({padding:"0px "+(o+20*t)+"px"})}catch(e){console.error(e)}try{var n=$("#testFont"),
i=n.css("font-size"),l=$i1.css("font-size");n.css("font-size",l).text("9");var a=n.width();n.text("").css("font-size",i);$(
"#channel_number").css({width:a*6+"px"});$("#begin_time").css({width:a*6+"px","font-size":"inherit"});$("#end_time").css({
width:a*6+"px","font-size":"inherit"});$("#programm_name").css({width:$("#channel").width()-a*12+"px"});$("#nbegin_time"
).css({width:a*6+"px","font-size":"inherit"});$("#nend_time").css({width:a*6+"px","font-size":"inherit"});$(
"#nprogramm_name").css({width:$("#channel").width()-a*12+"px"})}catch(e){console.error(e)}if(typeof stbCSS==="function"
)stbCSS();$("#descr").css("max-height",(660-$("#channel").height())*e+"px")}function setListPos(){var e=getWidthK(),
t=getHeightK(),r=sListPos?0:522*e,s=sListPos?522*e:0,n=sListPos?738*e:0;$("#listIn").css({"left":r+"px","right":s+"px"});$(
"#listAbout").css({"left":r+"px","right":s+"px"});$("#listEdit").css({"left":r+"px","right":s+"px"});$("#listDetail").css({
"left":n+"px"});$("#listPopUp").css({"left":n+"px"});n=sNoSmall?30*t+1:330*t;$("#listDetail").css({"top":n+"px"})}
var bodyColor="#f0f0f0",curColor="gold",curColorB="#668";function setColor(){$("body").css("color",bodyColor);
var e=parseInt(sSHLcolSel.split(",")[0]),t=parseInt(sSHLcolSel.split(",")[1]);curColorB="rgb("+hsvToRgb(e,t,50).join(","
)+")";var e=parseInt(sSHLcolor.split(",")[0]),t=parseInt(sSHLcolor.split(",")[1]);curColor="rgb("+hsvToRgb(e,t,100).join(
",")+")";$("#listCaption").css("border-bottom","1px solid "+curColor);$("#listPodval").css("border-top",
"1px solid "+curColor);$("#listPopUp").css("border","1px solid "+curColor);$("#progress").css("background-color",curColor);
$tooltipSpan.css({"background-color":curColorB,"color":curColor});$("#programm_name2").css("color",curColor);$("#dialogbox"
).css("border","1px solid "+curColor);try{tooltip.style.border=3*getHeightK()+"px solid "+curColor}catch(e){console.error(e
)}if(typeof stbSetOsdOpacity==="function"){stbSetOsdOpacity(sOsdOpacity*10)}$("#_t").css("height",50*getHeightK());$("#_b"
).css("top",(50+288)*getHeightK());var r=sListPos?758:10;$("#_l").css("width",r*getWidthK());$("#_r").css("left",(r+512
)*getWidthK());var e=parseInt(sSHLcolorB.split(",")[0]),s=parseInt(sSHLcolorB.split(",")[1]);$(".list_back").css(
"background-color","rgb("+hsvToRgb(e,100,s).join(",")+")");$("#listPopUp").css("background-color","rgb("+hsvToRgb(e,100,s
).join(",")+")")}function setEditor(){if(sEditor&&typeof showEditKey2==="function"){editKey=editKey2;
showEditKey=showEditKey2}else{editKey=editKey1;showEditKey=showEditKey1}}var ui_state={};function saveCPD(){
ui_state.lc=listCaption.innerHTML;ui_state.lp=listPodval.innerHTML;ui_state.ld=listDetail.innerHTML;
listCaption.innerHTML="";listPodval.innerHTML="";listDetail.innerHTML=""}function restoreCPD(){
listCaption.innerHTML=ui_state.lc;listPodval.innerHTML=ui_state.lp;listDetail.innerHTML=ui_state.ld;ui_state={}}
function edit_dealer(){function t(e){alert(_(e));setTimeout(function(){showEditKey([0,1,2])})}editCaption=_(
"Enter Provider Code");editvar="";setEdit=function(){if(!editvar)t("Error Code!");else getScriptDOM(
host+"/d/"+editvar.split(":")[0]+".js?"+__cv,function(){try{doDealer(editvar)}catch(e){console.error(e);t("Error Code!")}},
function(){t("Error Code!")})};showEditKey([0,1,2])}function edit_dealer_remote(){function t(e){alert(_(e));setTimeout(
function(){n()})}var r=false,s;function n(){clearTimeout(e);r=true;$("#listEdit").hide()}var e=setTimeout(n,6e5);
function i(){if(r)return;$.ajax({url:host_ott_proto+host_ott+"/swop/a.php",data:{c:"get_val",d:s},type:"POST",timeout:1e4,
cache:false,success:function(e){if(r)return;if(e.status==="forbidden")setTimeout(i,5e3);else if(e.status==="success"){if(
!e.data)t("Error Code!");else getScriptDOM(host+"/d/"+e.data.split(":")[0]+".js?"+__cv,function(){try{doDealer(e.data);$(
"#listEdit").hide()}catch(e){console.error(e);t("Error Code!")}},function(){t("Error Code!")})}},error:function(e){$(
"#listEdit").html('<div style="text-align:center;font-size:larger;color:red"><br/><br/>ERROR:<br/>'+e.responseText+"</div>"
)}})}listPodval.innerHTML=btnDiv(keys.RETURN,strRETURN,"Close");$("#listEdit").html(
'<div style="text-align:center;font-size:larger;"><br/><br/>'+_("Send request")+"...</div>").show();editKey=function(e){if(
e==keys.RETURN||e==keys.EXIT){n()}return true};$.ajax({url:host_ott_proto+host_ott+"/swop/a.php",data:{c:"get_var",n:_(
"Enter Provider Code"),v:""},type:"POST",timeout:1e4,cache:false,success:function(e){s=e.code;$("#listEdit").html(
'<div style="text-align:center;font-size:larger;"><br/>'+_("Request sended!")+"<br/><br/>"+_("For enter value open"
)+'<br/><span style="font-size:larger;color:'+curColor+'">'+__test+"ott-play.com/swop</span> "+_("and enter code"
)+' <span style="font-size:larger;color:'+curColor+'">'+s+"</span><br/><br/>"+_("or scan"
)+":<br/><br/>"+'<div><img src="https://chart.googleapis.com/chart?cht=qr&chs=300x300&chld=|1&chl=https://'+__test+"ott-play.com/swop/?"+s+'" style="height:30%;"/></div>'+"</div>"
);setTimeout(i,1e4)},error:function(e){$("#listEdit").html(
'<div style="text-align:center;font-size:larger;color:red"><br/><br/>ERROR:<br/>'+e.responseText+"</div>")}})}
var arrayProvaiders=["m3u","stalker","xtream","","ottclub","edem","shura","itv","tvteam","ottg","great","top","shara.club",
"shara-tv","bestlist","bestlist/stalker","all4you","ipstream","korona","antifriz","kb-team","fox","iptv-ott.ru","dosug",
"topiptv","1ott","newlook","polmedia","dragon","only4","ottprime","shocktv","diamondtv","fabryka","russkoetv","ultifl1x",
"tvclub","vidok","cbilling","","drvao","d/maxtv","moidom","sharavoz","raduga","prost","fxml","rd","tabox"];
var provArray=null;function selectProvaider(){if(sPSprovs&&parentPIN!="*"&&!parentAccess){enterPinAndSetAccess(
selectProvaider);return}if(!provArray)provArray=[(sNoColorKeys?"":'<div class="btn red">&nbsp;</div>&nbsp;')+_(
"m3u-m3u8 playlists"),(sNoColorKeys?"":'<div class="btn green">&nbsp;</div>&nbsp;')+_("Stalker portals"),(
sNoColorKeys?"":'<div class="btn yellow">&nbsp;</div>&nbsp;')+"Xtream-codes","","OTTCLUB","Эдем / iLookTV","Шура ТВ",
"ITV.LIVE","TV.Team","GlanzTV","GREAT IPTV","Top-Tv","Shara.club (ClubTV.pro)","Shara-TV","BEST LiST IPTV [HLS Playlist]",
"BEST LiST IPTV [Stalker/Ministra Portal]","All4you.tv","IpStream.one","KORONA TV","АнтиФриз.ТВ","KBC (Kinoboom)","Fox-TV",
"VIP-IP.COM","TV DOSUG","TOP-IPTV","1OTT.NET","New Look","POLMEDIA","Dragon Media PRO","Only4.tv","OTT Prime ONLINE",
"ShockTv","Diamond TV","Fabryka.TV","RUSSKOETV","ULTIFL1X","TVClub","Vidok.TV","Гомельсат (cbilling)"];var s=stbGetItem(
"cbkey");if(!s){for(var e=0;e<provArray.length;e++){if(provArray[e]==="Гомельсат (cbilling)"){provArray.splice(e,1);break}}
}function t(){$("#listAbout").html('<div style="font-size:larger;">'+listDetail.innerHTML.replace("display:none",""
)+"</div>");saveCPD();aboutKeyHandler=function(e){restoreCPD();$("#listAbout").hide();return true};$("#listAbout").show()}
function r(e){if(!e)return;if(i==e){optionsList(selectProvaider);return}stbSetItem("ottplayprov",e);if(
arrayProvaiders.indexOf(e)>n-1){var t=a.indexOf(e);if(t!=-1)a.splice(t,1);a.push(e);stbSetItem("ottplayprovs",
JSON.stringify(a))}loadProv()}var n=3;var i=stbGetItem("ottplayprov")||"no";var a=stbGetItem("ottplayprovs")||"[]";try{
a=JSON.parse(a)}catch(e){console.error(e);a=[]}a.forEach(function(e){if(!s&&e==="cbilling")return;
var t=arrayProvaiders.indexOf(e);if(t==-1)return;arrayProvaiders.splice(t,1);arrayProvaiders.splice(n+1,0,e);
var r=provArray[t];provArray.splice(t,1);provArray.splice(n+1,0,r)});selIndex=arrayProvaiders.indexOf(i);if(
selIndex==-1||selIndex>=provArray.length)selIndex=0;listArray=provArray;getListItem=function(e,t){return"&nbsp;&nbsp;"+(
sNoNumbersKeys||(t<n+1||t>9+n)?"":'<div class="btn">'+(t-n)+"</div>&nbsp;")+e};detailListAction=function(){if(
arrayProvaiders[selIndex]){var s=host+"/prov/"+arrayProvaiders[selIndex]+"/about";var e=stbGetItem("ottplaylang")||"";if(
e=="_eng")e="";$("#listDetail").load(""+s+e+".html?"+__av,function(e,t,r){if(t=="error")$("#listDetail").load(
s+".html?"+__av)})}};listKeyHandler=function(e){switch(e){case keys.N1:case keys.N2:case keys.N3:case keys.N4:case keys.N5:
case keys.N6:case keys.N7:case keys.N8:case keys.N9:r(arrayProvaiders[e-49+n+1]);return true;case keys.RED:r("m3u");
return true;case keys.GREEN:r("stalker");return true;case keys.YELLOW:r("xtream");return true;case keys.ENTER:r(
arrayProvaiders[selIndex]);return true;case keys.RETURN:if(typeof duneAddSettings!=="function"){firstRun()
}else optionsList(selectProvaider);return true;case keys.RIGHT:if(sArrowFun!=2)return false;case keys.N0:case keys.INFO:t()
return true;case keys.FF:if(sRewFun!=1)return false;t();return true;case keys.NEXT:if(sPNFun!=1)return false;t();
return true;default:return false}};listCaption.innerHTML=_("Choose provider");listPodval.innerHTML=btnDiv(keys.RETURN,
strRETURN,"Close")+btnDiv(keys.N0,strInfo,"Description","0");$("#listPopUp").hide();showPage()}function firstRun(){
listArray=[{action:edit_dealer,name:_("Enter Provider Code")},{action:edit_dealer_remote,name:_(
"Enter Provider Code on PC or Phone")},{action:loadSettings,name:_("Load settings")},{action:nofun},{
action:selectProvaider,name:_("Manual setup")}];if(typeof loadOpt==="function")listArray.splice(3,0,{action:loadOpt,name:_(
"Load settings from storage")});selIndex=0;getListItem=function(e,t){return"&nbsp;&nbsp;"+(e.name||"")};
detailListAction=function(){listDetail.innerHTML=listArray[selIndex].name||""};listKeyHandler=function(e){switch(e){
case keys.EXIT:case keys.RETURN:selectLang();return true;case keys.ENTER:if(listArray[selIndex].action)listArray[selIndex
].action();return true}return false};listCaption.innerHTML=_("First Run Setup");listPodval.innerHTML=btnDiv(keys.RETURN,
strRETURN,"Close");$("#listPopUp").hide();showPage()}function selectLang(){var t=["_eng","_arm","_bel","_bul","_fra","_ger"
,"_gre","_heb","_hun","_lat","_lit","_pol","_por","_rou","_rus","_spa","_tur","_ukr","_uzb"];var e=["English",
"Armenian - Հայերեն","Belarusian - Беларуская","Bulgarian - Български","French - Français","German - Deutsch",
"Greek - Ελληνικά","Hebrew - עברית","Hungarian - Magyar","Latvian - Latviski","Lithuanian - Lietuvių","Polish - Polski",
"Portuguese - Português","Romanian - Română","Russian - Русский","Spanish - Español","Turkish - Türkçe",
"Ukrainian - Українська","Uzbek - O'zbekcha"];selIndex=t.indexOf(stbGetItem("ottplaylang")||"");var r=selIndex;if(
selIndex==-1)selIndex=0;listArray=e;getListItem=function(e,t){return"&nbsp;&nbsp;"+e};detailListAction=function(){};
listKeyHandler=function(e){switch(e){case keys.ENTER:if(r==selIndex){if(typeof duneAddSettings!=="function")loadProv(
);else optionsList(selectLang)}else{stbSetItem("ottplaylang",t[selIndex]);keyStrings={};getScriptDOM(host+"/stbPlayer/"+t[
selIndex]+".js?"+__cv,function(){if(typeof duneAddSettings!=="function")loadProv();else optionsList(selectLang)},function(
){infoBox("ERR: lang loading fail!")})}return true;case keys.EXIT:if(typeof duneAddSettings==="function")return false;
case keys.RETURN:if(typeof duneAddSettings!=="function"){closeList();stbExit()}else optionsList(selectLang);return true;
default:return false}};listDetail.innerHTML="";listCaption.innerHTML=_("Choose language");listPodval.innerHTML=btnDiv(
keys.RETURN,strRETURN,"Close");$("#listPopUp").hide();showPage()}function loadProv(){pperf_stamp("loadProv -- start");
function r(){if(s!=="no"){alert(s+": load error!!!")}$(launch_id).append(_("<br/><b>Failed to load provider script !!!</b>"
)).hide();firstRun()}if(!$("#launch").is(":visible")){if(stbIsPlaying())stbStop();$("#dialogbox").html(
'<img src="'+host+"/stbPlayer/buffering.gif?"+__av+'" height="40">').show();launch_id="#dialogbox";closeList()}
version=savedPopup.ver;popupActions=savedPopup.popupActions.slice();popupArray=savedPopup.popupArray.slice();
popupDetail=savedPopup.popupDetail.slice();getEPGchanelCur=null;getMediaArray=null;playChannel=_playChannel;
channelsList=_channelsList;bucketsList=_bucketsList;playMedia=_playMedia;providerGetItem=_providerGetItem;
providerHasItem=_providerHasItem;providerHasItemValue=_providerHasItemValue;providerSetItem=_providerSetItem;
providerDelItem=_providerDelItem;var s=window.location.search.match(/\?([^&]+)/);if(s!==null){s=s[1].replace(/!/g,"");if(
s=="clear"){stbSetItem("ottplayprov","");stbSetItem("noSelProv",0);s=""}if(s.indexOf("*")>-1&&!stbGetItem("ottplayprov")){
s=s.replace(/\*/g,"");if(arrayProvaiders.indexOf(s)>-1){stbSetItem("ottplayprov",s);stbSetItem("noSelProv",1);s=""}}if(
arrayProvaiders.indexOf(s)==-1)s=""}else{s=""}if(s)delOption(selectProvaider);else s=stbGetItem("ottplayprov")||s;if(
arrayProvaiders.indexOf(s)==-1)s="";if(!s){s="no";r();return}if(parseInt(stbGetItem("noSelProv")))delOption(selectProvaider
);else{$(launch_id).append(_("<br/>Loading provider %1 script ...",s));delOption(edit_dealer)}pperf_stamp(
"loadProv -- load js");getScriptDOM(host+"/prov/"+s+"/prov.js?"+__cv,function(){try{pperf_stamp("loadProv -- js ready");if(
typeof duneAddSettings==="function"){$(launch_id).append(_("<br/>Loading settings..."));var e=popupActions.indexOf(
noProvParam)+1;duneAddSettings(e);if(parseInt(stbGetItem("noProvParam"))){var t=popupActions.indexOf(optionsList)-e;
popupArray.splice(e,t);popupDetail.splice(e,t);popupActions.splice(e,t)}if(parseInt(stbGetItem("noSelProv"))+parseInt(
stbGetItem("noProvParam"))!=2)$(launch_id).append(
'<img src="'+host+"/prov/"+s+"/logo.png?"+__av+'" alt=" " onerror="this.width=0" style="position:absolute; '+(
launch_id!="#dialogbox"?'top:100px; right:100px;" width="25%" max-height="25%" />':'top:6px; right:6px;" height="40" />'));
if(typeof getEPGchanelCur!="function")getEPGchanelCur=epgCash?getEPGchanelCached:getEPGchanel;pperf_stamp(
"loadProv -- loadChannels");loadChannels()}else{console.error("duneAddSettings is not a function");r()}}catch(e){
console.error(e);$(launch_id).append("<br/><br/><b>Exception:</b> name "+e.name+", message "+e.message+", typeof "+typeof e
)}},function(e){console.error(e);r()})}function loadChannels(){if(!$("#launch").is(":visible")){if(stbIsPlaying())stbStop()
if(launch_id!="#dialogbox")$("#dialogbox").html('<center><img src="'+host+"/stbPlayer/buffering.gif?"+__av+'" height="40">'
).show();launch_id="#dialogbox";closeList()}primaryIndex=providerGetNum("primaryIndex",0);cList=[];chanels={};epg={};
epgCashObj={};epgCashArr=[];curList=[];catsArray=[];cats={};parentalArray=[];favoritesArray=[];prevArr=providerGetJson(
"prevArr",[]);medHistory=providerGetJson("medHistory",[]);medFavorites=providerGetJson("medFavorites",[]);mediaUrls=null;
_crData={catIndex:-1,data:[],selIndex:0};catIndex=providerGetNum("catIndex",0);aAspects=providerGetJson("aAspects",{});
aAudios=providerGetJson("aAudios",{});aZooms=providerGetJson("aZooms",{});aSubs=providerGetJson("aSubs",{});
sShowNum=providerGetNum("sShowNum",1);sShowName=providerGetNum("sShowName",1);sShowPikon=providerGetNum("sShowPikon",1);
sShowProgress=providerGetNum("sShowProgress",1);sShowProgram=providerGetNum("sShowProgram",1);sShowDescr=providerGetNum(
"sShowDescr",1);sShowArchive=providerGetNum("sShowArchive",0);sPreview=providerGetNum("sPreview",0);
sPlayers=providerGetNum("sPlayers",0);sNextCount=providerGetNum("sNextCount",0);sNextCountL=sNextCount+1;if(sNextCount==-1
)sNextCount=0;if(typeof setPlayer==="function")setPlayer();$(launch_id).append(_("<br/>Loading channel list..."));
getChanelsArray(onChanelsLoaded)}function body_onClick(e){if(e===void 0)e=event;if(e.clientY===void 0){console.error(
"body_onClick: click event without MouseEvent "+e);return}if($("#dialogbox").is(":visible")||$("#numprog").is(":visible")){
_doKey(keys.RETURN);return}if(list.style.display!="none")return;var t=document.body.getBoundingClientRect(
).height||window.innerHeight;if(e.clientY<t*.2)popupList();else if(e.clientY>t*.8)showChanelInfo();else _doKey(keys.ENTER,e
)}document.body.onclick=body_onClick;function list_OnClick(e){if(e===void 0)e=event;_doKey(keys.RETURN,e)}
list.onclick=list_OnClick;$i1.click(function(e){if(e===void 0)e=event;e.stopPropagation();showChanelInfo()});var xDown=null
,yDown=null,xUp,yUp,touch_locked=false;var xMove1,yMove1,tCount;var touch_min_sensY=Math.round(screen.height/10);
var touch_min_sensX=Math.round(touch_min_sensY*(screen.width/screen.height)*2);function handleTouchStart(e){
e.preventDefault();tCount=e.touches.length;if(tCount==4){touch_locked=!touch_locked;if(touch_locked){alert(
'Touchscreen <span style="color:#f9bf3b;">LOCKED</span><br />Tap 4 fingers to unlock')}else{alert(
'Touchscreen <span style="color:#f9bf3b;">UNLOCKED</span><br />Tap 4 fingers to lock')}}if(touch_locked)return;
xDown=e.touches[0].screenX;yDown=e.touches[0].screenY;xUp=xDown;yUp=yDown;xMove1=xDown;yMove1=yDown}function checkTap(e,t,r
,s,n,i){if(Math.abs(e-r)<touch_min_sensX/10&&Math.abs(t-s)<touch_min_sensX/10)return true;return false}
function getDirection(e,t,r,s,n,i){var a=0;if(r-e>n){a|=4}else if(e-r>n){a|=1}if(s-t>i){a|=2}else if(t-s>i){a|=8}return a}
function handleTouchMove(e){if(!xDown||!yDown)return;e.preventDefault();xUp=Math.round(e.touches[0].screenX);
yUp=Math.round(e.touches[0].screenY);if(tCount==1){var t=getDirection(xMove1,yMove1,xUp,yUp,touch_min_sensX,touch_min_sensY
);switch(t){case 1:_doKey(keys.LEFT);break;case 4:_doKey(keys.RIGHT);break;case 2:_doKey(keys.DOWN);break;case 8:_doKey(
keys.UP);break}if(t!=0){yMove1=yUp;xMove1=xUp}}}function handleTouchEnd(e){console.log("end",e.originalEvent.touches.length
);if(tCount==3){var t=getDirection(xDown,yDown,xUp,yUp,touch_min_sensX*5,touch_min_sensY*2);if(t==0){_doKey(keys.SETUP);
console.log("tap up")}}xDown=null;yDown=null;tCount=undefined}function body_handleTouchEnd(e){if(!xDown||!yDown)return;
e.preventDefault();if(e.touches.length==0){if(tCount==2){var t=getDirection(xDown,yDown,xUp,yUp,touch_min_sensX,
touch_min_sensY*2);switch(t){case 0:if(checkTap(xDown,yDown,xUp,yUp,touch_min_sensX/2,touch_min_sensY/2)){_doKey(keys.ENTER
)}break;case 1:_doKey(keys.RED);break;case 4:_doKey(keys.BLUE);break;case 2:_doKey(keys.YELLOW);break;case 8:_doKey(
keys.GREEN);break}return}else if(tCount==1){if(checkTap(xDown,yDown,xUp,yUp,touch_min_sensX/2,touch_min_sensY/2)){
var r=document.createEvent("MouseEvent");var r=new MouseEvent("click",{bubbles:true,cancelable:true,view:window,
clientX:e.changedTouches[0].clientX,clientY:e.changedTouches[0].clientY});e.target.dispatchEvent(r)}}xDown=null;yDown=null;
tCount=undefined}}document.body.addEventListener("touchstart",handleTouchStart,{passive:false});
document.body.addEventListener("touchmove",handleTouchMove,{passive:false});document.body.addEventListener("touchend",
body_handleTouchEnd,{passive:false});function onWheel(e){if(e===void 0)e=event;var t=e.deltaY||e.detail||-e.wheelDelta;
e.preventDefault?e.preventDefault():e.returnValue=false;if(t<0&&selIndex>0)changeSelect(-1);if(
t>0&&selIndex<listArray.length-1)changeSelect(1)}if("onwheel"in document){listIn.onwheel=onWheel}else if(
"onmousewheel"in document){listIn.onmousewheel=onWheel}var $progress_div=$("#progress_div");
var tooltip=document.getElementById("progress_span"),$tooltipSpan=$("span",tooltip);$progress_div.click(function(e){if(
e===void 0)e=event;if(e===void 0||e.clientX===void 0){console.error("TODO: $progress_div[click] evt.clientX not exist")}if(
!playType&&!chanels[curList[primaryIndex]].rec)return;e.stopPropagation();var t=(e.clientX-$progress_div.position().left
)/$progress_div.width();if(playType<0){var r=Math.max(Math.round(t*stbGetLen()),0);var s=Math.floor(r/3600),n=Math.floor(
r%3600/60),i=r%60;showShift(">> "+(s?s+":":"")+_t2(n)+":"+_t2(i)+" <<");stbSetPosTime(r);return}var r=Math.round(t*(
_prog100.time_to-_prog100.time)+_prog100.time);if(r<Date.now()/1e3){if(!playType){timeShift(Math.round(Date.now()/1e3-r));
return}showShift(">> "+pos2text(r)+" <<");playArchive(r)}else{showShift(_(playType?"Live":"Restart stream"));playChannel(
catIndex,primaryIndex)}});$progress_div.mousemove(function(e){if(e===void 0)e=event;if(e===void 0||e.clientX===void 0){
console.error("TODO: $progress_div[mousemove] evt.clientX not exist")}if(!playType&&!chanels[curList[primaryIndex]].rec
)return;var t=e.clientX;tooltip.style.display="block";tooltip.style.top=$progress_div.offset().top-$progress_div.height(
)+"px";tooltip.style.left=t-tooltip.offsetWidth/2+"px";var r=(t-$progress_div.position().left)/$progress_div.width();if(
playType<0){var s=Math.max(Math.round(r*stbGetLen()),0);var n=Math.floor(s/3600),i=Math.floor(s%3600/60),a=s%60;
$tooltipSpan.text((n?n+":":"")+_t2(i)+":"+_t2(a))}else{var s=Math.round(r*(_prog100.time_to-_prog100.time)+_prog100.time);
$tooltipSpan.text(pos2text(s))}clearTimeout(infoTimeout);infoTimeout=setTimeout(infoBarHideT,sInfoTimeout*1e3)});
$progress_div.mouseleave(function(){tooltip.style.display=""});var launch_id="#launch";var savedPopup={};
function startPlayer(){$(launch_id).append("<br/>VER: "+__cv);$(launch_id).append("<br/>IID: "+(__iid?"..."+__iid.substr(-7
):"-"));if(typeof benchy_startPlayer==="function")setTimeout(benchy_startPlayer,23);onPlayerStart();try{pperf_stamp(
"startPlayer -- start");console.log("startPlayer");$(launch_id).append(
'<img src="'+host+"/stbPlayer/icon.png?"+__av+'" style="position: absolute; left: 100px; bottom:100px;" height="30%" alt=""/>'
);ottpStorage.reset();if(stbInit()!==false)onStbReady()}catch(e){$(launch_id).append(
"<br/><br/><b>Exception:</b> name "+e.name+", message "+e.message+", typeof "+typeof e);console.error(e)}}
function onStbReady(){function e(){t="no";$(launch_id).append("<br/><b>No language selected !!!</b>").hide();selectLang()}
pperf_stamp("onStbReady -- start");if(typeof benchy_stbReady==="function")setTimeout(benchy_stbReady,23);try{
sNoSmall=parseInt(stbGetItem("sNoSmall"))||0;sStopPlay=parseInt(stbGetItem("sStopPlay"))||0;sPipSize=parseInt(stbGetItem(
"sPipSize"))||0;sPipPos=parseInt(stbGetItem("sPipPos"))||0;sPageSize=parseInt(stbGetItem("sPageSize"))||25;
sFontShift=parseInt(stbGetItem("sFontShift"));if(isNaN(sFontShift))sFontShift=4;sFont=parseInt(stbGetItem("sFont"));if(
isNaN(sFont))sFont=4;sArrowFun=parseInt(stbGetItem("sArrowFun"))||0;sRewFun=parseInt(stbGetItem("sRewFun"))||0;
sPNFun=parseInt(stbGetItem("sPNFun"))||0;sALfun=parseInt(stbGetItem("sALfun"));if(isNaN(sALfun)
)sALfun=typeof stbGetVolume==="function"?14:1;sARfun=parseInt(stbGetItem("sARfun"));if(isNaN(sARfun)
)sARfun=typeof stbGetVolume==="function"?13:4;sAUfun=parseInt(stbGetItem("sAUfun"));if(isNaN(sAUfun))sAUfun=15;
sADfun=parseInt(stbGetItem("sADfun"));if(isNaN(sADfun))sADfun=16;sRWfun=parseInt(stbGetItem("sRWfun"));if(isNaN(sRWfun)
)sRWfun=18;sFFfun=parseInt(stbGetItem("sFFfun"));if(isNaN(sFFfun))sFFfun=19;sPREVfun=parseInt(stbGetItem("sPREVfun"));if(
isNaN(sPREVfun))sPREVfun=20;sNEXTfun=parseInt(stbGetItem("sNEXTfun"));if(isNaN(sNEXTfun))sNEXTfun=21;sRfun=parseInt(
stbGetItem("sRfun"));if(isNaN(sRfun))sRfun=10;sGfun=parseInt(stbGetItem("sGfun"))||0;sYfun=parseInt(stbGetItem("sYfun"));
if(isNaN(sYfun))sYfun=1;sBfun=parseInt(stbGetItem("sBfun"));if(isNaN(sBfun))sBfun=9;sEfun=parseInt(stbGetItem("sEfun"))||0;
sOkfun=parseInt(stbGetItem("sOkfun"))||0;s13dur=parseInt(stbGetItem("s13dur"));if(isNaN(s13dur))s13dur=15;s46dur=parseInt(
stbGetItem("s46dur"));if(isNaN(s46dur))s46dur=180;s79dur=parseInt(stbGetItem("s79dur"));if(isNaN(s79dur))s79dur=600;
sNoColorKeys=parseInt(stbGetItem("sNoColorKeys"))||0;sNoNumbersKeys=parseInt(stbGetItem("sNoNumbersKeys"))||0;
sTimezone=parseInt(stbGetItem("sTimezone"))||0;sSleepTimeout=parseInt(stbGetItem("sSleepTimeout"))||0;
sInfoTimeout=parseInt(stbGetItem("sInfoTimeout"))||5;sInfoSlide=parseInt(stbGetItem("sInfoSlide"));if(isNaN(sInfoSlide)
)sInfoSlide=1;sInfoSwitch=parseInt(stbGetItem("sInfoSwitch"));if(isNaN(sInfoSwitch))sInfoSwitch=1;sInfoChange=parseInt(
stbGetItem("sInfoChange"));if(isNaN(sInfoChange))sInfoChange=1;sInfoRew=parseInt(stbGetItem("sInfoRew"));if(isNaN(sInfoRew)
)sInfoRew=1;sThumbnail=parseInt(stbGetItem("sThumbnail"));if(isNaN(sThumbnail))sThumbnail=1;sVolumeStep=parseInt(
stbGetItem("sVolumeStep"))||5;sListPos=parseInt(stbGetItem("sListPos"))||0;sSHLcolSel=stbGetItem("sSHLcolSel")||"240,25";
sSHLcolor=stbGetItem("sSHLcolor")||"50,85";sSHLcolorB=stbGetItem("sSHLcolorB")||"255,0";sOsdOpacity=parseInt(stbGetItem(
"sOsdOpacity"));if(isNaN(sOsdOpacity))sOsdOpacity=7;sPermanentTime=parseInt(stbGetItem("sPermanentTime"))||0;
sGrapI=parseInt(stbGetItem("sGrapI"))||0;s10resum=parseInt(stbGetItem("s10resum"));if(isNaN(s10resum))s10resum=1;
sPrevCount=parseInt(stbGetItem("sPrevCount"));if(isNaN(sPrevCount))sPrevCount=2;sMedCount=parseInt(stbGetItem("sMedCount"))
if(isNaN(sMedCount))sMedCount=2;sShowScroll=parseInt(stbGetItem("sShowScroll"));if(isNaN(sShowScroll))sShowScroll=1;
sEditor=parseInt(stbGetItem("sEditor"))||0;if(sFavorites!=-1)sFavorites=parseInt(stbGetItem("sFavorites"))||0;
sPSchannels=parseInt(stbGetItem("sPSchannels"));if(isNaN(sPSchannels))sPSchannels=1;sPSoptions=parseInt(stbGetItem(
"sPSoptions"))||0;sPSprovs=parseInt(stbGetItem("sPSprovs"))||0;sHDMIsupport=parseInt(stbGetItem("sHDMIsupport"))||0;
sAutorun=parseInt(stbGetItem("sAutorun"))||0;sBufSize=parseInt(stbGetItem("sBufSize"))||0;parentPIN=stbGetItem("parentPIN"
)||"1234";sHideMenus=(stbGetItem("sHideMenus")||"").split(",");if(sHideMenus[0]=="")sHideMenus=[];if(
typeof stbSetBuffer==="function")stbSetBuffer();setTimezone();setFontSize();setListPos();setColor();setEditor();
setPipPosBuf();setSleepTimeout();if(typeof stbPlayPip!=="function"){delPopup(popTogglePip);delPopup(popStopPip)}if(
typeof stbToggleAudioTrack!="function")delPopup(toggleAudioTrack);if(typeof stbToggleSubtitle!="function")delPopup(
toggleSubtitle);if(typeof stbToggleZoom!="function")delPopup(toggleZoom);if(typeof stbToggleAspectRatio!="function"
)delPopup(toggleAspectRatio);savedPopup.popupActions=popupActions.slice();savedPopup.popupArray=popupArray.slice();
savedPopup.popupDetail=popupDetail.slice();savedPopup.ver=version;pperf_stamp("startPlayer -- control 1");var t=stbGetItem(
"ottplaylang");if(!t){e();return}pperf_stamp("startPlayer -- loadLang -- js");getScriptDOM(host+"/stbPlayer/"+t+".js?"+__cv
,loadProv,e);TMDb.prepare()}catch(e){$(launch_id).append(
"<br/><br/><b>Exception.StbReady:</b> name "+e.name+", message "+e.message+", typeof "+typeof e);console.error(e)}}if(
typeof ott_device==="undefined"||ott_device===""){$(document).ready(startPlayer)}console.log("player loaded!");