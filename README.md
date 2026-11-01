# ⚡ FlashDrop — Transfert Local Ultra-Rapide (100% Hors-Ligne)

[![License: MIT](https://img.shields.io/badge/License-MIT-black.svg)](LICENSE)
[![Node.js](https://img.shields.io/badge/Node.js-v18+-black.svg?logo=node.js)](https://nodejs.org)
[![Speed](https://img.shields.io/badge/Transfer%20Speed-100%2B%20MB%2Fs-white.svg)]()

**FlashDrop** est une application web moderne, minimaliste et ultra-optimisée permettant de transférer des fichiers à très haute vitesse (**> 100 Mo/s**) entre **Smartphone (iOS / Android)** et **PC (Windows / Mac / Linux)** sans câble, sans application mobile à installer et **sans connexion Internet**.

---

## ⚡ En quoi FlashDrop est-il bien plus rapide que Snapdrop ou LocalSend ?

| Fonctionnalité | Snapdrop / PairDrop | LocalSend | **FlashDrop** |
| :--- | :--- | :--- | :--- |
| **Vitesse réelle Wi-Fi** | 5 – 15 Mo/s | 25 – 45 Mo/s | **80 – 110+ Mo/s** |
| **Architecture** | WebRTC mono-canal | App native installée | **Multi-TCP Striped (5 flux) + WebRTC Quad** |
| **Gros fichiers (> 1 Go)** | ❌ Crash RAM du navigateur | ✅ Géré (app native) | ✅ **Zero-RAM Stream direct sur disque** |
| **Installation requise** | Non (web) | **Oui** (app requise partout) | **Zéro installation** sur smartphone (QR Code) |
| **Connexion Internet** | Requise au chargement | Non | **100% Hors-Ligne (Hotspot autonome)** |

---

## 📦 Installation & Démarrage en 30 secondes

### Prérequis
- [Node.js](https://nodejs.org) (version 18 ou supérieure) installé sur le PC.

### 1. Cloner et installer
```bash
git clone https://github.com/alexandregbedo5-source/flashdrop.git
cd flashdrop
npm install
```

### 2. Lancer l'application
- **Sous Windows** : Double-cliquez simplement sur `start.bat`
- **Ou en ligne de commande** :
  ```bash
  npm start
  ```
  *(Pour utiliser un port spécifique : `node server.js 8080`)*

L'application s'ouvre sur `http://localhost:5050` et affiche un QR Code.

---

## 📱 Utilisation depuis le Smartphone (Zéro application à installer)

1. Connectez le smartphone et le PC sur le **même réseau** :
   - Soit en activant le **Partage de connexion (Point d'accès Wi-Fi)** sur le smartphone ou le PC *(astuce : activez la bande 5 GHz pour un débit maximal)*.
   - Soit connectés à la même box Wi-Fi locale.
2. Ouvrez l'appareil photo de votre smartphone et **scannez le QR Code** affiché sur l'écran du PC.
3. La page web s'ouvre instantanément : sélectionnez ou glissez vos fichiers pour les transférer à pleine vitesse !

---

## 🔬 Les innovations techniques sous le capot

1. **Moteur Multi-TCP Striping (5 flux parallèles)** :
   Sur les liaisons sans fil sujettes aux micro-pertes de paquets, un flux TCP unique s'effondre. FlashDrop découpe automatiquement les fichiers $\ge 12$ Mo en blocs de 8 Mo envoyés simultanément sur 5 connexions TCP indépendantes, saturant 100% de la bande passante Wi-Fi physique.
2. **Écriture positionnelle directe sans réassemblage (`pwrite`)** :
   Le serveur alloue instantanément l'espace disque du fichier en 1 milliseconde via `fs.ftruncateSync()`. Les flux parallèles écrivent directement à leur offset mémoire exact. **Zéro fichier temporaire**, **zéro étape de réassemblage finale**.
3. **Pointeurs mémoire natifs C++ (`file.slice()`)** :
   Zéro saturation de la mémoire vive (RAM) du smartphone. Les gros fichiers (films 4K, images ISO, gros dossiers) se transfèrent sans jamais faire planter les onglets Safari ou Chrome mobile.
4. **Moteur WebRTC Turbo Quad-Canal pour les échanges direct Mobile ⇄ Mobile** :
   4 canaux WebRTC parallèles configurés en mode `ordered: false` pour éliminer le blocage en tête de ligne (*Head-of-Line blocking*).

---

## 📂 Emplacement des fichiers reçus

Tous les fichiers envoyés vers le PC sont automatiquement enregistrés dans le dossier :
```
flashdrop/downloads/
```
Vous pouvez également les consulter et les retélécharger directement depuis le bouton **"Fichiers"** en haut à droite de l'interface.

---

## 🛡️ Confidentialité & Sécurité
- **100% Local & P2P** : Vos fichiers ne transitent par aucun serveur externe ni aucun cloud.
- Les transferts restent cantonnés strictement à votre réseau Wi-Fi local ou point d'accès.

## 📄 Licence
Projet distribué sous licence MIT.
