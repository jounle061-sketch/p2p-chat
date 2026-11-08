// Firebase config
const firebaseConfig = {
    apiKey: "AIzaSyDD5R8H8iX7Ifo1exEV_tQt_8KHLQJKaBs",
    authDomain: "privchat-signaling-ea6da.firebaseapp.com",
    projectId: "privchat-signaling-ea6da",
    storageBucket: "privchat-signaling-ea6da.firebasestorage.app",
    messagingSenderId: "984942251524",
    appId: "1:984942251524:web:a25dd28f3880ea4ccf6f51"
};
firebase.initializeApp(firebaseConfig);
const db = firebase.firestore();
db.settings({ experimentalForceLongPolling: true }); // Force mobile browsers to stay connected

// Initialize Anonymous Auth for Firestore Security Rules
firebase.auth().signInAnonymously().catch(function(error) {
    console.error("Auth error:", error);
});

// ================== DOM ELEMENTS ==================
const landingPage = document.getElementById('landing-page');
const profileOverlay = document.getElementById('profile-overlay');
const chatApp = document.getElementById('chat-app');
const createRoomBtn = document.getElementById('create-room-btn');
const joinCodeInput = document.getElementById('join-code-input');
const joinCodeBtn = document.getElementById('join-code-btn');
const profileUsername = document.getElementById('username-input');
const saveProfileBtn = document.getElementById('save-profile-btn');
const avatarOptions = document.querySelectorAll('.avatar-option');
const avatarUpload = document.getElementById('avatar-upload');
const avatarPreview = document.getElementById('avatar-preview');
const myAvatarImg = document.getElementById('my-avatar');
const myUsernameDisplay = document.getElementById('my-username-display');
const statusDot = document.querySelector('.status-dot');
const statusText = document.getElementById('status-text');
const participantsCountSpan = document.getElementById('participants-count');
const leaveBtn = document.getElementById('leave-btn');
const inviteLinkInput = document.getElementById('invite-link');
const copyLinkBtn = document.getElementById('copy-link-btn');
const roomCodeDisplay = document.getElementById('room-code-display');
const copyCodeBtn = document.getElementById('copy-code-btn');
const newLinkBtn = document.getElementById('new-link-btn');
const groupModeCheckbox = document.getElementById('group-mode-checkbox');
const messagesContainer = document.getElementById('messages');
const messageInput = document.getElementById('message-input');
const sendBtn = document.getElementById('send-btn');
const imageInput = document.getElementById('image-input');
const videoInput = document.getElementById('video-input');
const typingIndicator = document.getElementById('typing-indicator');
const emojiBtn = document.getElementById('emoji-btn');
const emojiPicker = document.getElementById('emoji-picker');
const videoCallBtn = document.getElementById('video-call-btn');
const clearBgBtn = document.getElementById('clear-bg-btn');
const bgUpload = document.getElementById('bg-upload');
const bgLayer = document.getElementById('bg-layer');

// ================== STATE ==================
let myUsername = '';
let myAvatar = '😀';
let currentRoomCode = null;
let isHost = false;
let roomRef = null;
let messagesUnsubscribe = null;
let presenceUnsubscribe = null;
let roomListener = null;
let typingTimeout = null;
let currentUser = null;
let activeVideoListeners = new Map();
let encryptionKey = null;

// ================== BACKGROUND LOGIC ==================
if (bgUpload) {
    bgUpload.addEventListener('change', (e) => {
        const file = e.target.files[0];
        if (file && roomRef) {
            compressImage(file, 800, 0.6, async (compressedDataUrl) => {
                if (bgLayer) bgLayer.style.backgroundImage = `url(${compressedDataUrl})`;
                document.body.classList.add('has-custom-bg'); 
                if (clearBgBtn) clearBgBtn.classList.remove('hidden');
                try {
                    const encryptedBg = await encryptString(compressedDataUrl);
                    await roomRef.update({ encryptedBackground: encryptedBg });
                    console.log("Background synced to room");
                } catch (err) {
                    console.error("Error syncing background:", err);
                    alert("Background image is too large to sync.");
                }
            });
        }
        bgUpload.value = '';
    });
}

if (clearBgBtn) {
    clearBgBtn.addEventListener('click', async () => {
        if (!roomRef) return;
        if (bgLayer) bgLayer.style.backgroundImage = 'none';
        document.body.classList.remove('has-custom-bg');
        clearBgBtn.classList.add('hidden');
        try {
            await roomRef.update({ encryptedBackground: firebase.firestore.FieldValue.delete() });
            console.log("Background removed");
        } catch (err) {
            console.error("Error clearing background:", err);
        }
    });
}

function listenToRoomBackground() {
    if (roomListener) roomListener();
    if (!roomRef) return;
    
    roomListener = roomRef.onSnapshot(doc => {
        if (doc.exists) {
            const data = doc.data();
            if (bgLayer) {
                if (data.encryptedBackground) {
                    decryptString(data.encryptedBackground).then(decryptedBg => {
                        bgLayer.style.backgroundImage = `url(${decryptedBg})`;
                        document.body.classList.add('has-custom-bg');
                        if (clearBgBtn) clearBgBtn.classList.remove('hidden');
                    }).catch(err => console.error("Failed to decrypt background:", err));
                } else {
                    bgLayer.style.backgroundImage = 'none';
                    document.body.classList.remove('has-custom-bg'); 
                    if (clearBgBtn) clearBgBtn.classList.add('hidden');
                }
            }
        }
    });
}

// ================== CRYPTO HELPERS ==================
async function deriveKey(roomCode) {
    const encoder = new TextEncoder();
    const data = encoder.encode(roomCode);
    const hashBuffer = await crypto.subtle.digest('SHA-256', data);
    return crypto.subtle.importKey('raw', hashBuffer, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
}

async function encryptString(plaintext) {
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const encoded = new TextEncoder().encode(plaintext);
    const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, encryptionKey, encoded);
    const combined = new Uint8Array(iv.length + ciphertext.byteLength);
    combined.set(iv);
    combined.set(new Uint8Array(ciphertext), iv.length);
    
    let binary = '';
    const len = combined.byteLength;
    for (let i = 0; i < len; i++) {
        binary += String.fromCharCode(combined[i]);
    }
    return btoa(binary);
}

async function decryptString(encryptedBase64) {
    const binaryString = atob(encryptedBase64);
    const len = binaryString.length;
    const combined = new Uint8Array(len);
    for (let i = 0; i < len; i++) {
        combined[i] = binaryString.charCodeAt(i);
    }
    const iv = combined.slice(0, 12);
    const ciphertext = combined.slice(12);
    const plaintextBuffer = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, encryptionKey, ciphertext);
    return new TextDecoder().decode(plaintextBuffer);
}

// ================== AVATAR UTILITIES ==================
function isEmoji(str) {
    const regex = /[\u{1F300}-\u{1F9FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}]/u;
    return regex.test(str) && str.length <= 4;
}

function createAvatarElement(avatar, size = 32) {
    const span = document.createElement('span');
    span.style.display = 'inline-flex';
    span.style.alignItems = 'center';
    span.style.marginRight = '4px';
    span.style.fontSize = size + 'px';
    if (avatar.startsWith('data:image')) {
        const img = document.createElement('img');
        img.src = avatar;
        img.style.width = size + 'px';
        img.style.height = size + 'px';
        img.style.borderRadius = '50%';
        span.appendChild(img);
    } else if (isEmoji(avatar)) {
        span.textContent = avatar;
    } else {
        const img = document.createElement('img');
        img.src = 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><text y=".9em" font-size="90">❓</text></svg>';
        img.style.width = size + 'px';
        img.style.height = size + 'px';
        img.style.borderRadius = '50%';
        span.appendChild(img);
    }
    return span;
}

// ================== AVATAR SELECTION ==================
let selectedAvatar = '😀';
avatarOptions.forEach(btn => {
    btn.addEventListener('click', () => {
        avatarOptions.forEach(b => b.classList.remove('selected'));
        btn.classList.add('selected');
        selectedAvatar = btn.dataset.emoji;
        avatarPreview.classList.add('hidden');
    });
});
avatarUpload.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (file) {
        compressImage(file, 200, 0.8, (compressedDataUrl) => {
            selectedAvatar = compressedDataUrl;
            avatarPreview.src = selectedAvatar;
            avatarPreview.classList.remove('hidden');
        });
    }
});

// ================== LANDING ACTIONS ==================
createRoomBtn.addEventListener('click', () => {
    landingPage.classList.add('hidden');
    profileOverlay.classList.remove('hidden');
    isHost = true;
});
joinCodeBtn.addEventListener('click', () => {
    const code = joinCodeInput.value.trim().toUpperCase();
    if (code.length < 4) {
        alert('Please enter a valid room code.');
        return;
    }
    landingPage.classList.add('hidden');
    profileOverlay.classList.remove('hidden');
    currentRoomCode = code;
    isHost = false;
});

// ================== PROFILE SAVE ==================
saveProfileBtn.addEventListener('click', async () => {
    const username = profileUsername.value.trim().replace(/^@/, '');
    if (username.length < 3) {
        alert('Username must be at least 3 characters.');
        return;
    }
    myUsername = username;
    myAvatar = selectedAvatar;
    currentUser = {
        id: Date.now().toString(36) + Math.random().toString(36).substring(2,5),
        name: myUsername,
        avatar: myAvatar
    };
    profileOverlay.classList.add('hidden');
    chatApp.classList.remove('hidden');
    myAvatarImg.src = myAvatar.startsWith('data:') ? myAvatar : `data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><text y='.9em' font-size='90'>${myAvatar}</text></svg>`;
    myUsernameDisplay.textContent = '@' + myUsername;

    if (isHost) {
        await createRoom();
    } else {
        await joinRoom();
    }
});

// ================== UTILITIES ==================
function generateCode() { return Math.random().toString(36).substring(2, 8).toUpperCase(); }
function updateInviteLink() { const base = window.location.origin + window.location.pathname; inviteLinkInput.value = `${base}?room=${currentRoomCode}`; }
function updateRoomCodeDisplay() { roomCodeDisplay.value = currentRoomCode; }
function updateStatus(state, text) {
    if (state === 'connected') statusDot.classList.add('connected');
    else statusDot.classList.remove('connected');
    statusText.textContent = text;
}

// ================== ROOM MANAGEMENT ==================
async function createRoom() {
    currentRoomCode = generateCode();
    roomRef = db.collection('rooms').doc(currentRoomCode);
    encryptionKey = await deriveKey(currentRoomCode);
    try {
        const encryptedHost = await encryptString(currentUser.name);
        await roomRef.set({
            hostEncrypted: encryptedHost,
            createdAt: firebase.firestore.FieldValue.serverTimestamp(),
            group: groupModeCheckbox.checked || false
        });
        console.log('Room created:', currentRoomCode);
        updateInviteLink();
        updateRoomCodeDisplay();
        updateStatus('offline', 'Waiting for guests...');
        listenToMessages();
        setupPresence();
        listenToRoomBackground();
        enableChat();
    } catch (e) {
        console.error('Error creating room:', e);
        alert('Error creating room. Check Firestore rules.');
    }
}

async function joinRoom() {
    if (!currentRoomCode) {
        isHost = true;
        await createRoom();
        return;
    }
    roomRef = db.collection('rooms').doc(currentRoomCode);
    encryptionKey = await deriveKey(currentRoomCode);
    const doc = await roomRef.get();
    if (!doc.exists) {
        alert('Room not found. The code may have expired.');
        chatApp.classList.add('hidden');
        landingPage.classList.remove('hidden');
        return;
    }
    groupModeCheckbox.checked = doc.data().group || false;
    console.log('Joined room:', currentRoomCode);
    updateInviteLink();
    updateRoomCodeDisplay();
    updateStatus('offline', 'Connected to room');
    listenToMessages();
    setupPresence();
    listenToRoomBackground();
    enableChat();
}

// ================== MESSAGES LISTENER ==================
const renderedMessages = new Set(); // Tracks IDs to prevent duplicates and lag

function listenToMessages() {
    renderedMessages.clear(); // Clear old message IDs
    if (messagesUnsubscribe) messagesUnsubscribe();
    messagesUnsubscribe = roomRef.collection('messages').orderBy('timestamp').onSnapshot(async snapshot => {
        
        // Use a sequential for...of loop instead of forEach(async) to prevent out-of-order rendering
        for (const change of snapshot.docChanges()) {
            const msgData = change.doc.data();
            const msgId = change.doc.id;
            
            if (change.type === 'added' || change.type === 'modified') {
                const isSent = (msgData.senderToken === currentUser.id);
                
                let senderDisplay;
                try {
                    senderDisplay = isSent ? { name: currentUser.name, avatar: currentUser.avatar } : await decryptSenderInfo(msgData.senderInfoEncrypted);
                } catch (e) {
                    senderDisplay = { name: 'Unknown', avatar: '❓' };
                }
                
                const senderName = senderDisplay.name;
                const senderAvatar = senderDisplay.avatar;
                const senderClass = isSent ? 'sent' : 'received';

                if (msgData.type === 'video') {
                    if (change.type === 'added' && !renderedMessages.has(msgId)) {
                        addVideoPlaceholder(senderClass, senderName, senderAvatar, msgData.timestamp, msgId, msgData.totalChunks);
                        renderedMessages.add(msgId);
                    }
                    if (msgData.ready) {
                        downloadAndAssembleVideo(msgId, senderClass, senderName, senderAvatar, msgData.timestamp);
                    }
                } else if (change.type === 'added' && !renderedMessages.has(msgId)) {
                    if (msgData.type === 'text') {
                        try {
                            const decryptedText = await decryptString(msgData.encryptedContent);
                            addMessage(senderClass, decryptedText, senderName, senderAvatar, msgData.timestamp, null);
                            renderedMessages.add(msgId); // Prevent rendering twice
                        } catch (e) {
                            console.error('Failed to decrypt text:', e);
                        }
                    } else if (msgData.type === 'image') {
                        try {
                            const decryptedImage = await decryptString(msgData.encryptedImage);
                            addMessage(senderClass, null, senderName, senderAvatar, msgData.timestamp, decryptedImage);
                            renderedMessages.add(msgId); // Prevent rendering twice
                        } catch (e) {
                            console.error('Failed to decrypt image:', e);
                        }
                    }
                }
            }
        }
    });
}

async function decryptSenderInfo(encryptedInfo) {
    if (!encryptedInfo) return { name: 'Unknown', avatar: '❓' };
    const json = await decryptString(encryptedInfo);
    try {
        return JSON.parse(json);
    } catch (e) {
        return { name: 'Unknown', avatar: '❓' };
    }
}

function setupPresence() {
    const presenceRef = roomRef.collection('presence').doc(currentUser.id);
    (async () => {
        const encryptedPresence = await getEncryptedSenderInfo();
        await presenceRef.set({
            encryptedInfo: encryptedPresence,
            lastSeen: firebase.firestore.FieldValue.serverTimestamp()
        }).catch(err => console.error('Presence set error:', err));
    })();
    window.addEventListener('beforeunload', () => {
        presenceRef.delete();
        if (isHost && roomRef) roomRef.delete();
    });
    if (presenceUnsubscribe) presenceUnsubscribe();
    presenceUnsubscribe = roomRef.collection('presence').onSnapshot(snapshot => {
        participantsCountSpan.textContent = snapshot.size;
    });
}

// ================== SEND MESSAGE ==================
async function getEncryptedSenderInfo() {
    const info = JSON.stringify({ name: currentUser.name, avatar: currentUser.avatar });
    return encryptString(info);
}

async function sendMessage() {
    const text = messageInput.value.trim();
    if (!text || !roomRef) return;
    try {
        const encryptedContent = await encryptString(text);
        const encryptedSender = await getEncryptedSenderInfo();
        await roomRef.collection('messages').add({
            senderToken: currentUser.id,
            senderInfoEncrypted: encryptedSender,
            type: 'text',
            encryptedContent: encryptedContent,
            timestamp: Date.now()
        });
        messageInput.value = '';
        hideEmojiPicker();
    } catch (e) {
        console.error('Error sending message:', e);
        alert('Failed to send message. Check Firestore rules.');
    }
}
sendBtn.addEventListener('click', sendMessage);
messageInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        sendMessage();
    }
});

// ================== EMOJI PICKER ==================
emojiBtn.addEventListener('click', () => { emojiPicker.classList.toggle('hidden'); });
document.querySelectorAll('.emoji-grid span').forEach(emoji => {
    emoji.addEventListener('click', () => {
        messageInput.value += emoji.textContent;
        messageInput.focus();
    });
});
function hideEmojiPicker() { emojiPicker.classList.add('hidden'); }

// ================== IMAGE SENDING ==================
imageInput.addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file || !roomRef) return;
    compressImage(file, 800, 0.8, async (compressedDataUrl) => {
        if (compressedDataUrl.length > 900000) {
            compressImage(file, 600, 0.5, async (furtherCompressed) => {
                if (furtherCompressed.length > 900000) {
                    alert('Image is too large. Please choose a smaller photo.');
                    return;
                }
                await sendEncryptedImage(furtherCompressed);
            });
        } else {
            await sendEncryptedImage(compressedDataUrl);
        }
    });
});
async function sendEncryptedImage(dataUrl) {
    try {
        const encryptedImage = await encryptString(dataUrl);
        const encryptedSender = await getEncryptedSenderInfo();
        await roomRef.collection('messages').add({
            senderToken: currentUser.id,
            senderInfoEncrypted: encryptedSender,
            type: 'image',
            encryptedImage: encryptedImage,
            timestamp: Date.now()
        });
    } catch (e) {
        console.error('Error sending image:', e);
        alert('Failed to send image.');
    }
}
function compressImage(file, maxDim, quality, callback) {
    const reader = new FileReader();
    reader.onload = (ev) => {
        const img = new Image();
        img.onload = () => {
            let width = img.width, height = img.height;
            if (width > maxDim || height > maxDim) {
                if (width > height) { height = Math.round((height * maxDim) / width); width = maxDim; }
                else { width = Math.round((width * maxDim) / height); height = maxDim; }
            }
            const canvas = document.createElement('canvas');
            canvas.width = width; canvas.height = height;
            const ctx = canvas.getContext('2d');
            ctx.drawImage(img, 0, 0, width, height);
            const dataUrl = canvas.toDataURL('image/jpeg', quality);
            callback(dataUrl);
        };
        img.src = ev.target.result;
    };
    reader.readAsDataURL(file);
}

// ================== VIDEO MESSAGE ==================
const MAX_VIDEO_SIZE = 50 * 1024 * 1024;
const VIDEO_CHUNK_SIZE = 600 * 1024;

videoInput.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file || !roomRef) return;
    if (file.size > MAX_VIDEO_SIZE) {
        alert(`Video is too large. Maximum size is ${MAX_VIDEO_SIZE / (1024 * 1024)}MB.`);
        videoInput.value = '';
        return;
    }
    sendVideo(file);
});

async function sendVideo(file) {
    const totalChunks = Math.ceil(file.size / VIDEO_CHUNK_SIZE);
    console.log(`Starting video upload: ${file.name}, size ${file.size}, chunks ${totalChunks}`);
    try {
        const encryptedSender = await getEncryptedSenderInfo();
        const messageDoc = await roomRef.collection('messages').add({
            senderToken: currentUser.id,
            senderInfoEncrypted: encryptedSender,
            type: 'video',
            timestamp: Date.now(),
            totalChunks: totalChunks,
            mimeType: file.type || 'video/mp4',
            ready: false
        });
        
        const reader = new FileReader();
        let offset = 0, chunkIndex = 0;
        reader.onload = async (ev) => {
            try {
                const base64Chunk = ev.target.result.split(',')[1]; 
                await messageDoc.collection('chunks').add({
                    index: chunkIndex,
                    data: base64Chunk
                });
                chunkIndex++;
                offset += VIDEO_CHUNK_SIZE;
                if (offset < file.size) {
                    readNextChunk();
                } else {
                    await messageDoc.update({ ready: true });
                    console.log('Video fully uploaded.');
                    const localVideoUrl = URL.createObjectURL(file);
                    updateVideoMessage(messageDoc.id, 'sent', currentUser.name, currentUser.avatar, Date.now(), localVideoUrl);
                }
            } catch (err) {
                console.error(`Error uploading chunk ${chunkIndex}:`, err);
                alert('Error uploading video chunk. Please try again.');
            }
        };
        reader.onerror = () => { console.error('Error reading video file'); alert('Error reading video file.'); };
        function readNextChunk() {
            const slice = file.slice(offset, offset + VIDEO_CHUNK_SIZE);
            reader.readAsDataURL(slice);
        }
        readNextChunk();
    } catch (e) {
        console.error('Error creating video message:', e);
        alert('Failed to send video.');
    }
}

async function downloadAndAssembleVideo(msgId, senderClass, senderName, senderAvatar, timestamp) {
    if (activeVideoListeners.has(msgId)) return; 
    activeVideoListeners.set(msgId, true);
    
    console.log(`Downloading all chunks for video ${msgId}...`);
    try {
        const messageRef = roomRef.collection('messages').doc(msgId);
        const doc = await messageRef.get();
        if (!doc.exists) return;

        const snapshot = await messageRef.collection('chunks').orderBy('index').get();
        const chunks = [];
        
        snapshot.forEach(childDoc => {
            chunks[childDoc.data().index] = childDoc.data().data;
        });
        
        console.log(`Fetched all ${chunks.length} chunks. Assembling...`);

        const byteArrays = chunks.map(chunk => {
            const clean = chunk.replace(/[^A-Za-z0-9+/=]/g, '');
            const binaryString = atob(clean);
            const bytes = new Uint8Array(binaryString.length);
            for (let i = 0; i < binaryString.length; i++) {
                bytes[i] = binaryString.charCodeAt(i);
            }
            return bytes;
        });
        
        let totalLength = 0;
        byteArrays.forEach(arr => totalLength += arr.length);
        const combined = new Uint8Array(totalLength);
        let offset = 0;
        byteArrays.forEach(arr => {
            combined.set(arr, offset);
            offset += arr.length;
        });
        
        const blob = new Blob([combined], { type: doc.data().mimeType });
        const videoUrl = URL.createObjectURL(blob);
        updateVideoMessage(msgId, senderClass, senderName, senderAvatar, timestamp, videoUrl);
        
    } catch (e) {
        console.error('Error downloading/assembling video:', e);
        alert('Error downloading video.');
    }
}

function updateVideoMessage(msgId, senderClass, senderName, senderAvatar, timestamp, videoUrl) {
    const placeholder = document.querySelector(`[data-msg-id="${msgId}"]`);
    if (placeholder && !placeholder.classList.contains('video-ready')) {
        placeholder.classList.add('video-ready');
        placeholder.innerHTML = '';
        const meta = document.createElement('div');
        meta.className = 'msg-meta';
        const time = new Date(timestamp || Date.now()).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        meta.appendChild(createAvatarElement(senderAvatar));
        meta.innerHTML += `<span>${senderName}</span><span>${time}</span>`;
        placeholder.appendChild(meta);
        const video = document.createElement('video');
        video.controls = true;
        video.src = videoUrl;
        video.style.maxWidth = '100%';
        video.style.maxHeight = '200px';
        video.style.borderRadius = '12px';
        placeholder.appendChild(video);
    }
}

function addVideoPlaceholder(senderClass, senderName, senderAvatar, timestamp, msgId, totalChunks) {
    const div = document.createElement('div');
    div.className = `message ${senderClass} video-placeholder`;
    div.dataset.msgId = msgId;
    const meta = document.createElement('div');
    meta.className = 'msg-meta';
    const time = new Date(timestamp || Date.now()).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    meta.appendChild(createAvatarElement(senderAvatar));
    meta.innerHTML += `<span>${senderName}</span><span>${time}</span>`;
    div.appendChild(meta);
    const loading = document.createElement('div');
    loading.textContent = '🎥 Loading video...';
    loading.style.fontSize = '0.85rem';
    loading.style.opacity = '0.7';
    div.appendChild(loading);
    messagesContainer.appendChild(div);
    messagesContainer.parentElement.scrollTop = messagesContainer.parentElement.scrollHeight;
}

function addMessage(senderClass, text, senderName, senderAvatar, timestamp, imageData = null) {
    const div = document.createElement('div');
    div.className = `message ${senderClass}`;
    const meta = document.createElement('div');
    meta.className = 'msg-meta';
    const time = new Date(timestamp || Date.now()).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    meta.appendChild(createAvatarElement(senderAvatar));
    meta.innerHTML += `<span>${senderName}</span><span>${time}</span>`;
    div.appendChild(meta);
    if (text) {
        const p = document.createElement('div');
        p.textContent = text;
        div.appendChild(p);
    }
    if (imageData) {
        const img = document.createElement('img');
        img.src = imageData;
        img.style.maxWidth = '200px';
        img.style.maxHeight = '200px';
        img.style.borderRadius = '12px';
        div.appendChild(img);
    }
    messagesContainer.appendChild(div);
    messagesContainer.parentElement.scrollTop = messagesContainer.parentElement.scrollHeight;
}

// ================== VDO.NINJA CALL ==================
async function generateVdoRoomId(roomCode) {
    const encoder = new TextEncoder();
    const data = encoder.encode(roomCode);
    const hashBuffer = await crypto.subtle.digest('SHA-256', data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    const hashHex = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
    return 'vdo' + hashHex.substring(0, 12);
}

videoCallBtn.addEventListener('click', async () => {
    if (!currentRoomCode) {
        alert('You must be in a room first.');
        return;
    }
    const newWindow = window.open('', '_blank');
    if (!newWindow || newWindow.closed || typeof newWindow.closed == 'undefined') {
        alert('Popup blocked! Please allow popups for this site in your browser settings to start the video call.');
        return;
    }
    newWindow.document.write('<html><body style="background:#0f0f12;color:white;font-family:sans-serif;text-align:center;padding-top:20vh;"><h2>Connecting to secure video call...</h2></body></html>');

    try {
        const vdoRoomId = await generateVdoRoomId(currentRoomCode);
        const vdoUrl = `https://vdo.ninja/?room=${encodeURIComponent(vdoRoomId)}&password`;
        newWindow.location.href = vdoUrl;
    } catch (e) {
        console.error('Error opening VDO:', e);
        newWindow.close();
        alert('Error opening video call.');
    }
});

// ================== CLEANUP ==================
leaveBtn.addEventListener('click', () => {
    if (isHost && roomRef) roomRef.delete();
    chatApp.classList.add('hidden');
    landingPage.classList.remove('hidden');
    if (messagesUnsubscribe) messagesUnsubscribe();
    if (presenceUnsubscribe) presenceUnsubscribe();
    if (roomListener) roomListener();
    activeVideoListeners.clear();
    roomRef = null;
    messagesContainer.innerHTML = '';
    messageInput.value = '';
});

function enableChat() {
    messageInput.disabled = false;
    sendBtn.disabled = false;
    imageInput.disabled = false;
    videoInput.disabled = false;
}

function disableChat() {
    messageInput.disabled = true;
    sendBtn.disabled = true;
    imageInput.disabled = true;
    videoInput.disabled = true;
}
enableChat();

// Service worker
if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
        navigator.serviceWorker.register('./sw.js')
            .then(registration => console.log('Service Worker registered with scope:', registration.scope))
            .catch(err => console.error('Service Worker registration failed:', err));
    });
}

// Auto-delete old messages
async function cleanupOldMessages() {
    if (!roomRef) return;
    const cutoff = Date.now() - 10 * 60 * 1000;
    const snapshot = await roomRef.collection('messages').where('timestamp', '<', cutoff).get();
    const batch = db.batch();
    snapshot.forEach(doc => { batch.delete(doc.ref); });
    await batch.commit();
    setTimeout(cleanupOldMessages, 60 * 1000);
}
