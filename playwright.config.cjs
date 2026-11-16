const {defineConfig} = require("@playwright/test");
module.exports = defineConfig({
    testDir: "./tests",
    testMatch: ["ui.spec.cjs","experts.ui.spec.cjs"],
    use: {baseURL: "http://127.0.0.1:8099", screenshot: "only-on-failure", trace:"retain-on-failure"},
    webServer: {command: "node tests/preview-server.cjs",url:"http://127.0.0.1:8099",reuseExistingServer:false},
    reporter: "list"
});
