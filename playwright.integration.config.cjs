const {defineConfig} = require("@playwright/test");
module.exports = defineConfig({
    testDir: "./tests",testMatch:["call.spec.cjs","appointment-call.spec.cjs"],timeout:60000,reporter:"list",workers:1,
    use:{
        baseURL:process.env.TEST_BASE_URL || "http://127.0.0.1:8080",
        permissions:["microphone","camera"],
        launchOptions:{args:["--use-fake-device-for-media-stream","--use-fake-ui-for-media-stream"]},
        screenshot:"only-on-failure",trace:"retain-on-failure"
    }
});
