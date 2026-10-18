/** Verify the signed iOS App Store/TestFlight artifact; requires macOS.
 * IOS_APPLE_TEAM_ID=XXXXXXXXXX node scripts/verify-ios-distribution.mjs --ipa LastRide.ipa
 * Also accepts --archive LastRide.xcarchive or --app LastRide.app.
 * Does NOT sign, submit, deploy, or use signing credentials.
 */
import {execFileSync} from 'node:child_process';
import {existsSync,mkdtempSync,readdirSync,rmSync,writeFileSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {pathToFileURL} from 'node:url';
export const IOS_BUNDLE_ID='jp.lastride.app';
export const IOS_APP_GROUP='group.jp.lastride.app';
const reject=m=>{throw new Error('iOS distribution rejected: '+m);};
function same(got,want,label){if(got!==want)reject(label+' must be '+want);}
function contains(got,want,label){if(!Array.isArray(got)||!got.includes(want))reject(label+' missing '+want);}
export function verifyIosDistributionMetadata({appInfo,appEntitlements:app,widgetInfo,widgetEntitlements:widget,teamId}){
  if(!/^[A-Z0-9]{10}$/.test(teamId||''))reject('explicit 10-character Apple Team ID required');
  if(!appInfo||!app||!widgetInfo||!widget)reject('app and widget metadata required');
  same(appInfo.CFBundleIdentifier,IOS_BUNDLE_ID,'app bundle ID');
  same(appInfo.NSSupportsLiveActivities,true,'Live Activities Info.plist flag');
  if(!/^\d+\.\d+(?:\.\d+)?$/.test(String(appInfo.CFBundleShortVersionString??'')))reject('valid marketing version required');
  const build=String(appInfo.CFBundleVersion??'');
  if(!/^\d+(?:\.\d+)*$/.test(build)||build.split('.').every(x=>Number(x)===0))reject('nonzero numeric build number required');
  same(app['aps-environment'],'production','production APNs');
  same(app['com.apple.developer.team-identifier'],teamId,'app team');
  same(app['application-identifier'],teamId+'.'+IOS_BUNDLE_ID,'app identifier');
  same(app['get-task-allow'],false,'app get-task-allow');
  same(app['com.apple.developer.usernotifications.time-sensitive'],true,'Time Sensitive Notifications');
  contains(app['com.apple.developer.associated-domains'],'applinks:lastride.jp','Universal Links');
  contains(app['com.apple.security.application-groups'],IOS_APP_GROUP,'app group');
  const widgetId=IOS_BUNDLE_ID+'.ExpoWidgetsTarget';
  same(widgetInfo.CFBundleIdentifier,widgetId,'widget bundle ID');
  same(widget['com.apple.developer.team-identifier'],teamId,'widget team');
  same(widget['application-identifier'],teamId+'.'+widgetId,'widget identifier');
  same(widget['get-task-allow'],false,'widget get-task-allow');
  contains(widget['com.apple.security.application-groups'],IOS_APP_GROUP,'widget app group');
  return {bundleId:IOS_BUNDLE_ID,teamId,widgetId};
}
const exec=(command,args)=>execFileSync(command,args,{encoding:'utf8',maxBuffer:8*1024*1024,stdio:['pipe','pipe','pipe']});
const plist=file=>JSON.parse(exec('/usr/bin/plutil',['-convert','json','-o','-',file]));
function entitlements(path,scratch,name){
  const xml=exec('/usr/bin/codesign',['--display','--entitlements',':-',path]);
  if(!xml.includes('<plist'))reject(name+' has no embedded signed entitlements');
  const file=join(scratch,name+'.plist');
  writeFileSync(file,xml);
  return plist(file);
}
function inspect(app,scratch,teamId){
  if(!existsSync(join(app,'Info.plist')))reject('missing app Info.plist');
  const plugins=join(app,'PlugIns');
  if(!existsSync(plugins)||!readdirSync(plugins).includes('ExpoWidgetsTarget.appex'))reject('missing widget extension');
  const widget=join(plugins,'ExpoWidgetsTarget.appex');
  if(!existsSync(join(widget,'Info.plist')))reject('missing widget Info.plist');
  for(const [name,path] of [['app',app],['widget',widget]]){
    try{exec('/usr/bin/codesign',['--verify','--strict','--verbose=2',path]);}
    catch{reject(name+' signature invalid or missing');}
  }
  return verifyIosDistributionMetadata({
    appInfo:plist(join(app,'Info.plist')),appEntitlements:entitlements(app,scratch,'app'),
    widgetInfo:plist(join(widget,'Info.plist')),widgetEntitlements:entitlements(widget,scratch,'widget'),teamId});
}
export function runIosDistributionVerifier(argv=process.argv.slice(2),env=process.env){
  if(argv.length!==2||!['--ipa','--archive','--app'].includes(argv[0]))
    reject('usage: IOS_APPLE_TEAM_ID=XXXXXXXXXX node scripts/verify-ios-distribution.mjs (--ipa | --archive | --app) path');
  if(!/^[A-Z0-9]{10}$/.test(env.IOS_APPLE_TEAM_ID||''))reject('set production IOS_APPLE_TEAM_ID');
  const source=resolve(argv[1]);
  if(!existsSync(source))reject('signed file does not exist');
  if(process.platform!=='darwin')reject('macOS codesign/plutil required');
  const scratch=mkdtempSync(join(tmpdir(),'lastride-ios-verify-'));
  try{
    let app;
    if(argv[0]==='--ipa'){
      if(!source.endsWith('.ipa'))reject('expected .ipa');
      exec('/usr/bin/ditto',['-x','-k',source,scratch]);
      const payload=join(scratch,'Payload');
      const apps=existsSync(payload)?readdirSync(payload).filter(x=>x.endsWith('.app')):[];
      if(apps.length!==1)reject('IPA must contain exactly one Payload/*.app');
      app=join(payload,apps[0]);
    }else if(argv[0]==='--archive'){
      if(!source.endsWith('.xcarchive'))reject('expected .xcarchive');
      app=join(source,'Products','Applications','LastRide.app');
    }else{
      if(!source.endsWith('.app'))reject('expected .app');
      app=source;
    }
    return inspect(app,scratch,env.IOS_APPLE_TEAM_ID);
  }finally{rmSync(scratch,{recursive:true,force:true});}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
  try{
    const result=runIosDistributionVerifier();
    console.log('Verified signed iOS distribution:',result.bundleId,'team',result.teamId,'widget',result.widgetId);
  }catch(error){console.error(error instanceof Error?error.message:String(error));process.exitCode=1;}
}
