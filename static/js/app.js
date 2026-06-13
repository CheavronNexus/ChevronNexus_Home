/**
 * ChevronNexus - Frontend Logic Controller
 * Manages client connection statuses, file uploads, sorting, filtering, and media gallery loading.
 */
document.addEventListener('DOMContentLoaded', function() {
    // ==========================================================================
    // SYSTEM STATE
    // ==========================================================================
    var serverIps = [];
    var serverPort = 80;
    
    var clientUsername = 'Admin';
    var clientIp = '127.0.0.1';
    var clientDeviceName = 'Detecting...';
    
    var mediaFiles = [];
    var displayedFiles = [];
    
    var uploadQueue = [];
    var activeUploads = 0;
    
    var activeCategoryFilter = 'all';  // all, photo, video
    var activeUploaderFilter = 'all';  // all, or username
    var activeSortMethod = 'newest';   // newest, oldest, name_asc, name_desc, size_desc, size_asc
    var activeSearchQuery = '';
    
    var currentLightboxIndex = -1;
    var roomCode = localStorage.getItem('cn_room_code');
    if (!roomCode) {
        roomCode = String(Math.floor(1000 + Math.random() * 9000));
        localStorage.setItem('cn_room_code', roomCode);
    }

    // ==========================================================================
    // CACHED DOM ELEMENTS
    // ==========================================================================
    var el = {
        ipList: document.getElementById('ip-list'),
        openQrBtn: document.getElementById('open-qr-btn'),
        logoutBtn: document.getElementById('logout-btn'),
        qrModal: document.getElementById('qr-modal'),
        closeQrBtn: document.getElementById('close-qr-btn'),
        activeNetworkIp: document.getElementById('active-network-ip'),
        hostsMappingLine: document.getElementById('hosts-mapping-line'),
        qrcodeContainer: document.getElementById('qrcode'),
        
        displayUserGreeting: document.getElementById('display-user-greeting'),
        displayDeviceName: document.getElementById('display-device-name'),
        editDeviceBtn: document.getElementById('edit-device-btn'),
        deviceDisplayBox: document.getElementById('device-display-box'),
        deviceIdentityContainer: document.getElementById('device-identity-container'),
        deviceEditForm: document.getElementById('device-edit-form'),
        deviceNameInput: document.getElementById('device-name-input'),
        saveDeviceBtn: document.getElementById('save-device-btn'),
        cancelDeviceBtn: document.getElementById('cancel-device-btn'),
        
        dropzone: document.getElementById('dropzone'),
        fileInput: document.getElementById('file-input'),
        uploadQueueContainer: document.getElementById('upload-queue-container'),
        queueCount: document.getElementById('queue-count'),
        clearQueueBtn: document.getElementById('clear-queue-btn'),
        uploadAllBtn: document.getElementById('upload-all-btn'),
        uploadQueue: document.getElementById('upload-queue'),
        
        overallProgressContainer: document.getElementById('overall-progress-container'),
        overallProgressFill: document.getElementById('overall-progress-fill'),
        overallProgressText: document.getElementById('overall-progress-text'),
        overallProgressSpeed: document.getElementById('overall-progress-speed'),
        
        filterBtns: document.querySelectorAll('.filter-btn'),
        searchInput: document.getElementById('search-input'),
        uploaderSelect: document.getElementById('uploader-select'),
        sortSelect: document.getElementById('sort-select'),
        mediaGrid: document.getElementById('media-grid'),
        loadingState: document.getElementById('loading-state'),
        emptyState: document.getElementById('empty-state'),
        
        lightbox: document.getElementById('lightbox'),
        lightboxContent: document.getElementById('lightbox-content'),
        lightboxFilename: document.getElementById('lightbox-filename'),
        lightboxMeta: document.getElementById('lightbox-meta'),
        lightboxCloseBtn: document.getElementById('lightbox-close-btn'),
        lightboxDownloadBtn: document.getElementById('lightbox-download-btn'),
        lightboxDeleteBtn: document.getElementById('lightbox-delete-btn'),
        lightboxPrevBtn: document.getElementById('lightbox-prev-btn'),
        lightboxNextBtn: document.getElementById('lightbox-next-btn'),
        toastContainer: document.getElementById('toast-container'),
        
        // Added elements
        ipInterfaceSelect: document.getElementById('ip-interface-select'),
        btnCopyDomain: document.getElementById('btn-copy-domain'),
        btnCopyFallback: document.getElementById('btn-copy-fallback'),
        speedMeterVal: document.getElementById('speed-meter-val'),
        
        // Remote QR elements
        openRemoteQrBtn: document.getElementById('open-remote-qr-btn'),
        remoteQrModal: document.getElementById('remote-qr-modal'),
        closeRemoteQrBtn: document.getElementById('close-remote-qr-btn'),
        remoteCodeDisplay: document.getElementById('remote-code-display'),
        remoteQrcodeContainer: document.getElementById('remote-qrcode'),
        remoteIpInterfaceSelect: document.getElementById('remote-ip-interface-select'),
        remotePairingUrlText: document.getElementById('remote-pairing-url-text'),
        btnCopyRemoteUrl: document.getElementById('btn-copy-remote-url')
    };

    // Initialize Page
    init();

    function init() {
        fetchDeviceIdentity();
        fetchIps();
        fetchFiles();
        setupEventListeners();
        if (el.remoteCodeDisplay) {
            el.remoteCodeDisplay.textContent = roomCode;
        }
        
        // Dynamic speed meter initial execution and interval hook
        updateSpeedMeter();
        setInterval(updateSpeedMeter, 10000);
    }

    // Fetch local IP addresses to configure connection panels and QR code
    function fetchIps() {
        fetch('/api/ips')
            .then(function(res) { return res.json(); })
            .then(function(data) {
                serverIps = data.ips;
                serverPort = data.port;
                renderConnectionInfo();
            })
            .catch(function(err) {
                console.error("Failed to load server IP addresses", err);
                el.ipList.innerHTML = 'Offline Mode';
            });
    }

    function renderConnectionInfo() {
        el.ipList.innerHTML = '';
        
        // Generate clickable links for all local IPs
        serverIps.forEach(function(ip) {
            var url = serverPort === 80 ? 'http://' + ip : 'http://' + ip + ':' + serverPort;
            var link = document.createElement('a');
            link.href = url;
            link.className = 'ip-link';
            link.target = '_blank';
            link.textContent = serverPort === 80 ? ip : ip + ':' + serverPort;
            el.ipList.appendChild(link);
        });

        // Populate interface selector dropdown
        if (el.ipInterfaceSelect) {
            el.ipInterfaceSelect.innerHTML = '';
            serverIps.forEach(function(ip) {
                if (ip !== '127.0.0.1') {
                    var option = document.createElement('option');
                    option.value = ip;
                    option.textContent = ip + ' (LAN / Wi-Fi)';
                    el.ipInterfaceSelect.appendChild(option);
                }
            });
            // Add local loopback fallback if no others
            if (el.ipInterfaceSelect.options.length === 0) {
                var option = document.createElement('option');
                option.value = '127.0.0.1';
                option.textContent = '127.0.0.1 (Localhost)';
                el.ipInterfaceSelect.appendChild(option);
            }
        }

        // Populate remote interface selector dropdown
        if (el.remoteIpInterfaceSelect) {
            el.remoteIpInterfaceSelect.innerHTML = '';
            serverIps.forEach(function(ip) {
                if (ip !== '127.0.0.1') {
                    var option = document.createElement('option');
                    option.value = ip;
                    option.textContent = ip + ' (LAN / Wi-Fi)';
                    el.remoteIpInterfaceSelect.appendChild(option);
                }
            });
            if (el.remoteIpInterfaceSelect.options.length === 0) {
                var option = document.createElement('option');
                option.value = '127.0.0.1';
                option.textContent = '127.0.0.1 (Localhost)';
                el.remoteIpInterfaceSelect.appendChild(option);
            }
        }

        // Function to update QR code and IPs based on chosen IP
        function updateActiveInterface(ip) {
            var url = serverPort === 80 ? 'http://' + ip : 'http://' + ip + ':' + serverPort;
            el.activeNetworkIp.textContent = url;
            
            if (el.hostsMappingLine) {
                el.hostsMappingLine.textContent = ip + ' chevronnexus.com';
            }

            try {
                el.qrcodeContainer.innerHTML = '';
                new QRCode(el.qrcodeContainer, {
                    text: url,
                    width: 200,
                    height: 200,
                    colorDark: '#08090e',
                    colorLight: '#ffffff',
                    correctLevel: QRCode.CorrectLevel.M
                });
            } catch (e) {
                console.error("QR Code library error", e);
            }
        }

        // Function to update Remote QR code based on chosen IP
        function updateRemoteActiveInterface(ip) {
            var baseUrl = serverPort === 80 ? 'http://' + ip : 'http://' + ip + ':' + serverPort;
            var url = baseUrl + '/remote?code=' + roomCode;
            if (el.remotePairingUrlText) {
                el.remotePairingUrlText.textContent = url;
            }
            try {
                el.remoteQrcodeContainer.innerHTML = '';
                new QRCode(el.remoteQrcodeContainer, {
                    text: url,
                    width: 200,
                    height: 200,
                    colorDark: '#08090e',
                    colorLight: '#ffffff',
                    correctLevel: QRCode.CorrectLevel.M
                });
            } catch (e) {
                console.error("Remote QR Code library error", e);
            }
        }

        // Set initial primary IP
        var primaryIp = serverIps.filter(function(ip) { return ip !== '127.0.0.1'; })[0] || '127.0.0.1';
        if (el.ipInterfaceSelect) {
            el.ipInterfaceSelect.value = primaryIp;
        }
        updateActiveInterface(primaryIp);

        if (el.remoteIpInterfaceSelect) {
            el.remoteIpInterfaceSelect.value = primaryIp;
        }
        updateRemoteActiveInterface(primaryIp);

        // Listen for interface selection changes
        if (el.ipInterfaceSelect) {
            el.ipInterfaceSelect.addEventListener('change', function(e) {
                updateActiveInterface(e.target.value);
            });
        }

        if (el.remoteIpInterfaceSelect) {
            el.remoteIpInterfaceSelect.addEventListener('change', function(e) {
                updateRemoteActiveInterface(e.target.value);
            });
        }

        // Update display domain shortcut text and href
        var shortcutTextEl = document.getElementById('display-shortcut-url');
        if (shortcutTextEl) {
            var shortcutUrl = serverPort === 80 ? 'http://chevronnexus.com' : 'http://chevronnexus.com:' + serverPort;
            shortcutTextEl.textContent = shortcutUrl;
            if (shortcutTextEl.tagName === 'A') {
                shortcutTextEl.href = shortcutUrl;
            }
        }
    }

    // Dynamic latency check to mock network link speed
    function updateSpeedMeter() {
        var start = performance.now();
        fetch('/api/ips')
            .then(function(res) { return res.json(); })
            .then(function() {
                var duration = performance.now() - start;
                var ping = Math.round(duration);
                var speedVal = el.speedMeterVal;
                if (speedVal) {
                    var speedText = '';
                    if (ping < 3) {
                        speedText = 'Ping: ' + ping + 'ms | Link: 1.2 Gbps';
                    } else if (ping < 10) {
                        speedText = 'Ping: ' + ping + 'ms | Link: 866 Mbps';
                    } else if (ping < 20) {
                        speedText = 'Ping: ' + ping + 'ms | Link: 433 Mbps';
                    } else {
                        speedText = 'Ping: ' + ping + 'ms | Link: 150 Mbps';
                    }
                    speedVal.textContent = speedText;
                }
            })
            .catch(function() {
                if (el.speedMeterVal) el.speedMeterVal.textContent = 'Offline';
            });
    }

    // Fetch media gallery list from backend
    function fetchFiles() {
        el.loadingState.classList.remove('hidden');
        el.emptyState.classList.add('hidden');
        el.mediaGrid.classList.add('hidden');

        fetch('/api/files')
            .then(function(res) {
                if (!res.ok) {
                    throw new Error('Session inactive or server error (' + res.status + ')');
                }
                return res.json();
            })
            .then(function(data) {
                mediaFiles = data.files || [];
                el.loadingState.classList.add('hidden');
                populateUploaderSelect();
                processAndRenderGallery();
            })
            .catch(function(err) {
                console.error("Failed to retrieve media files", err);
                el.loadingState.classList.add('hidden');
                showToast("Could not retrieve file list.", "error");
            });
    }

    // ==========================================================================
    // UPLOAD QUEUE & DRAG-AND-DROP
    // ==========================================================================
    
    // Add selected/dropped files to the upload queue list
    function handleSelectedFiles(selectedFiles) {
        var allowedTypes = ['image/', 'video/'];
        var addedCount = 0;

        [].slice.call(selectedFiles).forEach(function(file) {
            // Validate file types
            var isAllowed = allowedTypes.some(function(type) { return file.type.indexOf(type) === 0; });
            if (!isAllowed) {
                showToast('"' + file.name + '" is not a photo or video.', "error");
                return;
            }

            // Avoid adding duplicates that are already in the queue
            if (uploadQueue.some(function(item) { return item.file.name === file.name && item.file.size === file.size; })) {
                return;
            }

            // Create unique ID for DOM referencing
            var id = 'queue_' + Math.random().toString(36).substr(2, 9);
            var objectUrl = file.type.indexOf('image/') === 0 ? URL.createObjectURL(file) : null;

            uploadQueue.push({
                id: id,
                file: file,
                status: 'waiting',  // waiting, uploading, done, error
                progress: 0,
                objectUrl: objectUrl
            });
            addedCount++;
        });

        if (addedCount > 0) {
            renderQueue();
            showToast("Added " + addedCount + " file(s) to the queue.", "info");
        }
    }

    function renderQueue() {
        if (uploadQueue.length === 0) {
            el.uploadQueueContainer.classList.add('hidden');
            el.uploadQueue.innerHTML = '';
            return;
        }

        el.uploadQueueContainer.classList.remove('hidden');
        el.queueCount.textContent = uploadQueue.length;
        el.uploadQueue.innerHTML = '';

        uploadQueue.forEach(function(item) {
            var row = document.createElement('div');
            row.className = 'queue-item ' + item.status;
            row.id = item.id;

            // Thumbnail generation
            var thumbHTML = '';
            if (item.file.type.indexOf('image/') === 0) {
                thumbHTML = '<img src="' + item.objectUrl + '" class="queue-thumbnail">';
            } else {
                // Video fallback icon
                thumbHTML = '\
                    <div class="queue-thumbnail">\
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">\
                            <path stroke-linecap="round" stroke-linejoin="round" d="M6 20.25h12A2.25 2.25 0 0020.25 18V6A2.25 2.25 0 0018 3.75H6A2.25 2.25 0 003.75 6v12A2.25 2.25 0 006 20.25z" />\
                            <path stroke-linecap="round" stroke-linejoin="round" d="M15.75 10.5l-4.5 3v-6l4.5 3z" />\
                        </svg>\
                    </div>';
            }

            // Status label
            var statusText = 'Waiting';
            if (item.status === 'uploading') statusText = 'Uploading ' + item.progress + '%';
            if (item.status === 'done') statusText = 'Completed';
            if (item.status === 'error') statusText = 'Failed';

            row.innerHTML = '\
                <div class="item-info">\
                    ' + thumbHTML + '\
                    <div class="item-meta">\
                        <div class="item-name" title="' + item.file.name + '">' + item.file.name + '</div>\
                        <div class="item-size">' + formatBytes(item.file.size) + '</div>\
                    </div>\
                </div>\
                <div style="display: flex; align-items: center; gap: 12px;">\
                    <span class="item-status ' + item.status + '">' + statusText + '</span>\
                    ' + (item.status === 'waiting' ? '\
                        <button class="btn-remove-item" data-id="' + item.id + '" title="Remove from queue">\
                            <svg viewBox="0 0 24 24" class="icon" fill="none" stroke="currentColor" stroke-width="2">\
                                <path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12" />\
                            </svg>\
                        </button>\
                    ' : '') + '\
                </div>\
            ';
            el.uploadQueue.appendChild(row);
        });

        // Hook up individual remove buttons
        [].forEach.call(el.uploadQueue.querySelectorAll('.btn-remove-item'), function(btn) {
            btn.addEventListener('click', function(e) {
                e.stopPropagation();
                var id = btn.getAttribute('data-id');
                removeQueueItem(id);
            });
        });
    }

    function removeQueueItem(id) {
        var idx = -1;
        for (var i = 0; i < uploadQueue.length; i++) {
            if (uploadQueue[i].id === id) {
                idx = i;
                break;
            }
        }
        if (idx > -1) {
            // Revoke object URL to prevent memory leaks
            if (uploadQueue[idx].objectUrl) {
                URL.revokeObjectURL(uploadQueue[idx].objectUrl);
            }
            uploadQueue.splice(idx, 1);
            renderQueue();
        }
    }

    function clearQueue() {
        if (activeUploads > 0) {
            if (!confirm("Uploads are currently active. Do you want to cancel remaining uploads?")) {
                return;
            }
        }
        
        // Revoke all object URLs
        uploadQueue.forEach(function(item) {
            if (item.objectUrl) URL.revokeObjectURL(item.objectUrl);
        });
        
        uploadQueue = [];
        activeUploads = 0;
        el.overallProgressContainer.classList.add('hidden');
        renderQueue();
    }

    // Trigger parallel uploads of queued files
    function uploadAllFiles() {
        var filesToUpload = [];
        for (var i = 0; i < uploadQueue.length; i++) {
            if (uploadQueue[i].status === 'waiting') {
                filesToUpload.push(uploadQueue[i]);
            }
        }
        if (filesToUpload.length === 0) return;

        el.overallProgressContainer.classList.remove('hidden');
        el.overallProgressFill.style.width = '0%';
        el.overallProgressText.textContent = 'Preparing upload...';
        el.overallProgressSpeed.textContent = '';
        
        // Hide delete actions on queue items
        renderQueue();

        var completedUploads = 0;
        var totalSize = 0;
        for (var i = 0; i < filesToUpload.length; i++) {
            totalSize += filesToUpload[i].file.size;
        }
        var uploadedBytesMap = {}; // Tracks bytes uploaded per file
        
        var startTime = Date.now();

        filesToUpload.forEach(function(item) {
            uploadedBytesMap[item.id] = 0;
            item.status = 'uploading';
            
            var formData = new FormData();
            formData.append('files', item.file);

            var xhr = new XMLHttpRequest();
            xhr.open('POST', '/api/upload', true);

            // Hook upload progress
            xhr.upload.addEventListener('progress', function(e) {
                if (e.lengthComputable) {
                    uploadedBytesMap[item.id] = e.loaded;
                    item.progress = Math.round((e.loaded / e.total) * 100);
                    
                    // Update individual status in UI
                    var row = document.getElementById(item.id);
                    if (row) {
                        var statusLabel = row.querySelector('.item-status');
                        if (statusLabel) {
                            statusLabel.textContent = 'Uploading ' + item.progress + '%';
                            statusLabel.className = 'item-status uploading';
                        }
                    }

                    // Compute overall progress
                    var totalUploaded = 0;
                    for (var key in uploadedBytesMap) {
                        if (uploadedBytesMap.hasOwnProperty(key)) {
                            totalUploaded += uploadedBytesMap[key];
                        }
                    }
                    var overallPercent = Math.round((totalUploaded / totalSize) * 100);
                    el.overallProgressFill.style.width = overallPercent + '%';
                    
                    // Compute upload speed
                    var elapsedSeconds = (Date.now() - startTime) / 1000;
                    var speed = totalUploaded / (elapsedSeconds || 1);
                    el.overallProgressSpeed.textContent = formatBytes(speed) + '/s';
                    el.overallProgressText.textContent = 'Uploading: ' + overallPercent + '% (' + completedUploads + '/' + filesToUpload.length + ' done)';
                }
            });

            // Handles request load completion
            xhr.onload = function () {
                completedUploads++;
                var row = document.getElementById(item.id);
                
                var errorMsg = 'Failed';
                if (xhr.status === 200) {
                    try {
                        var response = JSON.parse(xhr.responseText);
                        if (response.errors && response.errors.length > 0) {
                            var fileError = null;
                            for (var j = 0; j < response.errors.length; j++) {
                                if (response.errors[j][item.file.name]) {
                                    fileError = response.errors[j];
                                    break;
                                }
                            }
                            if (fileError) {
                                item.status = 'error';
                                errorMsg = 'Failed: ' + fileError[item.file.name];
                            } else {
                                item.status = 'done';
                            }
                        } else {
                            item.status = 'done';
                        }
                    } catch (e) {
                        item.status = 'done';
                    }
                } else {
                    item.status = 'error';
                    try {
                        var response = JSON.parse(xhr.responseText);
                        if (response.error) {
                            errorMsg = 'Failed: ' + response.error;
                        } else if (response.errors && response.errors.length > 0) {
                            var fileError = null;
                            for (var j = 0; j < response.errors.length; j++) {
                                if (response.errors[j][item.file.name]) {
                                    fileError = response.errors[j];
                                    break;
                                }
                            }
                            if (fileError) {
                                errorMsg = 'Failed: ' + fileError[item.file.name];
                            }
                        }
                    } catch (e) {
                        if (xhr.status === 500) {
                            errorMsg = 'Failed: Server error (500)';
                        } else if (xhr.status === 413) {
                            errorMsg = 'Failed: File too large';
                        } else {
                            errorMsg = 'Failed (' + xhr.status + ')';
                        }
                    }
                }

                if (row) {
                    var statusLabel = row.querySelector('.item-status');
                    if (statusLabel) {
                        if (item.status === 'done') {
                            row.className = 'queue-item done';
                            statusLabel.textContent = 'Completed';
                            statusLabel.className = 'item-status done';
                        } else {
                            row.className = 'queue-item error';
                            statusLabel.textContent = errorMsg;
                            statusLabel.className = 'item-status error';
                            statusLabel.title = errorMsg;
                        }
                    }
                }

                // Check if all uploads in this batch are complete
                if (completedUploads === filesToUpload.length) {
                    handleAllUploadsFinished();
                }
            };

            // Error handles
            xhr.onerror = function () {
                completedUploads++;
                item.status = 'error';
                var row = document.getElementById(item.id);
                if (row) {
                    row.className = 'queue-item error';
                    var statusLabel = row.querySelector('.item-status');
                    if (statusLabel) {
                        statusLabel.textContent = 'Failed: Network error';
                        statusLabel.className = 'item-status error';
                        statusLabel.title = 'Network error during upload';
                    }
                }
                
                if (completedUploads === filesToUpload.length) {
                    handleAllUploadsFinished();
                }
            };

            xhr.send(formData);
        });
    }

    function handleAllUploadsFinished() {
        el.overallProgressText.textContent = 'Upload Completed!';
        el.overallProgressSpeed.textContent = '';
        showToast("Upload batch processed.", "success");
        
        // Refresh media gallery
        fetchFiles();
        
        // Wait 3 seconds and clean successful items from the queue
        setTimeout(function() {
            var nextQueue = [];
            for (var i = 0; i < uploadQueue.length; i++) {
                if (uploadQueue[i].status !== 'done') {
                    nextQueue.push(uploadQueue[i]);
                }
            }
            uploadQueue = nextQueue;
            renderQueue();
            el.overallProgressContainer.classList.add('hidden');
        }, 3000);
    }

    // ==========================================================================
    // GALLERY RENDERING & FILTERS
    // ==========================================================================
    
    function processAndRenderGallery() {
        // 1. Filter files
        displayedFiles = mediaFiles.filter(function(file) {
            var matchesCategory = (activeCategoryFilter === 'all') || (file.category === activeCategoryFilter);
            var matchesUploader = (activeUploaderFilter === 'all') || (file.uploader_username === activeUploaderFilter);
            var displayName = file.name.replace(/\.[^/.]+$/, "").toLowerCase();
            var matchesSearch = !activeSearchQuery || displayName.indexOf(activeSearchQuery) > -1;
            
            return matchesCategory && matchesUploader && matchesSearch;
        });

        // 2. Sort files
        displayedFiles.sort(function(a, b) {
            if (activeSortMethod === 'newest') return b.uploaded_at - a.uploaded_at;
            if (activeSortMethod === 'oldest') return a.uploaded_at - b.uploaded_at;
            if (activeSortMethod === 'name_asc') return a.name.localeCompare(b.name);
            if (activeSortMethod === 'name_desc') return b.name.localeCompare(a.name);
            if (activeSortMethod === 'size_desc') return b.size - a.size;
            if (activeSortMethod === 'size_asc') return a.size - b.size;
            return 0;
        });

        // 3. Render gallery
        el.mediaGrid.innerHTML = '';
        
        if (displayedFiles.length === 0) {
            el.mediaGrid.classList.add('hidden');
            el.emptyState.classList.remove('hidden');
            return;
        }

        el.emptyState.classList.add('hidden');
        el.mediaGrid.classList.remove('hidden');

        displayedFiles.forEach(function(file, index) {
            var card = document.createElement('div');
            card.className = 'media-card glass';
            card.setAttribute('data-category', file.category);

            var previewHTML = '';
            var displayName = file.name.replace(/\.[^/.]+$/, "");

            if (file.category === 'photo') {
                previewHTML = '<img src="/static/placeholder.png" data-src="/uploads/' + encodeURIComponent(file.name) + '" alt="' + file.name + '" class="media-thumb lazy-image">';
            } else {
                previewHTML = '\
                    <div class="video-preview-wrapper">\
                        <svg viewBox="0 0 24 24" class="video-play-icon" fill="currentColor">\
                            <path d="M8 5v14l11-7z" />\
                        </svg>\
                        <span class="video-duration">' + (file.duration ? formatDuration(file.duration) : 'Video') + '</span>\
                    </div>';
            }

            card.innerHTML = '\
                <div class="card-preview" data-index="' + index + '">\
                    ' + previewHTML + '\
                </div>\
                <div class="card-details">\
                    <div class="card-name" title="' + displayName + '">' + displayName + '</div>\
                    <div style="display:flex; justify-content:space-between; align-items:center; margin-top: 4px;">\
                        <span class="card-meta">' + formatBytes(file.size) + '</span>\
                        <span class="card-meta">' + formatRelativeTime(file.uploaded_at) + '</span>\
                    </div>\
                    <div class="card-uploader-row">\
                        <svg viewBox="0 0 24 24" class="uploader-icon-svg" fill="none" stroke="currentColor" stroke-width="2">\
                            <path stroke-linecap="round" stroke-linejoin="round" d="M17.982 18.725A7.488 7.488 0 0012 15.75a7.488 7.488 0 00-5.982 2.975m11.963 0a9 9 0 10-11.963 0m11.963 0A8.966 8.966 0 0112 21a8.966 8.966 0 01-5.982-2.275M15 9.75a3 3 0 11-6 0 3 3 0 016 0z" />\
                        </svg>\
                        <span>' + (file.uploader_name || file.uploader_username || 'System') + ' (' + (file.uploader_device || 'Main') + ')</span>\
                    </div>\
                    <div style="display: flex; gap: 8px; margin-top: 10px;">\
                        ' + (file.category === 'video' ? '\
                            <a href="/player/' + encodeURIComponent(file.name) + '" class="btn btn-primary btn-sm btn-icon-only" title="Open in Theater Player">\
                                <svg viewBox="0 0 24 24" fill="currentColor">\
                                    <path d="M8 5v14l11-7z" />\
                                </svg>\
                                <span>Play</span>\
                            </a>\
                        ' : '') + '\
                        <button class="btn btn-danger btn-sm btn-icon-only action-btn-delete" data-path="' + file.name + '" title="Delete file from server">\
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">\
                                <path stroke-linecap="round" stroke-linejoin="round" d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0" />\
                            </svg>\
                        </button>\
                    </div>\
                </div>\
            ';
            el.mediaGrid.appendChild(card);
        });

        // Setup Lightbox triggers
        [].forEach.call(el.mediaGrid.querySelectorAll('.card-preview'), function(preview) {
            preview.addEventListener('click', function() {
                var idx = parseInt(preview.getAttribute('data-index'));
                openLightbox(idx);
            });
        });

        // Setup individual delete handlers
        [].forEach.call(el.mediaGrid.querySelectorAll('.action-btn-delete'), function(btn) {
            btn.addEventListener('click', function(e) {
                e.stopPropagation();
                var path = btn.getAttribute('data-path');
                deleteFile(path);
            });
        });

        lazyLoadImages();
    }

    function lazyLoadImages() {
        var lazyImages = document.querySelectorAll('.lazy-image');
        if ('IntersectionObserver' in window) {
            var observer = new IntersectionObserver(function(entries, observer) {
                entries.forEach(function(entry) {
                    if (entry.isIntersecting) {
                        var img = entry.target;
                        img.src = img.getAttribute('data-src');
                        img.classList.remove('lazy-image');
                        observer.unobserve(img);
                    }
                });
            });
            [].forEach.call(lazyImages, function(img) { observer.observe(img); });
        } else {
            // Fallback for older browsers
            [].forEach.call(lazyImages, function(img) {
                img.src = img.getAttribute('data-src');
                img.classList.remove('lazy-image');
            });
        }
    }

    function deleteFile(fileName) {
        if (!confirm("Are you sure you want to delete this file permanently?")) {
            return;
        }

        fetch('/api/files/' + encodeURIComponent(fileName), {
            method: 'DELETE'
        })
        .then(function(res) {
            return res.json().catch(function() {
                return { error: 'Server returned non-JSON error (' + res.status + ')' };
            }).then(function(data) {
                if (!res.ok) throw new Error(data.error || 'Server error');
                return data;
            });
        })
        .then(function(data) {
            showToast("File deleted successfully.", "success");
            fetchFiles();
        })
        .catch(function(err) {
            console.error("Delete failed", err);
            showToast(err.message, "error");
        });
    }

    // ==========================================================================
    // LIGHTBOX INTERACTION (PHOTOS & INTEGRATED PLAYBACK)
    // ==========================================================================
    
    function openLightbox(index) {
        currentLightboxIndex = index;
        var file = displayedFiles[index];
        if (!file) return;

        el.lightboxFilename.textContent = file.name;
        el.lightboxMeta.textContent = 'Size: ' + formatBytes(file.size) + ' | Uploaded: ' + formatRelativeTime(file.uploaded_at);
        el.lightboxDownloadBtn.href = '/uploads/' + encodeURIComponent(file.name) + '?download=1';

        // Render appropriate HTML elements based on media category
        el.lightboxContent.innerHTML = '';
        if (file.category === 'photo') {
            var img = document.createElement('img');
            img.src = '/uploads/' + encodeURIComponent(file.name);
            img.className = 'lightbox-media-img';
            el.lightboxContent.appendChild(img);
        } else {
            var video = document.createElement('video');
            video.src = '/uploads/' + encodeURIComponent(file.name);
            video.controls = true;
            video.autoplay = true;
            video.className = 'lightbox-media-video';
            el.lightboxContent.appendChild(video);
        }

        el.lightbox.classList.add('active');
    }

    function closeLightbox() {
        el.lightbox.classList.remove('active');
        // Stop any playing video by clearing inner HTML
        el.lightboxContent.innerHTML = '';
        currentLightboxIndex = -1;
    }

    function navigateLightbox(direction) {
        if (currentLightboxIndex === -1) return;
        var newIndex = currentLightboxIndex + direction;
        
        if (newIndex >= 0 && newIndex < displayedFiles.length) {
            openLightbox(newIndex);
        }
    }

    // ==========================================================================
    // EVENT LISTENERS HOOKUPS
    // ==========================================================================
    
    function setupEventListeners() {
        // Modal QR open/close
        if (el.openQrBtn) el.openQrBtn.addEventListener('click', function() { el.qrModal.classList.add('active'); });
        if (el.closeQrBtn) el.closeQrBtn.addEventListener('click', function() { el.qrModal.classList.remove('active'); });
        if (el.qrModal) {
            el.qrModal.addEventListener('click', function(e) {
                if (e.target === el.qrModal) el.qrModal.classList.remove('active');
            });
        }

        // Remote QR modal open/close
        if (el.openRemoteQrBtn) el.openRemoteQrBtn.addEventListener('click', function() { el.remoteQrModal.classList.add('active'); });
        if (el.closeRemoteQrBtn) el.closeRemoteQrBtn.addEventListener('click', function() { el.remoteQrModal.classList.remove('active'); });
        if (el.remoteQrModal) {
            el.remoteQrModal.addEventListener('click', function(e) {
                if (e.target === el.remoteQrModal) el.remoteQrModal.classList.remove('active');
            });
        }

        // Dropzone upload triggering
        if (el.dropzone) el.dropzone.addEventListener('click', function() { el.fileInput.click(); });
        if (el.fileInput) el.fileInput.addEventListener('change', function(e) { handleSelectedFiles(e.target.files); });

        // Drag & Drop visual feedbacks
        if (el.dropzone) {
            ['dragenter', 'dragover'].forEach(function(eventName) {
                el.dropzone.addEventListener(eventName, function(e) {
                    e.preventDefault();
                    e.stopPropagation();
                    el.dropzone.classList.add('dragover');
                });
            });

            ['dragleave', 'drop'].forEach(function(eventName) {
                el.dropzone.addEventListener(eventName, function(e) {
                    e.preventDefault();
                    e.stopPropagation();
                    el.dropzone.classList.remove('dragover');
                });
            });

            el.dropzone.addEventListener('drop', function(e) {
                var dt = e.dataTransfer;
                var files = dt.files;
                handleSelectedFiles(files);
            });
        }

        // Upload control buttons
        if (el.clearQueueBtn) el.clearQueueBtn.addEventListener('click', clearQueue);
        if (el.uploadAllBtn) el.uploadAllBtn.addEventListener('click', uploadAllFiles);

        // Filters buttons triggers
        [].forEach.call(el.filterBtns, function(btn) {
            btn.addEventListener('click', function() {
                [].forEach.call(el.filterBtns, function(b) { b.classList.remove('active'); });
                btn.classList.add('active');
                activeCategoryFilter = btn.getAttribute('data-filter');
                processAndRenderGallery();
            });
        });

        // Search inputs
        if (el.searchInput) {
            el.searchInput.addEventListener('input', function(e) {
                activeSearchQuery = e.target.value.trim().toLowerCase();
                processAndRenderGallery();
            });
        }

        // Sort Selectors
        if (el.sortSelect) {
            el.sortSelect.addEventListener('change', function(e) {
                activeSortMethod = e.target.value;
                processAndRenderGallery();
            });
        }

        // Uploader filter selector
        if (el.uploaderSelect) {
            el.uploaderSelect.addEventListener('change', function(e) {
                activeUploaderFilter = e.target.value;
                processAndRenderGallery();
            });
        }

        // Copy buttons inside QR Portal Modal
        if (el.btnCopyDomain) {
            el.btnCopyDomain.addEventListener('click', function(e) {
                e.stopPropagation();
                var shortcutTextEl = document.getElementById('display-shortcut-url');
                if (shortcutTextEl) {
                    var text = shortcutTextEl.textContent;
                    copyToClipboard(text).then(function() {
                        showToast("Domain link copied!", "success");
                    }).catch(function() {
                        showToast("Failed to copy link.", "error");
                    });
                }
            });
        }
        if (el.btnCopyFallback) {
            el.btnCopyFallback.addEventListener('click', function(e) {
                e.stopPropagation();
                var text = el.activeNetworkIp.textContent;
                copyToClipboard(text).then(function() {
                    showToast("IP fallback link copied!", "success");
                }).catch(function() {
                    showToast("Failed to copy link.", "error");
                });
            });
        }

        if (el.btnCopyRemoteUrl) {
            el.btnCopyRemoteUrl.addEventListener('click', function(e) {
                e.stopPropagation();
                if (el.remotePairingUrlText) {
                    var text = el.remotePairingUrlText.textContent;
                    copyToClipboard(text).then(function() {
                        showToast("Remote pairing link copied!", "success");
                    }).catch(function() {
                        showToast("Failed to copy link.", "error");
                    });
                }
            });
        }

        // Logout session triggering
        if (el.logoutBtn) {
            el.logoutBtn.addEventListener('click', function() {
                if (!confirm("Are you sure you want to end this connection session?")) return;
                fetch('/api/auth/logout', { method: 'POST' })
                    .then(function(res) { return res.json(); })
                    .then(function(data) {
                        showToast("Logged out successfully.", "info");
                        setTimeout(function() {
                            window.location.reload();
                        }, 1000);
                    })
                    .catch(function(err) {
                        console.error("Logout error", err);
                        showToast("Could not send logout command to server.", "error");
                    });
            });
        }

        // Device customizer actions
        if (el.editDeviceBtn) {
            el.editDeviceBtn.addEventListener('click', function() {
                el.deviceDisplayBox.classList.add('hidden');
                el.deviceEditForm.classList.remove('hidden');
                el.deviceNameInput.value = clientDeviceName;
                el.deviceNameInput.focus();
            });
        }

        if (el.cancelDeviceBtn) {
            el.cancelDeviceBtn.addEventListener('click', function() {
                el.deviceEditForm.classList.add('hidden');
                el.deviceDisplayBox.classList.remove('hidden');
            });
        }

        if (el.saveDeviceBtn) el.saveDeviceBtn.addEventListener('click', saveDeviceName);
        if (el.deviceNameInput) {
            el.deviceNameInput.addEventListener('keydown', function(e) {
                if (e.key === 'Enter') saveDeviceName();
                if (e.key === 'Escape') el.cancelDeviceBtn.click();
            });
        }

        // Lightbox buttons
        if (el.lightboxCloseBtn) el.lightboxCloseBtn.addEventListener('click', closeLightbox);
        if (el.lightboxPrevBtn) el.lightboxPrevBtn.addEventListener('click', function() { navigateLightbox(-1); });
        if (el.lightboxNextBtn) el.lightboxNextBtn.addEventListener('click', function() { navigateLightbox(1); });
        if (el.lightboxDeleteBtn) {
            el.lightboxDeleteBtn.addEventListener('click', function() {
                if (currentLightboxIndex === -1) return;
                var file = displayedFiles[currentLightboxIndex];
                if (!file) return;
                
                var fileToDelete = file.name;
                closeLightbox();
                deleteFile(fileToDelete);
            });
        }
        
        if (el.lightbox) {
            el.lightbox.addEventListener('click', function(e) {
                // Close lightbox if clicking outside media content and footer/header controls
                if (e.target === el.lightbox || e.target === el.lightboxContent) {
                    closeLightbox();
                }
            });
        }

        // Keyboard navigation (Escape, Left/Right Arrows)
        document.addEventListener('keydown', function(e) {
            if (currentLightboxIndex > -1) {
                if (e.key === 'Escape') closeLightbox();
                if (e.key === 'ArrowLeft') navigateLightbox(-1);
                if (e.key === 'ArrowRight') navigateLightbox(1);
            }
            if (e.key === 'Escape' && el.qrModal.classList.contains('active')) {
                el.qrModal.classList.remove('active');
            }
        });
    }

    // ==========================================================================
    // CLIENT DEVICE IDENTIFICATION & DB HELPERS
    // ==========================================================================
    
    function fetchDeviceIdentity() {
        // Fetch active session user details
        fetch('/api/auth/session')
            .then(function(res) { return res.json(); })
            .then(function(sessionData) {
                if (sessionData.logged_in) {
                    clientUsername = sessionData.username;
                    el.displayUserGreeting.textContent = sessionData.name || clientUsername;
                }
            })
            .catch(function(err) { console.error("Session lookup failed", err); });

        // Fetch client device moniker mapping
        fetch('/api/device')
            .then(function(res) { return res.json(); })
            .then(function(data) {
                clientIp = data.ip;
                clientDeviceName = data.device_name;
                el.displayDeviceName.textContent = '(' + clientDeviceName + ')';
            })
            .catch(function(err) {
                console.error("Failed to load device identity", err);
                el.displayDeviceName.textContent = "(Unknown Device)";
            });
    }

    function saveDeviceName() {
        var newName = el.deviceNameInput.value.trim();
        if (!newName) {
            showToast("Device name cannot be empty.", "error");
            return;
        }

        fetch('/api/device/register', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ device_name: newName })
        })
        .then(function(res) { return res.json(); })
        .then(function(data) {
            if (data.success) {
                clientDeviceName = data.device_name;
                el.displayDeviceName.textContent = '(' + clientDeviceName + ')';
                el.deviceEditForm.classList.add('hidden');
                el.deviceDisplayBox.classList.remove('hidden');
                showToast("Device name updated!", "success");
                fetchFiles();
            } else {
                showToast(data.error || "Failed to update device name.", "error");
            }
        })
        .catch(function(err) {
            console.error("Error saving device name", err);
            showToast("Could not communicate with the database.", "error");
        });
    }

    function populateUploaderSelect() {
        if (!el.uploaderSelect) return;
        
        // Compile unique uploaders based on usernames
        var uniqueUploaders = {};
        var uploaders = [];
        for (var i = 0; i < mediaFiles.length; i++) {
            var uploader = mediaFiles[i].uploader_username;
            if (uploader && !uniqueUploaders[uploader]) {
                uniqueUploaders[uploader] = true;
                uploaders.push(uploader);
            }
        }
        var currentSelection = el.uploaderSelect.value;
        
        el.uploaderSelect.innerHTML = '<option value="all">All Travelers</option>';
        
        uploaders.forEach(function(uploader) {
            var option = document.createElement('option');
            option.value = uploader;
            option.textContent = uploader;
            el.uploaderSelect.appendChild(option);
        });
        
        if (uploaders.indexOf(currentSelection) > -1) {
            el.uploaderSelect.value = currentSelection;
            activeUploaderFilter = currentSelection;
        } else {
            el.uploaderSelect.value = 'all';
            activeUploaderFilter = 'all';
        }
    }

    // ==========================================================================
    // UTILITY HELPER FUNCTIONS
    // ==========================================================================

    // Copy to clipboard helper that supports older devices and HTTP contexts
    function copyToClipboard(text) {
        if (navigator.clipboard && navigator.clipboard.writeText) {
            return navigator.clipboard.writeText(text);
        } else {
            return new Promise(function(resolve, reject) {
                try {
                    var textArea = document.createElement("textarea");
                    textArea.value = text;
                    textArea.style.top = "0";
                    textArea.style.left = "0";
                    textArea.style.position = "fixed";
                    document.body.appendChild(textArea);
                    textArea.focus();
                    textArea.select();
                    var successful = document.execCommand('copy');
                    document.body.removeChild(textArea);
                    if (successful) {
                        resolve();
                    } else {
                        reject(new Error('Copy command failed'));
                    }
                } catch (err) {
                    reject(err);
                }
            });
        }
    }

    // Dynamic Toast Notification creator
    function showToast(message, type) {
        if (!type) type = 'info';
        var toast = document.createElement('div');
        toast.className = 'toast ' + type;
        
        var iconHTML = '';
        if (type === 'success') {
            iconHTML = '\
                <svg viewBox="0 0 24 24" class="toast-icon" fill="none" stroke="currentColor" stroke-width="2">\
                    <path stroke-linecap="round" stroke-linejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />\
                </svg>';
        } else if (type === 'error') {
            iconHTML = '\
                <svg viewBox="0 0 24 24" class="toast-icon" fill="none" stroke="currentColor" stroke-width="2">\
                    <path stroke-linecap="round" stroke-linejoin="round" d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z" />\
                </svg>';
        } else {
            iconHTML = '\
                <svg viewBox="0 0 24 24" class="toast-icon" fill="none" stroke="currentColor" stroke-width="2">\
                    <path stroke-linecap="round" stroke-linejoin="round" d="M11.25 11.25l.041-.02a.75.75 0 111.085 1.085l-.04.02m-2.138 1.57h.008v.008H12v-.008zM21 12a9 9 0 11-18 0 9 9 0 0118 0z" />\
                </svg>';
        }

        toast.innerHTML = iconHTML + '<span>' + message + '</span>';
        
        el.toastContainer.appendChild(toast);
        
        // Remove toast with transition
        setTimeout(function() {
            toast.style.transition = 'opacity 0.5s ease, transform 0.5s ease';
            toast.style.opacity = '0';
            toast.style.transform = 'translateY(-10px)';
            setTimeout(function() { toast.remove(); }, 500);
        }, 4000);
    }

    // Convert file size in bytes to human-readable format
    function formatBytes(bytes, decimals) {
        if (bytes === 0) return '0 Bytes';
        if (decimals === undefined) decimals = 2;
        var k = 1024;
        var dm = decimals < 0 ? 0 : decimals;
        var sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
        var i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
    }

    // Convert video duration in seconds to H:MM:SS or MM:SS format
    function formatDuration(seconds) {
        var s = Math.round(seconds);
        var h = Math.floor(s / 3600);
        var m = Math.floor((s % 3600) / 60);
        var sec = Math.floor(s % 60);
        
        var mm = (h > 0 && m < 10) ? '0' + m : m;
        var ss = (sec < 10) ? '0' + sec : sec;
        
        return h > 0 ? h + ':' + mm + ':' + ss : mm + ':' + ss;
    }

    // Convert upload timestamp to user-friendly relative string
    function formatRelativeTime(timestamp) {
        var diff = (Date.now() / 1000) - timestamp;
        if (diff < 60) return "Just now";
        var mins = Math.floor(diff / 60);
        if (mins < 60) return mins + "m ago";
        var hours = Math.floor(mins / 60);
        if (hours < 24) return hours + "h ago";
        var days = Math.floor(hours / 24);
        return days + "d ago";
    }
});
