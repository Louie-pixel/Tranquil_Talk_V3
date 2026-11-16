// Static-only test server: API responses are intercepted by browser tests.
const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const root = path.resolve(__dirname, "../web");
http.createServer((req,res)=>{
    const url = new URL(req.url, "http://localhost");
    const file = path.resolve(root, "." + (url.pathname === "/" ? "/index.html" : url.pathname));
    if (!file.startsWith(root + path.sep)) {res.writeHead(403).end();return;}
    fs.readFile(file,(error,data)=>{
        if(error){res.writeHead(404).end();return;}
        res.writeHead(200,{"content-type":({
            ".html":"text/html",".js":"text/javascript",".css":"text/css"
        })[path.extname(file)] || "application/octet-stream"});
        res.end(data);
    });
}).listen(8099,"127.0.0.1");
