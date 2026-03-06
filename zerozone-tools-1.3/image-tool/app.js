(() => {
  const fileInput = document.getElementById('fileInput');
  const dropzone = document.getElementById('dropzone');
  const fileInfo = document.getElementById('fileInfo');
  
  const fileListContainer = document.getElementById('fileListContainer');
  const fileListEl = document.getElementById('fileList');
  const listCountEl = document.getElementById('listCount');
  const btnClear = document.getElementById('btnClear');

  const btnProcess = document.getElementById('btnProcess');
  const btnDownloadAll = document.getElementById('btnDownloadAll');
  
  const optCrop = document.getElementById('optCrop');
  const cropMode = document.getElementById('cropMode');
  const btnResetCrop = document.getElementById('btnResetCrop');
  const cropAlign = document.getElementById('cropAlign');
  const optCompress = document.getElementById('optCompress');
  const targetKbInput = document.getElementById('targetKb');
  const maxSideInput = document.getElementById('maxSide');
  const formatSelect = document.getElementById('format');
  
  const previewPanel = document.getElementById('previewPanel');
  const previewNameEl = document.getElementById('previewName');
  const canvasSrc = document.getElementById('canvasSrc');
  const canvasOut = document.getElementById('canvasOut');
  const metaOut = document.getElementById('metaOut');
  const previewPrev = document.getElementById('previewPrev');
  const previewNext = document.getElementById('previewNext');

  /** 
   * @typedef {Object} Rect
   * @property {number} x
   * @property {number} y
   * @property {number} w
   * @property {number} h
   */

  /** 
   * @typedef {Object} FileItem
   * @property {string} id
   * @property {File} file
   * @property {HTMLImageElement|null} img
   * @property {string} status
   * @property {Blob|null} resultBlob
   * @property {string|null} resultUrl
   * @property {Object|null} meta
   * @property {string|null} cropMode - null means follow global default
   * @property {Rect|null} cropRect
   */

  /** @type {FileItem[]} */
  let fileQueue = [];
  let currentPreviewId = null;
  let currentPreviewScale = 1;

  // Interaction State
  let isDragging = false;
  let dragMode = null; // 'move', 'nw', 'ne', 'sw', 'se', 'n', 's', 'w', 'e'
  let dragStartPos = null; // {x, y} mouse pos
  let dragStartRect = null; // {x, y, w, h} rect at start

  const HANDLE_SIZE = 8; // Handle size in pixels

  function generateId() {
    return Math.random().toString(36).substring(2, 9);
  }

  function setProcessEnabled(enabled) {
    btnProcess.disabled = !enabled || fileQueue.length === 0;
  }

  function readFileAsImage(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const img = new Image();
        img.onload = () => resolve(img);
        img.onerror = reject;
        img.src = reader.result;
      };
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  }

  function drawOnCanvas(canvas, source, sx = 0, sy = 0, sw = source.width, sh = source.height, dw = sw, dh = sh) {
    canvas.width = Math.max(1, Math.floor(dw));
    canvas.height = Math.max(1, Math.floor(dh));
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(source, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);
  }

  function getCropRectFromRatio(img, ratioW, ratioH, align) {
    const w = img.width;
    const h = img.height;
    const aspect = ratioW / ratioH;
    let cw = w;
    let ch = Math.round(w / aspect);
    if (ch > h) {
      ch = h;
      cw = Math.round(h * aspect);
    }
    let cx = 0;
    let cy = 0;
    if (w > cw) {
      if (align === 'top') cx = 0;
      else if (align === 'bottom') cx = w - cw;
      else cx = Math.floor((w - cw) / 2);
    }
    if (h > ch) {
      if (align === 'top') cy = 0;
      else if (align === 'bottom') cy = h - ch;
      else cy = Math.floor((h - ch) / 2);
    }
    return { x: cx, y: cy, w: cw, h: ch };
  }

  function resizeToMaxSide(source, maxSide) {
    const w = source.width;
    const h = source.height;
    const longSide = Math.max(w, h);
    if (longSide <= maxSide) return source;
    const scale = maxSide / longSide;
    const dw = Math.round(w * scale);
    const dh = Math.round(h * scale);
    const canvas = document.createElement('canvas');
    drawOnCanvas(canvas, source, 0, 0, w, h, dw, dh);
    return canvas;
  }

  function canvasToBlob(canvas, mime, quality) {
    return new Promise((resolve) => {
      canvas.toBlob((blob) => resolve(blob), mime, quality);
    });
  }

  async function encodeToTargetSize(canvas, mime, targetKB, qualityMin = 0.01, qualityMax = 0.95, maxIters = 10) {
    if (mime === 'image/png') {
      const blob = await canvasToBlob(canvas, mime);
      return { blob, quality: undefined };
    }
    let low = qualityMin;
    let high = qualityMax;
    let best = { blob: null, quality: high };
    const targetBytes = targetKB * 1024;
    
    const startBlob = await canvasToBlob(canvas, mime, high);
    if (startBlob.size <= targetBytes) return { blob: startBlob, quality: high };
    best = { blob: startBlob, quality: high };

    for (let i = 0; i < maxIters; i++) {
      const q = (low + high) / 2;
      const blob = await canvasToBlob(canvas, mime, q);
      if (!blob) break;
      if (blob.size <= targetBytes) {
        best = { blob, quality: q };
        low = q;
      } else {
        high = q;
      }
      if (high - low < 0.01) break;
    }
    
    if (best.blob && best.blob.size > targetBytes) {
        const minBlob = await canvasToBlob(canvas, mime, qualityMin);
        if (minBlob.size < best.blob.size) return { blob: minBlob, quality: qualityMin };
    }
    return best;
  }

  async function processSingleItem(item, options) {
    try {
      if (!item.img) item.img = await readFileAsImage(item.file);
      
      let working = item.img;
      
      if (options.doCrop) {
        const effectiveMode = item.cropMode || options.cropMode;
        let rect = item.cropRect;

        // Ensure we have a valid rect for non-free modes if not already set or updated
        if (effectiveMode !== 'free') {
           // For fixed modes, we re-calculate rect based on alignment if not manually adjusted (but user manual adjust saves to item.cropRect)
           // If item.cropRect exists, use it (it might be manually moved).
           // BUT, if we switch modes, we might need to reset.
           // Simplified: If rect exists, use it. If not, calc default.
           if (!rect) {
             const [rw, rh] = effectiveMode.split(':').map(Number);
             rect = getCropRectFromRatio(working, rw, rh, options.align);
           }
        } else {
           // Free mode: Default to 9:16 if no rect
           if (!rect) {
             rect = getCropRectFromRatio(working, 9, 16, 'center');
           }
        }
        
        const canvas = document.createElement('canvas');
        drawOnCanvas(canvas, working, rect.x, rect.y, rect.w, rect.h, rect.w, rect.h);
        working = canvas;
      }
      
      if (options.doCompress) {
        working = resizeToMaxSide(working, options.maxSide);
      }

      const canvas = document.createElement('canvas');
      drawOnCanvas(canvas, working, 0, 0, working.width, working.height);

      let outBlob, quality;
      if (options.doCompress) {
        const res = await encodeToTargetSize(canvas, options.mime, options.targetKB);
        outBlob = res.blob;
        quality = res.quality;
      } else {
        outBlob = await canvasToBlob(canvas, options.mime);
      }

      if (outBlob) {
        item.resultBlob = outBlob;
        item.resultUrl = URL.createObjectURL(outBlob);
        item.meta = {
          width: working.width,
          height: working.height,
          sizeKB: (outBlob.size / 1024).toFixed(1),
          quality: quality ? quality.toFixed(2) : null
        };
        item.status = 'done';
      } else {
        item.status = 'error';
      }
    } catch (e) {
      console.error(e);
      item.status = 'error';
    }
    updateListRow(item.id);
  }

  function updateListRow(id) {
    const item = fileQueue.find(x => x.id === id);
    if (!item) return;
    const row = document.querySelector(`.file-item[data-id="${id}"]`);
    if (!row) return;

    const statusEl = row.querySelector('.status-badge');
    const actionEl = row.querySelector('.file-action');
    const sizeEl = row.querySelector('.file-size');

    if (item.status === 'done') {
      statusEl.className = 'status-badge done';
      statusEl.textContent = '完成';
      const origSize = (item.file.size / 1024).toFixed(0);
      const newSize = item.meta ? item.meta.sizeKB : '?';
      sizeEl.innerHTML = `${origSize}KB <span style="color:#16a34a">→ ${Math.round(newSize)}KB</span>`;
      
      const ext = formatSelect.value.includes('webp') ? 'webp' : 'png';
      actionEl.innerHTML = `
        <a href="${item.resultUrl}" download="processed_${item.file.name.split('.')[0]}.${ext}" class="btn-sm" title="下载结果">下载</a>
      `;
    } else if (item.status === 'processing') {
      statusEl.className = 'status-badge processing';
      statusEl.textContent = '处理中...';
      actionEl.innerHTML = '';
    } else if (item.status === 'error') {
      statusEl.className = 'status-badge';
      statusEl.style.background = '#fee2e2';
      statusEl.style.color = '#991b1b';
      statusEl.textContent = '失败';
      actionEl.innerHTML = '';
    } else {
      statusEl.className = 'status-badge';
      statusEl.textContent = '待处理';
      actionEl.innerHTML = '';
    }

    if (currentPreviewId === id) {
      updatePreviewPanel(item);
    }
  }

  function renderFileList() {
    fileListEl.innerHTML = '';
    if (fileQueue.length === 0) {
      fileListContainer.style.display = 'none';
      btnDownloadAll.style.display = 'none';
      previewPanel.style.display = 'none';
      return;
    }
    
    fileListContainer.style.display = 'block';
    listCountEl.textContent = `(${fileQueue.length}张)`;

    fileQueue.forEach(item => {
      const div = document.createElement('div');
      div.className = `file-item ${currentPreviewId === item.id ? 'active' : ''}`;
      div.dataset.id = item.id;
      div.innerHTML = `
        <div class="file-thumb"></div>
        <div class="file-name" title="${item.file.name}">${item.file.name}</div>
        <div class="file-size">${(item.file.size / 1024).toFixed(0)}KB</div>
        <div class="file-status"><span class="status-badge">待处理</span></div>
        <div class="file-action"></div>
      `;
      div.addEventListener('click', (e) => {
        if (e.target.tagName === 'A') return;
        selectPreviewItem(item.id);
      });
      fileListEl.appendChild(div);
      
      readFileAsImage(item.file).then(img => {
        item.img = img;
        const thumb = div.querySelector('.file-thumb');
        thumb.style.backgroundImage = `url(${img.src})`;
        thumb.style.backgroundSize = 'cover';
      });
      
      updateListRow(item.id);
    });
  }

  function getPreviewIndex() {
    if (!currentPreviewId || fileQueue.length === 0) return -1;
    return fileQueue.findIndex(x => x.id === currentPreviewId);
  }

  function updatePreviewNav() {
    if (!previewPrev || !previewNext) return;
    const total = fileQueue.length;
    const idx = getPreviewIndex();
    if (total === 0 || idx === -1) {
      previewPrev.disabled = true;
      previewNext.disabled = true;
      return;
    }
    previewPrev.disabled = idx <= 0;
    previewNext.disabled = idx >= total - 1;
  }

  function selectPreviewByOffset(offset) {
    const idx = getPreviewIndex();
    if (idx === -1) return;
    const nextIndex = idx + offset;
    if (nextIndex < 0 || nextIndex >= fileQueue.length) return;
    selectPreviewItem(fileQueue[nextIndex].id);
  }

  function selectPreviewItem(id) {
    currentPreviewId = id;
    document.querySelectorAll('.file-item').forEach(el => el.classList.remove('active'));
    const row = document.querySelector(`.file-item[data-id="${id}"]`);
    if (row) row.classList.add('active');

    const item = fileQueue.find(x => x.id === id);
    if (item) {
      if (item.cropMode) {
        cropMode.value = item.cropMode;
      }
      updatePreviewPanel(item);
    }
  }

  function getEffectiveCropRect(item) {
    if (!item.img) return null;
    const effectiveMode = item.cropMode || cropMode.value;
    
    if (item.cropRect) return item.cropRect;

    // Calculate default rect if none exists
    if (effectiveMode === 'free') {
       // Free mode defaults to 9:16 center
       return getCropRectFromRatio(item.img, 9, 16, 'center');
    } else {
       const [rw, rh] = effectiveMode.split(':').map(Number);
       return getCropRectFromRatio(item.img, rw, rh, cropAlign.value);
    }
  }

  function drawSelectionOverlay(canvas, item) {
    const ctx = canvas.getContext('2d');
    const effectiveMode = item.cropMode || cropMode.value;
    
    const rect = getEffectiveCropRect(item);
    if (!rect) return;
    
    const s = currentPreviewScale;
    ctx.save();
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 2;
    ctx.setLineDash([6, 4]);
    ctx.strokeRect(rect.x * s, rect.y * s, rect.w * s, rect.h * s);
    ctx.setLineDash([]);
    ctx.fillStyle = 'rgba(0,0,0,0.3)';
    
    // Dim outside area
    ctx.beginPath();
    ctx.rect(0, 0, canvas.width, canvas.height);
    ctx.rect(rect.x * s, rect.y * s, rect.w * s, rect.h * s);
    ctx.fill('evenodd');

    // Draw handles if free mode
    if (effectiveMode === 'free') {
       ctx.fillStyle = '#fff';
       ctx.strokeStyle = '#0ea5e9';
       ctx.lineWidth = 1;
       const hSize = 8;
       const positions = [
         [rect.x, rect.y], [rect.x + rect.w/2, rect.y], [rect.x + rect.w, rect.y],
         [rect.x, rect.y + rect.h/2], [rect.x + rect.w, rect.y + rect.h/2],
         [rect.x, rect.y + rect.h], [rect.x + rect.w/2, rect.y + rect.h], [rect.x + rect.w, rect.y + rect.h]
       ];
       positions.forEach(([hx, hy]) => {
         ctx.fillRect(hx * s - hSize/2, hy * s - hSize/2, hSize, hSize);
         ctx.strokeRect(hx * s - hSize/2, hy * s - hSize/2, hSize, hSize);
       });
    }

    ctx.restore();
  }

  function applyCropUIState(item) {
    const effectiveMode = item.cropMode || cropMode.value;
    cropAlign.disabled = effectiveMode === 'free' || !optCrop.checked;
    btnResetCrop.style.display = effectiveMode === 'free' ? 'inline-block' : 'none';
    const hint = document.getElementById('cropHint');
    hint.textContent = effectiveMode === 'free' 
      ? '自由裁剪：拖动角调整大小，拖动中间移动。吸附 1:1 / 3:4' 
      : '固定比例：拖动虚线框可调整裁剪位置';
    hint.style.display = optCrop.checked ? 'block' : 'none';
  }

  function renderSourceWithOverlay(item) {
    const info = renderPreviewCanvas(canvasSrc, item.img);
    currentPreviewScale = info.scale;
    if (optCrop.checked) {
       drawSelectionOverlay(canvasSrc, item);
    }
  }

  function updatePreviewPanel(item) {
    if (!item.img) return;
    previewPanel.style.display = 'grid';
    previewNameEl.textContent = `- ${item.file.name}`;
    applyCropUIState(item);
    renderSourceWithOverlay(item);

    if (item.resultBlob && item.meta) {
      const resultImg = new Image();
      resultImg.onload = () => {
         renderPreviewCanvas(canvasOut, resultImg);
      };
      resultImg.src = item.resultUrl;
      const qText = item.meta.quality ? ` | Q:${item.meta.quality}` : '';
      metaOut.textContent = `${item.meta.width}×${item.meta.height} | ${item.meta.sizeKB}KB${qText}`;
    } else {
      const ctx = canvasOut.getContext('2d');
      ctx.clearRect(0, 0, canvasOut.width, canvasOut.height);
      metaOut.textContent = '等待处理...';
    }
  }

  function renderPreviewCanvas(canvas, img) {
    const maxPreviewSide = 560;
    let dw = img.width;
    let dh = img.height;
    const scale = Math.max(dw, dh) > maxPreviewSide ? maxPreviewSide / Math.max(dw, dh) : 1;
    dw = Math.round(dw * scale);
    dh = Math.round(dh * scale);
    drawOnCanvas(canvas, img, 0, 0, img.width, img.height, dw, dh);
    return { scale, dw, dh };
  }

  function handleFiles(fileList) {
    if (!fileList || fileList.length === 0) return;
    const newItems = Array.from(fileList).map(f => ({
      id: generateId(),
      file: f,
      img: null,
      status: 'pending',
      resultBlob: null,
      resultUrl: null,
      meta: null,
      cropMode: null, 
      cropRect: null,
    }));
    fileQueue = [...fileQueue, ...newItems];
    renderFileList();
    setProcessEnabled(true);
    if (!currentPreviewId && newItems.length > 0) {
      selectPreviewItem(newItems[0].id);
    }
    fileInfo.textContent = `已添加 ${newItems.length} 张图片，共 ${fileQueue.length} 张`;
  }

  function getCurrentItem() {
    return fileQueue.find(x => x.id === currentPreviewId) || null;
  }

  // --- Interaction Logic ---

  function getMousePos(e) {
    const r = canvasSrc.getBoundingClientRect();
    return {
      x: (e.clientX - r.left) / currentPreviewScale,
      y: (e.clientY - r.top) / currentPreviewScale
    };
  }

  function isPointInRect(p, r, margin = 0) {
    return p.x >= r.x - margin && p.x <= r.x + r.w + margin &&
           p.y >= r.y - margin && p.y <= r.y + r.h + margin;
  }

  function getHandle(p, r) {
    const s = 10 / currentPreviewScale; // handle hit size
    if (Math.abs(p.x - r.x) < s && Math.abs(p.y - r.y) < s) return 'nw';
    if (Math.abs(p.x - (r.x + r.w)) < s && Math.abs(p.y - r.y) < s) return 'ne';
    if (Math.abs(p.x - r.x) < s && Math.abs(p.y - (r.y + r.h)) < s) return 'sw';
    if (Math.abs(p.x - (r.x + r.w)) < s && Math.abs(p.y - (r.y + r.h)) < s) return 'se';
    
    if (Math.abs(p.x - (r.x + r.w/2)) < s && Math.abs(p.y - r.y) < s) return 'n';
    if (Math.abs(p.x - (r.x + r.w/2)) < s && Math.abs(p.y - (r.y + r.h)) < s) return 's';
    if (Math.abs(p.x - r.x) < s && Math.abs(p.y - (r.y + r.h/2)) < s) return 'w';
    if (Math.abs(p.x - (r.x + r.w)) < s && Math.abs(p.y - (r.y + r.h/2)) < s) return 'e';

    return null;
  }

  canvasSrc.addEventListener('mousedown', (e) => {
    const item = getCurrentItem();
    if (!item || !item.img || !optCrop.checked) return;
    
    const rect = getEffectiveCropRect(item);
    if (!rect) return;

    // Save effective rect to item if not present (so we can edit it)
    item.cropRect = { ...rect };
    
    const p = getMousePos(e);
    const mode = item.cropMode || cropMode.value;

    if (mode === 'free') {
       const handle = getHandle(p, rect);
       if (handle) {
         isDragging = true;
         dragMode = handle;
         dragStartPos = p;
         dragStartRect = { ...rect };
         return;
       }
    }

    if (isPointInRect(p, rect)) {
       isDragging = true;
       dragMode = 'move';
       dragStartPos = p;
       dragStartRect = { ...rect };
       canvasSrc.style.cursor = 'move';
    }
  });

  function snapToRatio(w, h) {
    const ratio = w / h;
    // Snap to 1:1
    if (Math.abs(ratio - 1) < 0.05) return { w: w, h: w, ratio: '1:1' };
    // Snap to 3:4
    if (Math.abs(ratio - 3/4) < 0.05) return { w: w, h: w / (3/4), ratio: '3:4' };
    return null;
  }

  canvasSrc.addEventListener('mousemove', (e) => {
    const item = getCurrentItem();
    if (!item || !item.img || !optCrop.checked) {
       canvasSrc.style.cursor = 'default';
       return;
    }

    const p = getMousePos(e);
    const mode = item.cropMode || cropMode.value;
    const rect = getEffectiveCropRect(item);

    if (!isDragging) {
       if (mode === 'free') {
          const handle = getHandle(p, rect);
          if (handle) {
            canvasSrc.style.cursor = handle + '-resize';
            return;
          }
       }
       if (isPointInRect(p, rect)) {
          canvasSrc.style.cursor = 'move';
       } else {
          canvasSrc.style.cursor = 'default';
       }
       return;
    }

    if (!dragStartRect) return;
    const dx = p.x - dragStartPos.x;
    const dy = p.y - dragStartPos.y;
    
    let newRect = { ...dragStartRect };

    if (dragMode === 'move') {
       newRect.x += dx;
       newRect.y += dy;
       // Constrain
       newRect.x = Math.max(0, Math.min(newRect.x, item.img.width - newRect.w));
       newRect.y = Math.max(0, Math.min(newRect.y, item.img.height - newRect.h));
    } else if (mode === 'free') {
       if (dragMode.includes('e')) newRect.w = Math.max(10, dragStartRect.w + dx);
       if (dragMode.includes('s')) newRect.h = Math.max(10, dragStartRect.h + dy);
       if (dragMode.includes('w')) {
          const right = dragStartRect.x + dragStartRect.w;
          newRect.x = Math.min(right - 10, dragStartRect.x + dx);
          newRect.w = right - newRect.x;
       }
       if (dragMode.includes('n')) {
          const bottom = dragStartRect.y + dragStartRect.h;
          newRect.y = Math.min(bottom - 10, dragStartRect.y + dy);
          newRect.h = bottom - newRect.y;
       }
       
       // Constrain to image bounds
       // (Simplified constraint for free resize, might need more robust logic)
    }

    item.cropRect = newRect;
    
    // Snap check during resize
    if (mode === 'free' && dragMode !== 'move') {
       const snap = snapToRatio(newRect.w, newRect.h);
       if (snap) {
          // Visual feedback can be added here
       }
    }

    renderSourceWithOverlay(item);
  });

  canvasSrc.addEventListener('mouseup', () => {
    if (isDragging) {
      const item = getCurrentItem();
      const mode = item.cropMode || cropMode.value;
      if (item && mode === 'free' && dragMode !== 'move') {
         // Apply snap on release
         const snap = snapToRatio(item.cropRect.w, item.cropRect.h);
         if (snap) {
            item.cropRect.w = snap.w;
            item.cropRect.h = snap.h;
            // Update mode to snapped ratio
            item.cropMode = snap.ratio;
            cropMode.value = snap.ratio;
            applyCropUIState(item);
            
            // Re-center or adjust rect because mode switch might re-calculate default
            // But we want to KEEP current rect but enforce ratio.
            // Since we switched to fixed mode, subsequent renders might reset rect.
            // We should keep item.cropRect set to preserve this specific crop.
         } else {
             // Stay in free mode, explicitly set for this item
             if (!item.cropMode) item.cropMode = 'free';
         }
      } else if (item && dragMode === 'move') {
         // If moved in fixed mode, we must set item.cropRect to persist this position
         // This effectively makes it a "manual override" of that mode
         // But we keep the mode ratio.
         // Wait, if mode is fixed (e.g. 9:16) and we moved it, 
         // we just keep item.cropRect. The renderer uses item.cropRect if present.
         // And since the rect was constrained to ratio during 'move', it's fine.
      }
    }
    isDragging = false;
    dragMode = null;
    canvasSrc.style.cursor = 'default';
  });

  canvasSrc.addEventListener('mouseleave', () => {
    isDragging = false;
    dragMode = null;
  });

  fileInput.addEventListener('change', (e) => {
    handleFiles(e.target.files);
    fileInput.value = ''; 
  });

  ;['dragenter', 'dragover'].forEach((evt) => {
    dropzone.addEventListener(evt, (e) => {
      e.preventDefault();
      e.stopPropagation();
      dropzone.classList.add('dragover');
    });
  });
  ;['dragleave', 'drop'].forEach((evt) => {
    dropzone.addEventListener(evt, (e) => {
      e.preventDefault();
      e.stopPropagation();
      dropzone.classList.remove('dragover');
    });
  });
  dropzone.addEventListener('drop', (e) => {
    const files = e.dataTransfer && e.dataTransfer.files;
    handleFiles(files);
  });

  btnClear.addEventListener('click', () => {
    fileQueue = [];
    currentPreviewId = null;
    renderFileList();
    fileInfo.textContent = '未选择图片';
    setProcessEnabled(false);
  });

  previewPrev.addEventListener('click', () => selectPreviewByOffset(-1));
  previewNext.addEventListener('click', () => selectPreviewByOffset(1));

  document.addEventListener('keydown', (e) => {
    if (previewPanel.style.display === 'none') return;
    if (e.key === 'ArrowLeft') {
      selectPreviewByOffset(-1);
    } else if (e.key === 'ArrowRight') {
      selectPreviewByOffset(1);
    }
  });

  btnProcess.addEventListener('click', async () => {
    if (fileQueue.length === 0) return;
    setProcessEnabled(false);
    btnDownloadAll.style.display = 'none';

    const options = {
      doCrop: optCrop.checked,
      cropMode: cropMode.value,
      align: cropAlign.value,
      doCompress: optCompress.checked,
      targetKB: parseInt(targetKbInput.value, 10) || 100,
      maxSide: parseInt(maxSideInput.value, 10) || 1280,
      mime: formatSelect.value
    };

    for (const item of fileQueue) {
      item.status = 'processing';
      updateListRow(item.id);
      await new Promise(r => setTimeout(r, 20)); 
      await processSingleItem(item, options);
    }
    
    setProcessEnabled(true);
    
    const processedItems = fileQueue.filter(x => x.status === 'done');
    if (processedItems.length > 0) {
      btnDownloadAll.style.display = 'inline-block';
      
      if (typeof JSZip !== 'undefined') {
        btnDownloadAll.textContent = '打包下载所有结果 (.zip)';
        btnDownloadAll.onclick = async () => {
          btnDownloadAll.disabled = true;
          const originalText = btnDownloadAll.textContent;
          btnDownloadAll.textContent = '正在打包...';

          try {
            const zip = new JSZip();
            processedItems.forEach(item => {
              const ext = formatSelect.value.includes('webp') ? 'webp' : 'png';
              const filename = `processed_${item.file.name.split('.')[0]}.${ext}`;
              zip.file(filename, item.resultBlob);
            });

            const content = await zip.generateAsync({type:"blob"});
            const link = document.createElement('a');
            link.href = URL.createObjectURL(content);
            link.download = "images.zip";
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
          } catch (e) {
            console.error('Zip error:', e);
            alert('打包下载失败，请尝试逐个下载');
          } finally {
            btnDownloadAll.disabled = false;
            btnDownloadAll.textContent = originalText;
          }
        };
      } else {
        btnDownloadAll.textContent = '尝试下载所有 (浏览器可能拦截)';
        btnDownloadAll.onclick = () => {
           processedItems.forEach(item => {
             const link = document.createElement('a');
             link.href = item.resultUrl;
             const ext = formatSelect.value.includes('webp') ? 'webp' : 'png';
             link.download = `processed_${item.file.name.split('.')[0]}.${ext}`;
             document.body.appendChild(link);
             link.click();
             document.body.removeChild(link);
           });
        };
      }
    }
  });

  cropMode.addEventListener('change', () => {
    const item = getCurrentItem();
    if (!item) return;

    if (cropMode.value === 'free') {
      item.cropMode = 'free';
    } else {
      item.cropMode = null;
      item.cropRect = null; // Reset manual rect to allow recalculation
    }
    
    applyCropUIState(item);
    renderSourceWithOverlay(item);
  });

  btnResetCrop.addEventListener('click', () => {
    const item = getCurrentItem();
    if (!item) return;
    item.cropRect = null;
    renderSourceWithOverlay(item);
  });

  optCrop.addEventListener('change', () => {
    const item = getCurrentItem();
    if (item) {
      applyCropUIState(item);
      renderSourceWithOverlay(item);
    } else {
      cropAlign.disabled = !optCrop.checked;
    }
  });

})();
