const { createFFmpeg, fetchFile } = FFmpeg;

// 初始化 ffmpeg 实例
// log: true 用于在控制台输出 ffmpeg 日志，方便调试
// 显式指定单线程核心路径 (适配 0.9.8)
const ffmpeg = createFFmpeg({ 
    log: true,
    corePath: 'vendor/ffmpeg/ffmpeg-core.js'
});

// 状态管理
const state = {
    files: [], // { id, file, status, originalSize, compressedSize, resultBlobUrl, resultBlob, logs, errorMessage }
    isProcessing: false,
    ffmpegLoaded: false,
    readyToDownload: false
};

// DOM 元素引用
const elements = {
    dropZone: document.getElementById('drop-zone'),
    fileInput: document.getElementById('file-input'),
    selectBtn: document.getElementById('select-btn'),
    uploadStatus: document.getElementById('upload-status'),
    uploadProgress: document.getElementById('upload-progress'),
    uploadProgressBar: document.getElementById('upload-progress-bar'),
    fileList: document.getElementById('file-list'),
    fileCount: document.getElementById('file-count'),
    clearBtn: document.getElementById('clear-list-btn'),
    startBtn: document.getElementById('start-btn'),
    summaryBar: document.getElementById('summary-bar'),
    totalSaved: document.getElementById('total-saved'),
    
    // 配置
    presetSelect: document.getElementById('preset-select'),
    codecSelect: document.getElementById('codec-select'),
    resolutionSelect: document.getElementById('resolution-select'),
    bitrateRange: document.getElementById('bitrate-range'),
    bitrateDisplay: document.getElementById('bitrate-display'),
    fpsSelect: document.getElementById('fps-select'),

    // 模态框
    modal: document.getElementById('preview-modal'),
    closeModal: document.querySelector('.close-modal'),
    syncPlayBtn: document.getElementById('sync-play-btn'),
    saveSingleBtn: document.getElementById('download-link'), // Note: ID in HTML was download-link
    previewContainers: Array.from(document.querySelectorAll('.video-compare-container')),
    previewDeviceSelects: Array.from(document.querySelectorAll('.preview-device-select')),
    videoOriginals: Array.from(document.querySelectorAll('.video-original')),
    videoCompresseds: Array.from(document.querySelectorAll('.video-compressed')),
    metaOriginals: Array.from(document.querySelectorAll('.meta-original')),
    metaCompresseds: Array.from(document.querySelectorAll('.meta-compressed'))
};

// 预设配置
const presets = {
    h5_rec: { codec: 'libx264', bitrate: '2000', resolution: '1920:-1', fps: '25' }, // H.264 兼容性更好
    hd_web: { codec: 'libx264', bitrate: '4000', resolution: '-1:-1', fps: '0' },
    mobile: { codec: 'libx264', bitrate: '1000', resolution: '1280:-1', fps: '25' }
};

function getFriendlyErrorMessage(err, config, fileItem) {
    const raw = (err && err.message ? err.message : '').toLowerCase();
    const fileSize = fileItem && fileItem.file ? fileItem.file.size : 0;
    const maxFriendlySize = 1024 * 1024 * 1024; // 1GB
    const bitrateKbps = config && config.bitrate ? parseInt(config.bitrate, 10) : 0;
    const resolution = config && config.resolution ? config.resolution : '';
    const targetWidth = resolution && resolution !== '-1:-1'
        ? parseInt(resolution.split(':')[0], 10)
        : 0;
    if (!raw) {
        return '压缩失败：未知错误。建议换一个视频或稍后重试。';
    }
    if (fileSize >= maxFriendlySize) {
        return '压缩失败：文件过大，浏览器可能内存不足。建议先剪辑分段或降低分辨率/码率后再试。';
    }
    if (bitrateKbps >= 12000) {
        return '压缩失败：码率过高可能导致失败。建议降低码率（如 2000-6000 kbps）后重试。';
    }
    if (targetWidth >= 3840) {
        return '压缩失败：分辨率过高可能导致失败。建议降低分辨率到 1920 或更低。';
    }
    if (raw.includes('output') || raw.includes('not found') || raw.includes('未生成')) {
        return '压缩失败：未生成输出文件。可能是源视频编码不受支持。建议更换视频格式（如 MP4/H.264）后重试。';
    }
    if (raw.includes('invalid') || raw.includes('error') && raw.includes('argument')) {
        return '压缩失败：参数不兼容。建议恢复默认设置或选择预设后再试。';
    }
    if (raw.includes('unsupported') || raw.includes('not supported')) {
        return '压缩失败：当前浏览器或 FFmpeg 核心不支持该编码。建议切换为 H.264 或更换浏览器后重试。';
    }
    if (config && config.codec === 'libx265') {
        return '压缩失败：H.265 在当前环境兼容性较差。建议改用 H.264 再试。';
    }
    return '压缩失败：处理过程中发生错误。建议更换视频或调低码率/分辨率后重试。';
}

// --- 初始化 ---
function setStartButtonState(text, disabled) {
    elements.startBtn.textContent = text;
    elements.startBtn.disabled = disabled;
}

async function loadFFmpegIfNeeded() {
    if (state.ffmpegLoaded) return true;
    try {
        console.log('正在加载 ffmpeg-core...');
        setStartButtonState('加载 FFmpeg 核心组件中', true);
        await ffmpeg.load();
        state.ffmpegLoaded = true;
        console.log('ffmpeg 加载完成');
        return true;
    } catch (e) {
        console.error('ffmpeg 加载失败:', e);
        alert('FFmpeg 加载失败。请注意：此应用需要 SharedArrayBuffer 支持，请确保服务器配置了 COOP/COEP 头，或者使用支持的浏览器环境。');
        setStartButtonState('开始批量压缩', false);
        return false;
    }
}

// --- 事件监听 ---

elements.selectBtn.addEventListener('click', () => elements.fileInput.click());
elements.dropZone.addEventListener('click', (e) => {
    if (e.target && e.target.closest && e.target.closest('.btn')) return;
    elements.fileInput.click();
});

elements.fileInput.addEventListener('change', (e) => handleFiles(e.target.files));

elements.dropZone.addEventListener('dragover', (e) => {
    e.preventDefault();
    elements.dropZone.classList.add('drag-over');
});

elements.dropZone.addEventListener('dragleave', () => {
    elements.dropZone.classList.remove('drag-over');
});

elements.dropZone.addEventListener('drop', (e) => {
    e.preventDefault();
    elements.dropZone.classList.remove('drag-over');
    handleFiles(e.dataTransfer.files);
});

elements.clearBtn.addEventListener('click', () => {
    state.files = [];
    state.readyToDownload = false;
    renderFileList();
    updateSummary();
});

elements.startBtn.addEventListener('click', () => {
    if (state.readyToDownload) {
        downloadAllAsZip();
        return;
    }
    startProcessing();
});

// 参数配置联动
elements.bitrateRange.addEventListener('input', (e) => {
    elements.bitrateDisplay.textContent = `${e.target.value} kbps`;
    elements.presetSelect.value = 'custom';
});

[elements.codecSelect, elements.resolutionSelect, elements.fpsSelect].forEach(el => {
    el.addEventListener('change', () => elements.presetSelect.value = 'custom');
});

elements.presetSelect.addEventListener('change', (e) => {
    const preset = presets[e.target.value];
    if (preset) {
        elements.codecSelect.value = preset.codec;
        elements.resolutionSelect.value = preset.resolution;
        elements.bitrateRange.value = preset.bitrate;
        elements.bitrateDisplay.textContent = `${preset.bitrate} kbps`;
        elements.fpsSelect.value = preset.fps;
    }
});

// 模态框逻辑
elements.closeModal.addEventListener('click', () => {
    elements.modal.style.display = 'none';
    elements.videoOriginals.forEach((video) => {
        if (!video) return;
        video.pause();
        video.src = '';
    });
    elements.videoCompresseds.forEach((video) => {
        if (!video) return;
        video.pause();
        video.src = '';
    });
});

elements.syncPlayBtn.addEventListener('click', toggleSyncPlay);
elements.previewDeviceSelects.forEach((select) => {
    select.addEventListener('change', applyPreviewResolution);
});

window.addEventListener('click', (e) => {
    if (e.target === elements.modal) {
        elements.modal.style.display = 'none';
    }
});

// --- 核心逻辑 ---

function setUploadProgress(loaded, total, note) {
    if (!elements.uploadProgress || !elements.uploadProgressBar || !elements.uploadStatus) return;
    const safeTotal = Math.max(total, 1);
    const percent = Math.min(100, Math.round((loaded / safeTotal) * 100));
    elements.uploadStatus.textContent = note || `正在导入 ${loaded}/${total}`;
    elements.uploadProgressBar.style.width = `${percent}%`;
    elements.uploadProgress.classList.add('active');
}

function resetUploadProgress(message) {
    if (!elements.uploadProgress || !elements.uploadProgressBar || !elements.uploadStatus) return;
    elements.uploadStatus.textContent = message || '等待选择文件';
    elements.uploadProgressBar.style.width = '0%';
    elements.uploadProgress.classList.remove('active');
}

async function handleFiles(fileList) {
    const newFiles = Array.from(fileList).filter(f => f.type.startsWith('video/'));
    const ignoredCount = Array.from(fileList).length - newFiles.length;
    if (newFiles.length === 0) {
        resetUploadProgress(ignoredCount > 0 ? '未检测到视频文件，请选择视频格式' : '未选择文件');
        return;
    }

    setUploadProgress(0, newFiles.length, '正在导入文件...');
    
    let imported = 0;
    for (const file of newFiles) {
        state.files.push({
            id: Date.now() + Math.random().toString(36).substr(2, 9),
            file: file,
            status: 'pending', // pending, processing, completed, error
            originalSize: file.size,
            compressedSize: 0,
            resultBlobUrl: null,
            resultBlob: null,
            progress: 0,
            errorMessage: ''
        });
        imported += 1;
        setUploadProgress(imported, newFiles.length, `正在导入 ${imported}/${newFiles.length}`);
        // 让 UI 有机会刷新，改善大批量导入时的体验
        await new Promise(resolve => setTimeout(resolve, 0));
    }

    state.readyToDownload = false;
    renderFileList();
    updateSummary();
    if (ignoredCount > 0) {
        resetUploadProgress(`已导入 ${newFiles.length} 个视频，已忽略 ${ignoredCount} 个非视频文件`);
    } else {
        resetUploadProgress(`已导入 ${newFiles.length} 个视频`);
    }
}

function formatSize(bytes) {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

function renderFileList() {
    elements.fileList.innerHTML = '';
    elements.fileCount.textContent = state.files.length;
    elements.startBtn.disabled = state.files.length === 0 || state.isProcessing;
    if (!state.isProcessing && !state.readyToDownload) {
        elements.startBtn.textContent = '开始批量压缩';
    }

    if (state.files.length === 0) {
        elements.fileList.innerHTML = '<div class="empty-state">暂无文件，请先添加视频</div>';
        return;
    }

    state.files.forEach(item => {
        const div = document.createElement('div');
        div.className = `file-item ${item.status}`;
        
        let statusHtml = '';
        if (item.status === 'pending') statusHtml = '<span class="status">等待处理</span>';
        else if (item.status === 'processing') statusHtml = `<span class="status">处理中 ${Math.round(item.progress * 100)}%</span>`;
        else if (item.status === 'completed') statusHtml = `<span class="status">完成 (-${Math.round((1 - item.compressedSize / item.originalSize) * 100)}%)</span>`;
        else if (item.status === 'error') {
            const reason = item.errorMessage ? `：${item.errorMessage}` : '';
            statusHtml = `<span class="status" style="color:var(--danger-color)">失败${reason}</span>`;
        }

        let actionHtml = `<div class="file-actions"><button class="btn text remove-btn" data-id="${item.id}">移除</button></div>`;
        if (item.status === 'completed') {
            actionHtml = `
                <div class="file-actions">
                    <button class="btn text preview-btn" data-id="${item.id}">对比预览</button>
                    <a href="${item.resultBlobUrl}" download="compressed_${item.file.name}" class="btn text">下载</a>
                </div>
            `;
        }

        const compressedSizeDisplay = item.compressedSize > 0
            ? `${formatSize(item.compressedSize)} (-${Math.round((1 - item.compressedSize / item.originalSize) * 100)}%)`
            : '--';

        div.innerHTML = `
            <div class="file-name" title="${item.file.name}">${item.file.name}</div>
            <div>${formatSize(item.originalSize)}</div>
            <div>${compressedSizeDisplay}</div>
            <div>${statusHtml}</div>
            <div class="actions-cell">${actionHtml}</div>
        `;

        elements.fileList.appendChild(div);
    });

    // 绑定动态按钮事件
    document.querySelectorAll('.remove-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            if (state.isProcessing) return;
            const id = e.target.dataset.id;
            state.files = state.files.filter(f => f.id !== id);
            state.readyToDownload = false;
            renderFileList();
            updateSummary();
        });
    });

    document.querySelectorAll('.preview-btn').forEach(btn => {
        btn.addEventListener('click', (e) => showPreview(e.target.dataset.id));
    });
}

function updateSummary() {
    const totalOrig = state.files.reduce((acc, curr) => acc + curr.originalSize, 0);
    const totalComp = state.files.reduce((acc, curr) => curr.compressedSize > 0 ? acc + curr.compressedSize : acc + (curr.status === 'completed' ? 0 : curr.originalSize), 0);
    
    // 只有当有文件完成时才显示节省
    const completedFiles = state.files.filter(f => f.status === 'completed');
    if (completedFiles.length > 0) {
        const savedBytes = state.files.reduce((acc, curr) => {
            if (curr.status === 'completed') {
                return acc + (curr.originalSize - curr.compressedSize);
            }
            return acc;
        }, 0);
        elements.summaryBar.style.display = 'block';
        elements.totalSaved.textContent = formatSize(savedBytes);
    } else {
        elements.summaryBar.style.display = 'none';
    }
}

async function startProcessing() {
    state.readyToDownload = false;
    const loaded = await loadFFmpegIfNeeded();
    if (!loaded) return;
    
    state.isProcessing = true;
    renderFileList(); // 更新按钮状态

    // 获取当前配置
    const config = {
        bitrate: elements.bitrateRange.value, // kbps
        codec: elements.codecSelect.value,
        resolution: elements.resolutionSelect.value,
        fps: elements.fpsSelect.value
    };

    // 逐个处理 pending 状态的文件
    let processingIndex = 0;
    for (let i = 0; i < state.files.length; i++) {
        if (state.files[i].status === 'pending') {
            processingIndex += 1;
            setStartButtonState(`视频${processingIndex}压缩中`, true);
            await compressVideo(state.files[i], config);
        }
    }

    state.isProcessing = false;
    renderFileList();
    updateSummary();

    const hasCompleted = state.files.some(f => f.status === 'completed');
    state.readyToDownload = hasCompleted;
    if (hasCompleted) {
        setStartButtonState('批量下载', state.files.length === 0);
    } else {
        setStartButtonState('压缩完成', true);
    }
}

async function compressVideo(fileItem, config) {
    fileItem.status = 'processing';
    fileItem.progress = 0;
    renderFileList();

    const { name } = fileItem.file;
    // 获取文件后缀，默认为 mp4
    const ext = name.slice((name.lastIndexOf(".") - 1 >>> 0) + 2) || 'mp4';
    
    // 使用简单的 ASCII 文件名，避免中文路径导致 FFmpeg 写入/读取失败
    const inputName = `input_${fileItem.id}.${ext}`;
    const outputName = `output_${fileItem.id}.mp4`;

    try {
        // 1. 写入文件到虚拟文件系统
        ffmpeg.FS('writeFile', inputName, await fetchFile(fileItem.file));

        // 2. 构建命令
        const args = ['-i', inputName];
        
        // 比特率
        args.push('-b:v', `${config.bitrate}k`);
        
        // 编码器
        if (config.codec === 'libx264') {
             args.push('-c:v', 'libx264');
        } else if (config.codec === 'libx265') {
             // 0.9.8/0.8.5 单线程版通常不支持 libx265，强制降级回 H.264
             console.warn("当前环境不支持 H.265，自动降级为 H.264");
             args.push('-c:v', 'libx264'); 
             // args.push('-tag:v', 'hvc1'); // H.265 不再使用
        }

        // 分辨率
        if (config.resolution !== '-1:-1') {
            args.push('-vf', `scale=${config.resolution}`);
        }

        // 帧率
        if (config.fps !== '0') {
            args.push('-r', config.fps);
        }

        // 预设速度
        args.push('-preset', 'ultrafast');

        // 输出文件
        args.push(outputName);

        // 监听进度
        ffmpeg.setProgress(({ ratio }) => {
            if (ratio >= 0 && ratio <= 1) {
                fileItem.progress = ratio;
                if (Math.random() > 0.8) renderFileList(); 
            }
        });

        // 3. 执行命令
        console.log('Running FFmpeg:', args.join(' '));
        await ffmpeg.run(...args);

        // 4. 读取结果
        // 检查文件是否存在，防止报错
        try {
            const data = ffmpeg.FS('readFile', outputName);
            // 5. 创建 Blob
            const blob = new Blob([data.buffer], { type: 'video/mp4' });
            fileItem.resultBlobUrl = URL.createObjectURL(blob);
            fileItem.resultBlob = blob;
            fileItem.compressedSize = blob.size;
            fileItem.status = 'completed';
        } catch (readError) {
            console.error("无法读取输出文件，可能是转码失败:", readError);
            throw new Error("转码未生成输出文件");
        }

        // 清理虚拟文件
        try {
            ffmpeg.FS('unlink', inputName);
            ffmpeg.FS('unlink', outputName);
        } catch (e) { /* 忽略清理错误 */ }

    } catch (err) {
        console.error('Compression failed:', err);
        fileItem.status = 'error';
        fileItem.errorMessage = getFriendlyErrorMessage(err, config, fileItem);
    }

    renderFileList();
    updateSummary();
}

// --- 预览功能 ---

function showPreview(id) {
    const item = state.files.find(f => f.id === id);
    if (!item || !item.resultBlobUrl) return;

    const originalUrl = URL.createObjectURL(item.file);
    elements.videoOriginals.forEach((video) => {
        if (!video) return;
        video.src = originalUrl;
    });
    elements.videoCompresseds.forEach((video) => {
        if (!video) return;
        video.src = item.resultBlobUrl;
    });

    const originalText = formatSize(item.originalSize);
    const compressedText = `${formatSize(item.compressedSize)} (-${Math.round((1 - item.compressedSize / item.originalSize) * 100)}%)`;
    elements.metaOriginals.forEach((meta) => {
        if (!meta) return;
        meta.textContent = originalText;
    });
    elements.metaCompresseds.forEach((meta) => {
        if (!meta) return;
        meta.textContent = compressedText;
    });

    elements.saveSingleBtn.href = item.resultBlobUrl;
    elements.saveSingleBtn.download = `compressed_${item.file.name}`;
    elements.saveSingleBtn.style.display = 'inline-block';

    elements.modal.style.display = 'block';
    applyPreviewResolution();
}

function toggleSyncPlay() {
    const master = elements.videoOriginals.find(video => video);
    if (!master) return;
    const shouldPlay = master.paused;
    elements.videoOriginals.forEach((video) => {
        if (!video) return;
        if (shouldPlay) video.play();
        else video.pause();
    });
    elements.videoCompresseds.forEach((video) => {
        if (!video) return;
        if (shouldPlay) video.play();
        else video.pause();
    });
}

function applyPreviewResolution() {
    elements.previewDeviceSelects.forEach((select) => {
        const column = select.closest('.preview-column');
        const container = column ? column.querySelector('.video-compare-container') : null;
        applyPreviewResolutionFor(container, select);
    });
}

function applyPreviewResolutionFor(container, select) {
    if (!container || !select) return;
    const value = select.value;
    if (!value || value === 'auto') {
        container.dataset.preview = 'off';
        container.style.removeProperty('--preview-width');
        container.style.removeProperty('--preview-height');
        return;
    }

    const [w, h] = value.split('x').map(v => parseInt(v, 10));
    if (!w || !h) return;

    const previewWidth = 240;
    const previewHeight = Math.round(h * (previewWidth / w));
    container.dataset.preview = 'on';
    container.style.setProperty('--preview-width', `${previewWidth}px`);
    container.style.setProperty('--preview-height', `${previewHeight}px`);
}

// 同步进度
elements.previewContainers.forEach((container) => {
    const original = container.querySelector('.video-original');
    const compressed = container.querySelector('.video-compressed');
    if (!original || !compressed) return;
    original.addEventListener('seeked', () => {
        if (Math.abs(original.currentTime - compressed.currentTime) > 0.5) {
            compressed.currentTime = original.currentTime;
        }
    });
});

// --- 批量下载 ---
async function downloadAllAsZip() {
    const completed = state.files.filter(f => f.status === 'completed' && f.resultBlob);
    if (completed.length === 0) {
        alert('暂无可下载的压缩文件');
        return;
    }

    const zip = new JSZip();
    completed.forEach((item, index) => {
        const originalName = item.file.name || `video_${index + 1}.mp4`;
        const safeName = `compressed_${originalName.replace(/[\/\\?%*:|"<>]/g, '_')}`;
        zip.file(safeName, item.resultBlob);
    });

    setStartButtonState('打包中...', true);
    const zipBlob = await zip.generateAsync({ type: 'blob' });
    const url = URL.createObjectURL(zipBlob);

    const link = document.createElement('a');
    link.href = url;
    link.download = 'compressed_videos.zip';
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);

    setStartButtonState('批量下载', false);
}









