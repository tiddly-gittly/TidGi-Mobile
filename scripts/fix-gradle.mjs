/**
 * Fix No signature of method: org.gradle.internal.extensibility.DefaultExtraPropertiesExtension.kotlinVersion() is applicable for argument types: () values: []
 * @url https://github.com/expo/expo/issues/24945#issuecomment-1914306405
 */
await $`find ./node_modules -name "build.gradle" -exec sed -i 's/kotlinVersion()/kotlinVersion/g' {} +`;
