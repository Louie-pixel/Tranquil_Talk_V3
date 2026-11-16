const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '../web');
const port = Number(process.argv[2] || 8100);
if (!Number.isInteger(port) || port < 1 || port > 65535) {
  console.error('Provide a port between 1 and 65535.');
  process.exit(1);
}
const server = http.createServer((req,res)=>{
  const url = new URL(req.url, 'http://localhost');
  if (url.pathname === '/api/status') {res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify({mode:'layout-preview'}));return;}
  if (url.pathname.startsWith('/api/')) {res.writeHead(503,{'content-type':'application/json'});res.end(JSON.stringify({error:'The full application server is not running in this layout preview.'}));return;}
  const file = path.resolve(root, '.' + (url.pathname === '/' ? '/index.html' : url.pathname));
  if (!file.startsWith(root + path.sep)) {res.writeHead(403).end();return;}
  fs.readFile(file,(error,data)=>{if(error){res.writeHead(404).end();return;}
    res.writeHead(200, {'content-type':({'.html':'text/html','.js':'text/javascript','.css':'text/css'})[path.extname(file)] || 'application/octet-stream'});res.end(data);});
});
server.on('error', error => {
  console.error(error.code === 'EADDRINUSE'
    ? `Port ${port} is already in use. Try: node tools/preview.cjs ${port + 1}`
    : error.message);
  process.exitCode = 1;
});
server.listen(port, '127.0.0.1',()=>console.log(`Local layout preview on http://127.0.0.1:${port}`));


