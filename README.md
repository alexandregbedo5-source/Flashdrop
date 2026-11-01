# ⚡ FlashDrop — Transfert Local Ultra-Rapide (100% Hors-Ligne)

Application web moderne et optimisée pour transférer des fichiers à très haute vitesse entre **Smartphone (iOS/Android)** et **PC (Windows/Mac/Linux)** sans aucun câble et **sans connexion Internet**.

---

## 🚀 Pourquoi FlashDrop est bien plus rapide que l'existant ?

Les solutions existantes comme **Snapdrop** ou **PairDrop** souffrent de plusieurs limitations techniques majeures :
1. **Saturation mémoire (RAM Crash)** : Snapdrop charge les fichiers sous forme de `Blob` en mémoire JavaScript. Sur iPhone Safari et Android Chrome, transférer une vidéo de 500 Mo à 1 Go fait planter l'onglet du navigateur (*"A problem repeatedly occurred"*).
2. **WebRTC mono-canal et blocage en tête de file (HoL)** : Le DataChannel WebRTC par défaut est ordonné (`ordered: true`). La moindre perte de paquet Wi-Fi bloque l'intégralité du flux de données.
3. **Surcoût DTLS/SCTP dans le bac à sable du navigateur** : La pile WebRTC navigateur est exécutée en user-space et plafonne souvent à 10–20 Mo/s sur Wi-Fi mobile.
4. **Dépendance Internet** : Snapdrop nécessite un serveur STUN public et Internet pour s'afficher. En mode point d'accès isolé (forêt, train, vacances), il ne fonctionne pas.

### 💡 Les innovations de FlashDrop :
- **Moteur Hybride Direct Stream (Hôte ⇄ Smartphone)** :
  Lors des transferts entre votre PC et votre smartphone, FlashDrop utilise un pipeline **HTTP direct par flux découpé en morceaux optimisés (2 Mo)**. Les données sont écrites directement sur le disque dur (`fs.createWriteStream`) avec zéro saturation de la RAM.
  👉 **Débit réel : 50 à 100+ Mo/s** (saturation complète de la bande passante Wi-Fi 5 / Wi-Fi 6).
- **Moteur WebRTC Turbo Quad-Canal (Client ⇄ Client)** :
  Pour les transferts directs entre deux smartphones connectés, FlashDrop active **4 canaux DataChannels WebRTC en parallèle** en mode non-ordonné (`ordered: false`) avec découpage à 64 Ko et gestion proactive de la contre-pression (`bufferedAmountLowThreshold`).
- **100% Hors-Ligne & Auto-Détection de Point d'Accès** :
  Aucun serveur externe STUN/TURN. Le serveur Node.js local détecte automatiquement les adresses de partage de connexion (Android `192.168.43.x`, iPhone `172.20.10.x`, Windows `192.168.137.x`) et génère un QR code instantané.
- **Zéro installation sur smartphone** :
  L'application s'ouvre directement dans Safari ou Chrome mobile en scannant le QR code affiché sur l'écran du PC.

---

## 📱 Comment l'utiliser en 3 étapes

### Option A : Partage de connexion depuis le Smartphone
1. Activez le **Point d'accès mobile (Hotspot)** sur votre smartphone.
2. Connectez votre PC au Wi-Fi de votre smartphone.
3. Lancez `start.bat` sur votre PC.
4. Scannez le **QR code** affiché à l'écran avec l'appareil photo du smartphone : la page s'ouvre instantanément !
5. Glissez ou sélectionnez vos fichiers : le transfert démarre à pleine vitesse.

### Option B : Partage de connexion depuis le PC
1. Activez le **Point d'accès mobile** dans les paramètres Windows.
2. Connectez votre smartphone au Wi-Fi émis par le PC.
3. Lancez `start.bat` et scannez le QR code.

### Option C : Même réseau Wi-Fi local (Box internet)
Fonctionne aussi parfaitement si les deux appareils sont simplement sur la même box Wi-Fi locale.

---

## 📂 Emplacement des fichiers reçus
Tous les fichiers envoyés vers le PC sont automatiquement enregistrés dans :
`flashdrop/downloads/`
Vous pouvez également les consulter et les retélécharger via le bouton **"Reçus"** de l'interface.

---

## 🛠️ Stack Technique
- **Backend** : Node.js ultra-léger (serveur HTTP natif + WebSocket `ws` + QR code).
- **Frontend** : Vanilla JS (PWA, Streams API, WebRTC multi-canaux, Web Audio API pour les retours sonores).
- **Design** : Interface Dark Mode Glassmorphism avec radar d'appareils et jauges de vitesse en temps réel.
