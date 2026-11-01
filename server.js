const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { WebSocketServer, WebSocket } = require('ws');
const QRCode = require('qrcode');

process.on('uncaughtException', (err) => {
  console.error('UNCAUGHT EXCEPTION:', err);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('UNHANDLED REJECTION:', reason);
});

let PORT = parseInt(process.argv[2] || process.env.PORT || 5050, 10);
const DOWNLOADS_DIR = path.join(__dirname, 'downloads');

// Ensure downloads directory exists
if (!fs.existsSync(DOWNLOADS_DIR)) {
  fs.mkdirSync(DOWNLOADS_DIR, { recursive: true });
}

// MIME types for static assets
const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.webmanifest': 'application/manifest+json'
};

// Discover local network interfaces (Wi-Fi, hotspot, LAN)
function getLocalIPs() {
  const interfaces = os.networkInterfaces();
  const addresses = [];

  for (const name of Object.keys(interfaces)) {
    // Skip virtual adapters (VirtualBox, VMware, WSL, vEthernet)
    const lowerName = name.toLowerCase();
    if (
      lowerName.includes('virtual') ||
      lowerName.includes('vbox') ||
      lowerName.includes('vmware') ||
      lowerName.includes('wsl') ||
      lowerName.includes('vethernet') ||
      lowerName.includes('loopback')
    ) {
      continue;
    }

    for (const iface of interfaces[name]) {
      // IPv4 and non-internal only
      if (iface.family === 'IPv4' && !iface.internal) {
        // Skip common virtual host-only IP ranges
        if (iface.address.startsWith('192.168.56.')) continue;

        // Detect likely hotspot addresses or regular LAN
        const isHotspot = (
          iface.address.startsWith('192.168.43.') || // Android Hotspot
          iface.address.startsWith('172.20.10.') ||  // iOS Hotspot
          iface.address.startsWith('192.168.137.')  // Windows Hotspot
        );

        const isWiFi = lowerName.includes('wi-fi') || lowerName.includes('wireless') || lowerName.includes('wlan');

        const label = isHotspot 
          ? `Point d'accès Hotspot (${iface.address})`
          : (isWiFi ? `Wi-Fi (${iface.address})` : `Réseau local - ${name} (${iface.address})`);

        addresses.push({
          name,
          address: iface.address,
          isHotspot,
          isWiFi,
          label
        });
      }
    }
  }

  // Prioritize hotspot IPs, then Wi-Fi, then Ethernet
  addresses.sort((a, b) => {
    if (a.isHotspot !== b.isHotspot) return b.isHotspot ? 1 : -1;
    if (a.isWiFi !== b.isWiFi) return b.isWiFi ? 1 : -1;
    return 0;
  });

  return addresses;
}

// In-memory registry for connected peers
const peers = new Map(); // peerId -> { ws, info }
const fileSessions = new Map(); // sessionId -> { filename, size, receivedBytes, writeStream, path }

const parallelUploads = new Map(); // fileId -> { filePath, totalSize, fd, receivedBytes, startTime, filename }

// Create HTTP server
const server = http.createServer((req, res) => {
  // Enable CORS for local cross-origin if needed
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-File-Id, X-Chunk-Offset, X-Chunk-Size');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  const parsedUrl = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const pathname = parsedUrl.pathname;

  // ---------------------------------------------------------------
  // NEXT-GEN ENGINE: Multi-TCP Striping with Positional Disk Writes
  // ---------------------------------------------------------------
  
  // 1. Handshake & Pre-allocation: Creates & allocates contiguous disk extents
  if (pathname === '/api/upload/multi/init' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      try {
        const { filename, totalSize } = JSON.parse(body);
        const safeName = path.basename(filename).replace(/[^a-zA-Z0-9._\-]/g, '_');
        const targetPath = path.join(DOWNLOADS_DIR, `${Date.now()}_${safeName}`);
        const fileId = `${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;

        // Open file handle with 'w+' (read/write)
        const fd = fs.openSync(targetPath, 'w+');
        // Instantly pre-allocate physical clusters on NTFS/ext4
        if (totalSize > 0) {
          fs.ftruncateSync(fd, totalSize);
        }

        parallelUploads.set(fileId, {
          filePath: targetPath,
          filename: safeName,
          totalSize,
          fd,
          receivedBytes: 0,
          startTime: performance.now()
        });

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          fileId,
          chunkSize: 8 * 1024 * 1024, // 8MB optimal chunk size
          concurrency: 5 // 5 parallel TCP streams
        }));
      } catch (err) {
        console.error('Init error:', err);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: err.message }));
      }
    });
    return;
  }

  // 2. Ingest chunk directly into file descriptor at its exact byte offset (Zero-Reassembly)
  if (pathname === '/api/upload/multi/chunk' && (req.method === 'PUT' || req.method === 'POST')) {
    req.socket.setNoDelay(true);

    const fileId = req.headers['x-file-id'];
    const session = parallelUploads.get(fileId);

    if (!session) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Session not found' }));
      return;
    }

    const baseOffset = parseInt(req.headers['x-chunk-offset'], 10) || 0;
    let writeOffset = baseOffset;

    req.on('data', (chunk) => {
      req.pause();
      const currentPos = writeOffset;
      writeOffset += chunk.length;
      session.receivedBytes += chunk.length;

      // Thread-safe positional write at kernel level
      fs.write(session.fd, chunk, 0, chunk.length, currentPos, (err) => {
        if (err) console.error('Positional write error:', err);
        req.resume();
      });
    });

    req.on('end', () => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'ok', offset: baseOffset }));
    });

    req.on('error', (err) => {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: err.message }));
    });

    return;
  }

  // 3. Finalize upload & close file descriptor
  if (pathname === '/api/upload/multi/finish' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      try {
        const { fileId } = JSON.parse(body);
        const session = parallelUploads.get(fileId);

        if (!session) {
          res.writeHead(404, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Session not found' }));
          return;
        }

        fs.closeSync(session.fd);
        const elapsedSec = Math.max(0.001, (performance.now() - session.startTime) / 1000);
        const speedMBps = ((session.totalSize / (1024 * 1024)) / elapsedSec).toFixed(2);

        parallelUploads.delete(fileId);

        broadcast({
          type: 'host-file-received',
          filename: session.filename,
          size: session.totalSize,
          speed: speedMBps
        });

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          success: true,
          filename: session.filename,
          size: session.totalSize,
          speedMBps,
          elapsedSec: elapsedSec.toFixed(2)
        }));
      } catch (err) {
        console.error('Finish error:', err);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: err.message }));
      }
    });
    return;
  }

  // API: Get network info and QR code
  if (pathname === '/api/info') {
    const ips = getLocalIPs();
    const requestedIp = parsedUrl.searchParams.get('ip');
    const primaryIp = requestedIp || (ips[0] ? ips[0].address : '127.0.0.1');
    const serverUrl = `http://${primaryIp}:${PORT}`;

    QRCode.toDataURL(serverUrl, { margin: 1, width: 256 }, (err, qrDataUrl) => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        url: serverUrl,
        selectedIp: primaryIp,
        interfaces: ips,
        qrCode: qrDataUrl,
        downloadsDir: DOWNLOADS_DIR
      }));
    });
    return;
  }

  // API: Ultra-Fast Zero-Copy Streaming Upload (Host receiver)
  if (pathname === '/api/upload/fast-stream' && req.method === 'POST') {
    // Disable Nagle's algorithm for immediate transmission
    req.socket.setNoDelay(true);

    const filename = parsedUrl.searchParams.get('filename') || `file_${Date.now()}`;
    const fileSize = parseInt(parsedUrl.searchParams.get('size') || '0', 10);
    const safeName = path.basename(filename).replace(/[^a-zA-Z0-9._\-]/g, '_');
    const targetPath = path.join(DOWNLOADS_DIR, `${Date.now()}_${safeName}`);

    // High performance write stream with 4MB buffer and immediate disk flush
    const writeStream = fs.createWriteStream(targetPath, {
      highWaterMark: 4 * 1024 * 1024 // 4MB buffer for maximum disk throughput
    });

    let received = 0;
    const startTime = Date.now();

    req.on('data', (chunk) => {
      received += chunk.length;
    });

    req.pipe(writeStream);

    writeStream.on('finish', () => {
      const elapsedSec = Math.max(0.001, (Date.now() - startTime) / 1000);
      const speedMBps = ((received / (1024 * 1024)) / elapsedSec).toFixed(2);

      // Announce file received to all clients via WebSocket
      broadcast({
        type: 'host-file-received',
        filename: safeName,
        size: received,
        speed: speedMBps
      });

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        success: true,
        filename: safeName,
        size: received,
        speedMBps,
        elapsedSec: elapsedSec.toFixed(2)
      }));
    });

    writeStream.on('error', (err) => {
      console.error('Write error:', err);
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: err.message }));
    });

    return;
  }

  // API: List downloaded files on host
  if (pathname === '/api/downloads') {
    fs.readdir(DOWNLOADS_DIR, (err, files) => {
      if (err) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: err.message }));
        return;
      }

      const fileDetails = files.map(file => {
        const filePath = path.join(DOWNLOADS_DIR, file);
        const stats = fs.statSync(filePath);
        return {
          name: file,
          size: stats.size,
          mtime: stats.mtime
        };
      }).sort((a, b) => b.mtime - a.mtime);

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(fileDetails));
    });
    return;
  }

  // API: Stream download file from host (support HTTP Range for instant streaming & pause/resume)
  if (pathname.startsWith('/api/download/')) {
    req.socket.setNoDelay(true);

    const rawFileName = decodeURIComponent(pathname.replace('/api/download/', ''));
    const safePath = path.join(DOWNLOADS_DIR, path.basename(rawFileName));

    if (!fs.existsSync(safePath)) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('File not found');
      return;
    }

    const stat = fs.statSync(safePath);
    const fileSize = stat.size;
    const range = req.headers.range;

    if (range) {
      const parts = range.replace(/bytes=/, '').split('-');
      const start = parseInt(parts[0], 10);
      const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;
      const chunkSize = (end - start) + 1;

      const fileStream = fs.createReadStream(safePath, { start, end, highWaterMark: 4 * 1024 * 1024 });
      res.writeHead(206, {
        'Content-Range': `bytes ${start}-${end}/${fileSize}`,
        'Accept-Ranges': 'bytes',
        'Content-Length': chunkSize,
        'Content-Type': 'application/octet-stream',
        'Content-Disposition': `attachment; filename="${encodeURIComponent(path.basename(safePath))}"`,
        'Cache-Control': 'no-cache'
      });
      fileStream.pipe(res);
    } else {
      res.writeHead(200, {
        'Content-Length': fileSize,
        'Accept-Ranges': 'bytes',
        'Content-Type': 'application/octet-stream',
        'Content-Disposition': `attachment; filename="${encodeURIComponent(path.basename(safePath))}"`,
        'Cache-Control': 'no-cache'
      });
      fs.createReadStream(safePath, { highWaterMark: 4 * 1024 * 1024 }).pipe(res);
    }
    return;
  }

  // Static files handler
  let filePath = path.join(__dirname, 'public', pathname === '/' ? 'index.html' : pathname);
  const ext = path.extname(filePath).toLowerCase();

  fs.readFile(filePath, (err, content) => {
    if (err) {
      if (err.code === 'ENOENT') {
        res.writeHead(404, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end('<h1>404 Not Found</h1>');
      } else {
        res.writeHead(500, { 'Content-Type': 'text/plain' });
        res.end(`Server Error: ${err.code}`);
      }
    } else {
      res.writeHead(200, { 'Content-Type': MIME_TYPES[ext] || 'application/octet-stream' });
      res.end(content);
    }
  });
});

// WebSocket Server for zero-latency local signaling
const wss = new WebSocketServer({ server });

wss.on('error', (err) => {
  console.error('WebSocket Server error:', err);
});

function broadcast(data, exceptWs = null) {
  const payload = JSON.stringify(data);
  for (const [_, peer] of peers) {
    if (peer.ws !== exceptWs && peer.ws.readyState === WebSocket.OPEN) {
      peer.ws.send(payload);
    }
  }
}

wss.on('connection', (ws, req) => {
  const peerId = Math.random().toString(36).substring(2, 10);
  const userAgent = req.headers['user-agent'] || '';

  // Determine client device type and OS
  let deviceType = 'desktop';
  let deviceName = 'PC';
  if (/android/i.test(userAgent)) {
    deviceType = 'mobile';
    deviceName = 'Android';
  } else if (/iphone|ipad|ipod/i.test(userAgent)) {
    deviceType = 'mobile';
    deviceName = 'iPhone/iPad';
  } else if (/macintosh/i.test(userAgent)) {
    deviceType = 'desktop';
    deviceName = 'Mac';
  } else if (/windows/i.test(userAgent)) {
    deviceType = 'desktop';
    deviceName = 'Windows PC';
  } else if (/linux/i.test(userAgent)) {
    deviceType = 'desktop';
    deviceName = 'Linux';
  }

  const peerInfo = {
    id: peerId,
    name: `${deviceName} (${peerId.slice(0, 4)})`,
    deviceType,
    isHost: false
  };

  peers.set(peerId, { ws, info: peerInfo });

  // Send the assigned ID and existing peer list to the newly connected peer
  const peerList = Array.from(peers.values()).map(p => p.info);
  ws.send(JSON.stringify({
    type: 'init',
    selfId: peerId,
    peers: peerList
  }));

  // Announce new peer to everyone else
  broadcast({
    type: 'peer-joined',
    peer: peerInfo
  }, ws);

  // Handle incoming messages (Signaling: SDP offer/answer, ICE candidates, transfer requests)
  ws.on('message', (message) => {
    try {
      const msg = JSON.parse(message);
      const targetPeer = peers.get(msg.target);

      // Route message directly to targeted peer if specified
      if (targetPeer && targetPeer.ws.readyState === WebSocket.OPEN) {
        msg.sender = peerId;
        targetPeer.ws.send(JSON.stringify(msg));
      } else if (msg.type === 'update-info') {
        // Update client nickname/name
        if (msg.name) peerInfo.name = msg.name;
        broadcast({
          type: 'peer-updated',
          peer: peerInfo
        });
      }
    } catch (e) {
      console.error('WS parse error:', e);
    }
  });

  ws.on('close', () => {
    peers.delete(peerId);
    broadcast({
      type: 'peer-left',
      peerId
    });
  });

  ws.on('error', (err) => {
    console.error(`Peer ${peerId} error:`, err.message);
  });
});

// Handle port conflicts gracefully
server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.warn(`\n⚠️ Port ${PORT} déjà utilisé, essai sur le port ${PORT + 1}...`);
    PORT++;
    server.listen(PORT, '0.0.0.0');
  } else {
    console.error('Server error:', err);
  }
});

// Start listening on 0.0.0.0
server.listen(PORT, '0.0.0.0', () => {
  const ips = getLocalIPs();
  console.log('\n========================================================');
  console.log('  ⚡ FLASHDROP - Ultra-Fast Local File Transfer Server ⚡');
  console.log('========================================================\n');
  console.log(`  Local Access:   http://localhost:${PORT}`);

  if (ips.length > 0) {
    console.log('\n  Available Network Addresses (Connect phone via Hotspot or Wi-Fi):');
    ips.forEach(iface => {
      const tag = iface.isHotspot ? ' [HOTSPOT DETECTED 🔥]' : '';
      console.log(`    👉 http://${iface.address}:${PORT}${tag}`);
    });
    console.log(`\n  Files received on PC are saved to:\n  📂 ${DOWNLOADS_DIR}\n`);
  } else {
    console.log('\n  ⚠️ No active network interface detected.');
    console.log('  Create a Mobile Hotspot on phone or PC and reconnect.\n');
  }
  console.log('========================================================\n');
});
