await $`find ./node_modules -name "build.gradle" -exec sed -i 's/kotlinVersion()/kotlinVersion/g' {} +`;
