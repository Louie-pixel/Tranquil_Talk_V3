const {defineConfig} = require("@playwright/test");
const port=Number(process.env.TEST_UI_PORT || 8099);
module.exports = defineConfig({
    testDir: "./tests",
    testMatch: ["ui.spec.cjs","experts.ui.spec.cjs","workspace.ui.spec.cjs","entry-clinics.ui.spec.cjs","management.ui.spec.cjs","experience.ui.spec.cjs"],
    use: {baseURL: "http://127.0.0.1:"+port, screenshot: "only-on-failure", trace:"retain-on-failure"},
    webServer: {command: "node tests/preview-server.cjs",url:"http://127.0.0.1:"+port,reuseExistingServer:process.env.TEST_UI_REUSE_SERVER==='1'},
    reporter: "list"
});
