const { withGradleProperties } = require('expo/config-plugins');

// Expo 57's Android Kotlin lint exceeded the native prebuild default 512 MB
// Metaspace (ReactActivityDelegateWrapper.kt) on a complete release AAB build.
// Keep lint enabled; allocate enough memory for Android lint/native compilation
// on EAS as well as on local build machines. This Android mod leaves iOS alone.
const JVM_ARGS = '-Xmx4096m -XX:MaxMetaspaceSize=1536m -Dfile.encoding=UTF-8';

module.exports = function withAndroidGradleMemory(config) {
  return withGradleProperties(config, (androidConfig) => {
    const properties = androidConfig.modResults;
    const current = properties.find(
      (item) => item.type === 'property' && item.key === 'org.gradle.jvmargs',
    );
    if (current) current.value = JVM_ARGS;
    else properties.push({ type: 'property', key: 'org.gradle.jvmargs', value: JVM_ARGS });
    return androidConfig;
  });
};
