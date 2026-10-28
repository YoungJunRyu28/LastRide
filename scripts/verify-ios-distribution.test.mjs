import {test} from 'node:test';
import {strict as assert} from 'node:assert';
import {verifyIosDistributionMetadata,runIosDistributionVerifier} from './verify-ios-distribution.mjs';

const teamId='ABCDEFGHIJ';
function valid(){
  return {
    teamId,
    appInfo:{CFBundleIdentifier:'jp.lastride.app',CFBundleShortVersionString:'1.0.0',CFBundleVersion:'123',NSSupportsLiveActivities:true},
    appEntitlements:{
      'aps-environment':'production',
      'com.apple.developer.team-identifier':teamId,
      'application-identifier':teamId+'.jp.lastride.app',
      'get-task-allow':false,
      'com.apple.developer.usernotifications.time-sensitive':true,
      'com.apple.developer.associated-domains':['applinks:lastride.jp'],
      'com.apple.security.application-groups':['group.jp.lastride.app']
    },
    widgetInfo:{CFBundleIdentifier:'jp.lastride.app.ExpoWidgetsTarget'},
    widgetEntitlements:{
      'com.apple.developer.team-identifier':teamId,
      'application-identifier':teamId+'.jp.lastride.app.ExpoWidgetsTarget',
      'get-task-allow':false,
      'com.apple.security.application-groups':['group.jp.lastride.app']
    }
  };
}
test('accepts an internally consistent production-signed app and widget',()=>{
  const result=verifyIosDistributionMetadata(valid());
  assert.equal(result.bundleId,'jp.lastride.app');
  assert.equal(result.widgetId,'jp.lastride.app.ExpoWidgetsTarget');
});
test('rejects missing Apple team or forged/mismatched signing identity',()=>{
  for(const team of ['', 'BAD', 'abcdefghij'])assert.throws(()=>verifyIosDistributionMetadata({...valid(),teamId:team}),/Team ID/);
  let payload=valid();payload.appEntitlements['application-identifier']='WRONGTEAM.jp.lastride.app';
  assert.throws(()=>verifyIosDistributionMetadata(payload),/app identifier/);
  payload=valid();payload.widgetEntitlements['com.apple.developer.team-identifier']='ZYXWVUTSRQ';
  assert.throws(()=>verifyIosDistributionMetadata(payload),/widget team/);
});
test('rejects development/unsigned APNs and debug distribution entitlements',()=>{
  for(const status of [undefined,'development','sandbox']){
    const p=valid();p.appEntitlements['aps-environment']=status;
    assert.throws(()=>verifyIosDistributionMetadata(p),/production APNs/);
  }
  const debug=valid();debug.appEntitlements['get-task-allow']=true;
  assert.throws(()=>verifyIosDistributionMetadata(debug),/get-task-allow/);
  const missing=valid();delete missing.widgetEntitlements['get-task-allow'];
  assert.throws(()=>verifyIosDistributionMetadata(missing),/get-task-allow/);
});
test('rejects broken Universal Links, alarm notifications, Live Activities and widget App Group',()=>{
  const mutations=[
    p=>{p.appInfo.NSSupportsLiveActivities=false;},
    p=>{p.appEntitlements['com.apple.developer.usernotifications.time-sensitive']=false;},
    p=>{p.appEntitlements['com.apple.developer.associated-domains']=['applinks:evil.example'];},
    p=>{p.appEntitlements['com.apple.security.application-groups']=[];},
    p=>{p.widgetEntitlements['com.apple.security.application-groups']=[];},
    p=>{p.widgetInfo.CFBundleIdentifier='jp.lastride.app.evilwidget';},
  ];
  for(const mutate of mutations){const p=valid();mutate(p);assert.throws(()=>verifyIosDistributionMetadata(p),/iOS distribution rejected/);}
});
test('rejects invalid app build numbers and mismatched version metadata',()=>{
  for(const number of ['', '0','abc','1.0-beta']){
    const p=valid();p.appInfo.CFBundleVersion=number;
    assert.throws(()=>verifyIosDistributionMetadata(p),/build number/);
  }
  const p=valid();p.appInfo.CFBundleShortVersionString='not a version';
  assert.throws(()=>verifyIosDistributionMetadata(p),/marketing version/);
});
test('requires explicit signed artifact and does not attempt signing, upload or deploy',()=>{
  assert.throws(()=>runIosDistributionVerifier([],{}),/usage/);
  assert.throws(()=>runIosDistributionVerifier(['--ipa','/nonexistent.ipa'],{}),/IOS_APPLE_TEAM_ID/);
  assert.throws(()=>runIosDistributionVerifier(['--ipa','/nonexistent.ipa'],{IOS_APPLE_TEAM_ID:teamId}),/does not exist/);
});
