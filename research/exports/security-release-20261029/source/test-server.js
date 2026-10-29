import { createServer } from 'node:http';
const server = createServer((req, res) => { 
  console.log('Request received:', req.url);
  res.end('ok'); 
});
server.listen(8086, '::', () => {
  console.log('Listening on [::]:8086');
  console.log('Server listening:', server.listening);
  console.log('Server address:', server.address());
});
server.on('error', (err) => console.error('Error:', err));
server.on('listening', () => {
  console.log('Listening event fired');
  console.log('Server address:', server.address());
});
setInterval(() => {}, 1000);