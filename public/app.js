// FlashDrop — Moteur de Transfert Local Ultra-Rapide

// Application State
const state = {
  selfId: null,
  deviceName: 'Appareil',
  peers: new Map(), // id -> peerInfo
  activeTransfer: null,
  isHost: window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1',
  serverUrl: window.location.origin
};

// UI Elements
const dom = {
  myDeviceName: document.getElementById('my-device-name'),
  networkIp: document.getElementById('network-ip'),
  peersContainer: document.getElementById('peers-container'),
  dropzone: document.getElementById('dropzone'),
  fileInput: document.getElementById('file-input'),
  directSendBtn: document.getElementById('direct-send-btn'),
  qrBtn: document.getElementById('qr-btn'),
  qrModal: document.getElementById('qr-modal'),
  closeQrModal: document.getElementById('close-qr-modal'),
  qrImg: document.getElementById('qr-img'),
  serverUrlInput: document.getElementById('server-url-input'),
  copyUrlBtn: document.getElementById('copy-url-btn'),
  downloadsBtn: document.getElementById('downloads-btn'),
  downloadsModal: document.getElementById('downloads-modal'),
  closeDownloadsModal: document.getElementById('close-downloads-modal'),
  downloadsList: document.getElementById('downloads-list'),
  transferPanel: document.getElementById('transfer-panel'),
  transferFilename: document.getElementById('transfer-filename'),
  transferStats: document.getElementById('transfer-stats'),
  progressBarFill: document.getElementById('progress-bar-fill'),
  transferSpeed: document.getElementById('transfer-speed'),
  transferEta: document.getElementById('transfer-eta'),
  transferChannels: document.getElementById('transfer-channels'),
  cancelTransferBtn: document.getElementById('cancel-transfer-btn'),
  toast: document.getElementById('toast'),
  toastMessage: document.getElementById('toast-message'),
  hostTransferCard: document.getElementById('host-transfer-card'),
  myDeviceIcon: document.getElementById('my-device-icon')
};

// Web Audio API pour signal sonore discret
const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
function playBeep(success = true) {
  try {
    if (audioCtx.state === 'suspended') audioCtx.resume();
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.connect(gain);
    gain.connect(audioCtx.destination);

    if (success) {
      osc.frequency.setValueAtTime(600, audioCtx.currentTime);
      gain.gain.setValueAtTime(0.08, audioCtx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.15);
      osc.start();
      osc.stop(audioCtx.currentTime + 0.15);
    } else {
      osc.frequency.setValueAtTime(240, audioCtx.currentTime);
      gain.gain.setValueAtTime(0.08, audioCtx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.15);
      osc.start();
      osc.stop(audioCtx.currentTime + 0.15);
    }
  } catch (e) {}
}

// Notifications toast discrètes
function showToast(msg, duration = 3000) {
  dom.toastMessage.textContent = msg;
  dom.toast.classList.remove('hidden');
  clearTimeout(dom.toast._timer);
  dom.toast._timer = setTimeout(() => {
    dom.toast.classList.add('hidden');
  }, duration);
}

// Formatage des tailles en Mo/Go
function formatBytes(bytes) {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'Ko', 'Mo', 'Go', 'To'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

// Initialisation réseau & QR code avec sélecteur d'interface
async function initNetworkInfo(targetIp = null) {
  try {
    const url = targetIp ? `/api/info?ip=${encodeURIComponent(targetIp)}` : '/api/info';
    const res = await fetch(url);
    const data = await res.json();
    state.serverUrl = data.url;
    dom.networkIp.textContent = data.selectedIp || data.primaryIp;
    dom.serverUrlInput.value = data.url;
    dom.qrImg.src = data.qrCode;

    const isMobile = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
    dom.myDeviceIcon.textContent = isMobile ? '(o.o)' : '(-_-)';
    dom.myDeviceName.textContent = isMobile ? 'Smartphone [TEL]' : 'Ordinateur [PC]';

    const ipSelect = document.getElementById('ip-select');
    if (ipSelect && ipSelect.options.length === 0 && data.interfaces) {
      data.interfaces.forEach(iface => {
        const opt = document.createElement('option');
        opt.value = iface.address;
        opt.textContent = iface.label || `${iface.name} (${iface.address})`;
        if (iface.address === (data.selectedIp || data.primaryIp)) opt.selected = true;
        ipSelect.appendChild(opt);
      });

      const customOpt = document.createElement('option');
      customOpt.value = 'custom';
      customOpt.textContent = 'Saisir une adresse IP manuellement...';
      ipSelect.appendChild(customOpt);

      ipSelect.onchange = (e) => {
        if (e.target.value === 'custom') {
          const customIp = prompt("Entrez l'adresse IP de votre PC (ex: 192.168.1.30 ou 192.168.137.1) :");
          if (customIp && customIp.trim()) {
            initNetworkInfo(customIp.trim());
          }
        } else {
          initNetworkInfo(e.target.value);
        }
      };
    }
  } catch (err) {
    console.warn('Erreur info reseau:', err);
  }
}

if (dom.serverUrlInput) {
  dom.serverUrlInput.onchange = () => {
    try {
      const u = new URL(dom.serverUrlInput.value);
      initNetworkInfo(u.hostname);
    } catch (e) {}
  };
}

// ----------------------------------------------------
// Signalement WebSocket Local
// ----------------------------------------------------
let ws;
const rtcConnections = new Map();

function initSignaling() {
  const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const wsUrl = `${wsProtocol}//${window.location.host}`;

  ws = new WebSocket(wsUrl);

  ws.onopen = () => {
    console.log('// Connecte au serveur local');
  };

  ws.onmessage = async (event) => {
    const msg = JSON.parse(event.data);

    switch (msg.type) {
      case 'init':
        state.selfId = msg.selfId;
        msg.peers.forEach(peer => {
          if (peer.id !== state.selfId) state.peers.set(peer.id, peer);
        });
        renderPeers();
        break;

      case 'peer-joined':
        if (msg.peer.id !== state.selfId) {
          state.peers.set(msg.peer.id, msg.peer);
          renderPeers();
          showToast(`[+] Connecte : ${msg.peer.name}`);
        }
        break;

      case 'peer-left':
        state.peers.delete(msg.peerId);
        cleanupRTC(msg.peerId);
        renderPeers();
        break;

      case 'host-file-received':
        showToast(`[OK] Reçu : ${msg.filename} (${formatBytes(msg.size)})`);
        playBeep(true);
        break;

      case 'webrtc-offer':
        await handleRTCOffer(msg.sender, msg.sdp);
        break;

      case 'webrtc-answer':
        await handleRTCAnswer(msg.sender, msg.sdp);
        break;

      case 'webrtc-ice':
        await handleRTCIce(msg.sender, msg.candidate);
        break;

      case 'p2p-file-meta':
        handleIncomingFileMeta(msg.sender, msg.metadata);
        break;

      case 'peer-direct-share':
        showToast(`[OK] Reçu de ${msg.senderName || 'un appareil'} : ${msg.filename} (${formatBytes(msg.size)})`);
        playBeep(true);
        // Téléchargement direct sans saturation mémoire
        const dl = document.createElement('a');
        dl.href = msg.downloadUrl;
        dl.download = msg.filename;
        document.body.appendChild(dl);
        dl.click();
        document.body.removeChild(dl);
        break;
    }
  };

  ws.onclose = () => {
    setTimeout(initSignaling, 1000);
  };
}

// Affichage radar des appareils connectés
function renderPeers() {
  dom.peersContainer.innerHTML = '';
  const peerList = Array.from(state.peers.values());
  if (peerList.length === 0) return;

  const count = peerList.length;
  const radius = Math.min(dom.peersContainer.offsetWidth, dom.peersContainer.offsetHeight) / 2.7 || 85;
  const centerX = dom.peersContainer.offsetWidth / 2;
  const centerY = dom.peersContainer.offsetHeight / 2;

  peerList.forEach((peer, index) => {
    const angle = (index / count) * 2 * Math.PI - Math.PI / 2;
    const x = centerX + radius * Math.cos(angle);
    const y = centerY + radius * Math.sin(angle);

    const node = document.createElement('div');
    node.className = 'peer-node';
    node.style.left = `${x}px`;
    node.style.top = `${y}px`;

    const emoticon = peer.deviceType === 'mobile' ? '(^.^)' : '(-_-)';
    const tag = peer.deviceType === 'mobile' ? 'TEL' : 'PC';

    node.innerHTML = `
      <div class="peer-avatar">${emoticon} [${tag}]</div>
      <span class="peer-title" title="${peer.name}">${peer.name}</span>
    `;

    node.onclick = () => selectFilesForPeer(peer.id);
    dom.peersContainer.appendChild(node);
  });
}

// ------------------------------------------------------------------
// MOTEUR ULTRA: Striping Multi-TCP (5 Flux Parallèles & Écriture Directe)
// ------------------------------------------------------------------

async function sendFilesDirectToHost(files) {
  for (const file of files) {
    try {
      if (file.size >= 12 * 1024 * 1024) {
        // Fichiers >= 12 Mo : Striping Multi-TCP 5x pour saturer le Wi-Fi
        await sendFileMultiTCP(file);
      } else {
        // Fichiers < 12 Mo : Stream direct continu (zéro overhead)
        await sendSingleFileDirect(file);
      }
    } catch (e) {
      console.warn('Erreur envoi fichier:', e);
    }
  }
}

// Moteur Striped Multi-TCP (5 flux simultanés saturant le canal Wi-Fi)
async function sendFileMultiTCP(file) {
  showTransferPanel(file.name, file.size, 'Multi-TCP 5x Striped');

  // 1. Handshake & Pré-allocation instantanée sur le disque hôte
  const initRes = await fetch('/api/upload/multi/init', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ filename: file.name, totalSize: file.size })
  });
  const { fileId, chunkSize, concurrency } = await initRes.json();

  const totalChunks = Math.ceil(file.size / chunkSize);
  let nextChunkIndex = 0;
  let totalUploaded = 0;
  const chunkProgress = new Map(); // chunkIndex -> bytesUploaded

  const startTime = performance.now();
  let lastTime = startTime;
  let lastBytes = 0;

  // Pool de 5 workers parallèles (limite optimale HTTP/1.1 par hôte)
  async function worker(workerId) {
    while (nextChunkIndex < totalChunks) {
      if (state.activeTransfer?.cancelled) break;

      const chunkIdx = nextChunkIndex++;
      const start = chunkIdx * chunkSize;
      const end = Math.min(file.size, start + chunkSize);
      const chunkBlob = file.slice(start, end); // Pointeur mémoire natif C++

      await new Promise((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.open('PUT', '/api/upload/multi/chunk', true);
        xhr.setRequestHeader('X-File-Id', fileId);
        xhr.setRequestHeader('X-Chunk-Offset', start.toString());

        xhr.upload.onprogress = (e) => {
          if (state.activeTransfer?.cancelled) {
            xhr.abort();
            return;
          }
          if (e.lengthComputable) {
            chunkProgress.set(chunkIdx, e.loaded);

            // Calcul du total cumulé sur tous les flux parallèles
            let currentSum = 0;
            for (const bytes of chunkProgress.values()) currentSum += bytes;

            const now = performance.now();
            const elapsedSegment = (now - lastTime) / 1000;

            if (elapsedSegment >= 0.1 || currentSum >= file.size) {
              const speed = (currentSum - lastBytes) / elapsedSegment;
              const avgSpeed = currentSum / ((now - startTime) / 1000);
              const remainingBytes = file.size - currentSum;
              const eta = remainingBytes / (speed || avgSpeed || 1);

              updateTransferProgress(currentSum, file.size, speed, eta);
              lastTime = now;
              lastBytes = currentSum;
            }
          }
        };

        xhr.onload = () => {
          if (xhr.status >= 200 && xhr.status < 300) {
            resolve();
          } else {
            reject(new Error(`HTTP ${xhr.status}`));
          }
        };

        xhr.onerror = () => reject(new Error('Erreur réseau'));
        xhr.send(chunkBlob);
      });
    }
  }

  // Lancer 5 connexions TCP indépendantes en parallèle
  const workers = [];
  const numWorkers = Math.min(concurrency || 5, totalChunks);
  for (let w = 0; w < numWorkers; w++) {
    workers.push(worker(w));
  }

  await Promise.all(workers);

  if (state.activeTransfer?.cancelled) {
    throw new Error('Transfert interrompu');
  }

  // Finalisation : fermeture du descripteur de fichier côté serveur
  const finishRes = await fetch('/api/upload/multi/finish', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ fileId })
  });
  const finishData = await finishRes.json();

  playBeep(true);
  showToast(`[OK] Terminé : ${file.name} [${finishData.speedMBps} Mo/s]`);
  hideTransferPanel();
}

function sendSingleFileDirect(file) {
  return new Promise((resolve, reject) => {
    showTransferPanel(file.name, file.size, 'Zero-Copy C++ Stream');

    const xhr = new XMLHttpRequest();
    const url = `/api/upload/fast-stream?filename=${encodeURIComponent(file.name)}&size=${file.size}`;
    xhr.open('POST', url, true);

    const startTime = performance.now();
    let lastTime = startTime;
    let lastBytes = 0;

    state.activeTransfer.xhr = xhr;

    xhr.upload.onprogress = (event) => {
      if (state.activeTransfer?.cancelled) {
        xhr.abort();
        reject(new Error('Transfert interrompu'));
        return;
      }

      if (event.lengthComputable) {
        const now = performance.now();
        const elapsedSegment = (now - lastTime) / 1000;

        if (elapsedSegment >= 0.1 || event.loaded === event.total) {
          const speed = (event.loaded - lastBytes) / elapsedSegment;
          const avgSpeed = event.loaded / ((now - startTime) / 1000);
          const remainingBytes = event.total - event.loaded;
          const eta = remainingBytes / (speed || avgSpeed || 1);

          updateTransferProgress(event.loaded, event.total, speed, eta);
          lastTime = now;
          lastBytes = event.loaded;
        }
      }
    };

    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        playBeep(true);
        try {
          const res = JSON.parse(xhr.responseText);
          showToast(`[OK] Terminé : ${file.name} [${res.speedMBps} Mo/s]`);
        } catch (e) {
          showToast(`[OK] Terminé : ${file.name}`);
        }
        resolve();
      } else {
        playBeep(false);
        showToast(`[ERR] HTTP ${xhr.status}`);
        reject(new Error(`HTTP ${xhr.status}`));
      }
      hideTransferPanel();
    };

    xhr.onerror = () => {
      playBeep(false);
      showToast('[ERR] Erreur de connexion');
      hideTransferPanel();
      reject(new Error('Erreur réseau'));
    };

    xhr.onabort = () => {
      hideTransferPanel();
      reject(new Error('Annulé'));
    };

    // Native C++ browser streaming directly from storage!
    xhr.send(file);
  });
}

// ------------------------------------------------------------------
// MOTEUR 2: WebRTC P2P Multi-Canal (Client <-> Client)
// ------------------------------------------------------------------
const NUM_CHANNELS = 4;
const P2P_CHUNK_SIZE = 64 * 1024; // 64 Ko

async function getOrCreatePeerConnection(targetPeerId) {
  if (rtcConnections.has(targetPeerId)) {
    return rtcConnections.get(targetPeerId);
  }

  const pc = new RTCPeerConnection({ iceServers: [] });
  const channels = [];

  pc.onicecandidate = (event) => {
    if (event.candidate && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({
        type: 'webrtc-ice',
        target: targetPeerId,
        candidate: event.candidate
      }));
    }
  };

  const connData = { pc, channels, ready: false };
  rtcConnections.set(targetPeerId, connData);
  return connData;
}

async function initWebRTCConnection(targetPeerId) {
  const conn = await getOrCreatePeerConnection(targetPeerId);

  for (let i = 0; i < NUM_CHANNELS; i++) {
    const dc = conn.pc.createDataChannel(`data-${i}`, {
      ordered: false,
      maxRetransmits: null
    });
    dc.binaryType = 'arraybuffer';
    setupDataChannel(dc, targetPeerId);
    conn.channels.push(dc);
  }

  const offer = await conn.pc.createOffer();
  await conn.pc.setLocalDescription(offer);

  ws.send(JSON.stringify({
    type: 'webrtc-offer',
    target: targetPeerId,
    sdp: offer
  }));

  await waitForChannelsOpen(conn.channels);
  conn.ready = true;
  return conn;
}

function setupDataChannel(dc, peerId) {
  dc.onmessage = (event) => handleP2PChunkReceived(peerId, event.data);
  dc.bufferedAmountLowThreshold = 64 * 1024;
}

function waitForChannelsOpen(channels, timeoutMs = 3500) {
  return Promise.race([
    Promise.all(channels.map(dc => {
      if (dc.readyState === 'open') return Promise.resolve();
      return new Promise(resolve => {
        dc.onopen = () => resolve();
      });
    })),
    new Promise((_, reject) => setTimeout(() => reject(new Error('WebRTC timeout')), timeoutMs))
  ]);
}

async function handleRTCOffer(senderId, sdp) {
  const conn = await getOrCreatePeerConnection(senderId);
  conn.pc.ondatachannel = (event) => {
    const dc = event.channel;
    dc.binaryType = 'arraybuffer';
    setupDataChannel(dc, senderId);
    conn.channels.push(dc);
  };

  await conn.pc.setRemoteDescription(new RTCSessionDescription(sdp));
  const answer = await conn.pc.createAnswer();
  await conn.pc.setLocalDescription(answer);

  ws.send(JSON.stringify({
    type: 'webrtc-answer',
    target: senderId,
    sdp: answer
  }));
}

async function handleRTCAnswer(senderId, sdp) {
  const conn = rtcConnections.get(senderId);
  if (conn) {
    await conn.pc.setRemoteDescription(new RTCSessionDescription(sdp));
  }
}

async function handleRTCIce(senderId, candidate) {
  const conn = rtcConnections.get(senderId);
  if (conn) {
    await conn.pc.addIceCandidate(new RTCIceCandidate(candidate));
  }
}

function cleanupRTC(peerId) {
  const conn = rtcConnections.get(peerId);
  if (conn) {
    conn.channels.forEach(ch => ch.close());
    conn.pc.close();
    rtcConnections.delete(peerId);
  }
}

async function sendFilesP2P(targetPeerId, files) {
  for (const file of files) {
    // Pour les gros fichiers (> 30 Mo) ou si le réseau isole les clients :
    // Utiliser le relais local ultra-rapide (évite le crash mémoire du navigateur mobile)
    if (file.size > 30 * 1024 * 1024) {
      await sendViaLocalRelay(targetPeerId, file);
      continue;
    }

    try {
      let conn = rtcConnections.get(targetPeerId);
      if (!conn || !conn.ready) {
        showToast('[...] Connexion P2P directe...');
        conn = await initWebRTCConnection(targetPeerId);
      }
      await sendSingleFileP2P(conn, targetPeerId, file);
    } catch (err) {
      console.warn('P2P direct indisponible, bascule sur le relais local:', err.message);
      showToast('[//] P2P direct indisponible -> Relais Turbo activé');
      await sendViaLocalRelay(targetPeerId, file);
    }
  }
}

// Relais local haute performance (100+ Mo/s, sans saturation mémoire du smartphone récepteur)
async function sendViaLocalRelay(targetPeerId, file) {
  showTransferPanel(file.name, file.size, 'Relais Turbo (100+ Mo/s)');

  try {
    let uploadedFilename = file.name;

    if (file.size >= 12 * 1024 * 1024) {
      // 5 flux TCP parallèles
      const initRes = await fetch('/api/upload/multi/init', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filename: file.name, totalSize: file.size })
      });
      const { fileId, chunkSize, concurrency } = await initRes.json();
      const totalChunks = Math.ceil(file.size / chunkSize);
      let nextChunkIndex = 0;

      async function worker() {
        while (nextChunkIndex < totalChunks) {
          if (state.activeTransfer?.cancelled) break;
          const chunkIdx = nextChunkIndex++;
          const start = chunkIdx * chunkSize;
          const end = Math.min(file.size, start + chunkSize);
          const chunkBlob = file.slice(start, end);

          await fetch('/api/upload/multi/chunk', {
            method: 'PUT',
            headers: {
              'Content-Type': 'application/octet-stream',
              'X-File-Id': fileId,
              'X-Chunk-Offset': start.toString()
            },
            body: chunkBlob
          });
        }
      }

      const workers = [];
      for (let w = 0; w < Math.min(concurrency || 5, totalChunks); w++) {
        workers.push(worker());
      }
      await Promise.all(workers);

      const finishRes = await fetch('/api/upload/multi/finish', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fileId })
      });
      const finishData = await finishRes.json();
      uploadedFilename = finishData.filename;
    } else {
      // Stream direct rapide
      const res = await new Promise((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.open('POST', `/api/upload/fast-stream?filename=${encodeURIComponent(file.name)}&size=${file.size}`, true);
        xhr.onload = () => {
          if (xhr.status >= 200 && xhr.status < 300) {
            resolve(JSON.parse(xhr.responseText));
          } else {
            reject(new Error(`HTTP ${xhr.status}`));
          }
        };
        xhr.onerror = reject;
        xhr.send(file);
      });
      uploadedFilename = res.filename;
    }

    // Avertir le smartphone destinataire via WebSocket
    ws.send(JSON.stringify({
      type: 'peer-direct-share',
      target: targetPeerId,
      senderName: state.deviceName,
      filename: file.name,
      size: file.size,
      downloadUrl: `/api/download/${encodeURIComponent(uploadedFilename)}`
    }));

    playBeep(true);
    showToast(`[OK] Envoyé vers l'appareil cible : ${file.name}`);
  } catch (err) {
    playBeep(false);
    showToast(`[ERR] ${err.message}`);
  } finally {
    hideTransferPanel();
  }
}

async function sendSingleFileP2P(conn, targetPeerId, file) {
  showTransferPanel(file.name, file.size, 'WebRTC 4x Striped');

  const fileId = Math.random().toString(36).substring(2, 8);
  const totalChunks = Math.ceil(file.size / P2P_CHUNK_SIZE);

  ws.send(JSON.stringify({
    type: 'p2p-file-meta',
    target: targetPeerId,
    metadata: {
      fileId,
      name: file.name,
      size: file.size,
      totalChunks,
      type: file.type
    }
  }));

  const startTime = performance.now();
  let lastTime = startTime;
  let lastBytes = 0;
  let bytesSent = 0;

  const BLOCK_SIZE = 4 * 1024 * 1024; // 4 Mo read buffer
  let blockOffset = 0;
  let currentBlock = null;

  for (let i = 0; i < totalChunks; i++) {
    if (state.activeTransfer?.cancelled) break;

    const chunkStart = i * P2P_CHUNK_SIZE;
    const chunkEnd = Math.min(file.size, chunkStart + P2P_CHUNK_SIZE);
    const chunkLen = chunkEnd - chunkStart;

    // Load next 4MB block into memory if needed
    if (!currentBlock || chunkStart >= blockOffset + currentBlock.byteLength) {
      blockOffset = chunkStart;
      const blockEnd = Math.min(file.size, blockOffset + BLOCK_SIZE);
      const blobBlock = file.slice(blockOffset, blockEnd);
      currentBlock = await blobBlock.arrayBuffer();
    }

    const offsetInBlock = chunkStart - blockOffset;
    const chunkSlice = new Uint8Array(currentBlock, offsetInBlock, chunkLen);

    const packet = new Uint8Array(8 + chunkLen);
    const view = new DataView(packet.buffer);
    view.setUint32(0, i, true);
    view.setUint32(4, totalChunks, true);
    packet.set(chunkSlice, 8);

    const channel = conn.channels[i % conn.channels.length];

    if (channel.bufferedAmount > 256 * 1024) {
      await new Promise(resolve => {
        channel.onbufferedamountlow = () => {
          channel.onbufferedamountlow = null;
          resolve();
        };
      });
    }

    channel.send(packet.buffer);
    bytesSent += chunkLen;

    const now = performance.now();
    const elapsedSegment = (now - lastTime) / 1000;
    if (elapsedSegment >= 0.2 || i === totalChunks - 1) {
      const speed = (bytesSent - lastBytes) / elapsedSegment;
      const avgSpeed = bytesSent / ((now - startTime) / 1000);
      const remainingBytes = file.size - bytesSent;
      const eta = remainingBytes / (speed || avgSpeed || 1);

      updateTransferProgress(bytesSent, file.size, speed, eta);
      lastTime = now;
      lastBytes = bytesSent;
    }
  }

  playBeep(true);
  showToast(`[OK] Fichier envoye : ${file.name}`);
  hideTransferPanel();
}

// Réception P2P
const incomingFiles = new Map();

function handleIncomingFileMeta(senderId, meta) {
  incomingFiles.set(meta.fileId, {
    name: meta.name,
    size: meta.size,
    totalChunks: meta.totalChunks,
    chunks: new Array(meta.totalChunks),
    receivedCount: 0,
    startTime: performance.now()
  });

  showTransferPanel(meta.name, meta.size, 'P2P Recept.');
}

function handleP2PChunkReceived(peerId, arrayBuffer) {
  const view = new DataView(arrayBuffer);
  const chunkIndex = view.getUint32(0, true);
  const totalChunks = view.getUint32(4, true);
  const chunkData = arrayBuffer.slice(8);

  for (const [fileId, incoming] of incomingFiles) {
    if (incoming.totalChunks === totalChunks && !incoming.chunks[chunkIndex]) {
      incoming.chunks[chunkIndex] = chunkData;
      incoming.receivedCount++;

      const bytesReceived = incoming.chunks.reduce((acc, c) => acc + (c ? c.byteLength : 0), 0);
      const elapsed = (performance.now() - incoming.startTime) / 1000;
      const speed = bytesReceived / (elapsed || 1);
      const eta = (incoming.size - bytesReceived) / (speed || 1);

      updateTransferProgress(bytesReceived, incoming.size, speed, eta);

      if (incoming.receivedCount === incoming.totalChunks) {
        finalizeIncomingP2PFile(incoming);
        incomingFiles.delete(fileId);
      }
      break;
    }
  }
}

function finalizeIncomingP2PFile(incoming) {
  const blob = new Blob(incoming.chunks);
  const url = URL.createObjectURL(blob);

  const a = document.createElement('a');
  a.href = url;
  a.download = incoming.name;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 10000);

  playBeep(true);
  showToast(`[OK] Reçu : ${incoming.name}`);
  hideTransferPanel();
}

// ----------------------------------------------------
// UI Progress Helpers
// ----------------------------------------------------
function showTransferPanel(filename, totalSize, engineName = 'Direct Stream') {
  state.activeTransfer = { filename, totalSize, cancelled: false };
  dom.transferFilename.textContent = filename;
  dom.transferChannels.textContent = engineName;
  dom.progressBarFill.style.width = '0%';
  dom.transferStats.textContent = `0 / ${formatBytes(totalSize)} (0%)`;
  dom.transferSpeed.textContent = '0 Mo/s';
  dom.transferEta.textContent = '--';
  dom.transferPanel.classList.remove('hidden');
}

function updateTransferProgress(currentBytes, totalBytes, speedBytesPerSec, etaSeconds) {
  const percent = Math.min(100, Math.round((currentBytes / totalBytes) * 100));
  dom.progressBarFill.style.width = `${percent}%`;
  dom.transferStats.textContent = `${formatBytes(currentBytes)} / ${formatBytes(totalBytes)} (${percent}%)`;
  dom.transferSpeed.textContent = `${formatBytes(speedBytesPerSec)}/s`;

  if (isFinite(etaSeconds) && etaSeconds >= 0) {
    if (etaSeconds < 60) {
      dom.transferEta.textContent = `${Math.ceil(etaSeconds)}s`;
    } else {
      const mins = Math.floor(etaSeconds / 60);
      const secs = Math.ceil(etaSeconds % 60);
      dom.transferEta.textContent = `${mins}m ${secs}s`;
    }
  } else {
    dom.transferEta.textContent = '--';
  }
}

function hideTransferPanel() {
  setTimeout(() => {
    dom.transferPanel.classList.add('hidden');
    state.activeTransfer = null;
  }, 1000);
}

// ----------------------------------------------------
// Événements utilisateur
// ----------------------------------------------------
function selectFilesForPeer(peerId) {
  dom.fileInput.onchange = (e) => {
    const files = Array.from(e.target.files);
    if (files.length > 0) sendFilesP2P(peerId, files);
    dom.fileInput.value = '';
  };
  dom.fileInput.click();
}

dom.directSendBtn.onclick = () => {
  dom.fileInput.onchange = (e) => {
    const files = Array.from(e.target.files);
    if (files.length > 0) sendFilesDirectToHost(files);
    dom.fileInput.value = '';
  };
  dom.fileInput.click();
};

dom.dropzone.onclick = () => dom.directSendBtn.click();
dom.dropzone.ondragover = (e) => {
  e.preventDefault();
  dom.dropzone.classList.add('dragover');
};
dom.dropzone.ondragleave = () => dom.dropzone.classList.remove('dragover');
dom.dropzone.ondrop = (e) => {
  e.preventDefault();
  dom.dropzone.classList.remove('dragover');
  const files = Array.from(e.dataTransfer.files);
  if (files.length > 0) sendFilesDirectToHost(files);
};

dom.cancelTransferBtn.onclick = () => {
  if (state.activeTransfer) {
    state.activeTransfer.cancelled = true;
    if (state.activeTransfer.xhr) {
      state.activeTransfer.xhr.abort();
    }
    showToast('[!] Transfert annule');
    hideTransferPanel();
  }
};

dom.qrBtn.onclick = () => dom.qrModal.classList.remove('hidden');
dom.closeQrModal.onclick = () => dom.qrModal.classList.add('hidden');
dom.qrModal.querySelector('.modal-backdrop').onclick = () => dom.qrModal.classList.add('hidden');

dom.copyUrlBtn.onclick = async () => {
  try {
    await navigator.clipboard.writeText(dom.serverUrlInput.value);
    showToast('[OK] Lien copie');
  } catch (e) {
    dom.serverUrlInput.select();
    document.execCommand('copy');
    showToast('[OK] Lien copie');
  }
};

dom.downloadsBtn.onclick = async () => {
  dom.downloadsModal.classList.remove('hidden');
  try {
    const res = await fetch('/api/downloads');
    const files = await res.json();

    if (files.length === 0) {
      dom.downloadsList.innerHTML = '<p class="empty-text">Aucun fichier reçu.</p>';
      return;
    }

    dom.downloadsList.innerHTML = files.map(file => `
      <div class="download-item">
        <div>
          <div class="download-item-name" title="${file.name}">${file.name}</div>
          <div class="download-item-size">${formatBytes(file.size)}</div>
        </div>
        <a href="/api/download/${encodeURIComponent(file.name)}" class="download-link" download="${file.name}">
          Telecharger
        </a>
      </div>
    `).join('');
  } catch (err) {
    dom.downloadsList.innerHTML = `<p class="empty-text">Erreur : ${err.message}</p>`;
  }
};

dom.closeDownloadsModal.onclick = () => dom.downloadsModal.classList.add('hidden');
dom.downloadsModal.querySelector('.modal-backdrop').onclick = () => dom.downloadsModal.classList.add('hidden');

window.addEventListener('resize', () => {
  if (state.peers.size > 0) renderPeers();
});

window.addEventListener('DOMContentLoaded', () => {
  initNetworkInfo();
  initSignaling();
});
