const path = require('path');
const fs = require('fs');
const { spawnSync } = require('child_process');
const { getFfmpegPath, getFfprobePath, hasLocalFfmpeg } = require('../utils/ffmpegPath');
const storageLayout = require('./storageLayout');

const TRANSITION_TYPES = new Set(['fade', 'dissolve', 'slideleft', 'slideright', 'circleopen']);

function list(db, query) {
  let sql = 'FROM video_merges WHERE deleted_at IS NULL';
  const params = [];
  if (query.episode_id) {
    sql += ' AND episode_id = ?';
    params.push(query.episode_id);
  }
  if (query.drama_id) {
    sql += ' AND drama_id = ?';
    params.push(query.drama_id);
  }
  const rows = db.prepare('SELECT * ' + sql + ' ORDER BY created_at DESC').all(...params);
  return rows.map(rowToItem);
}

function rowToItem(r) {
  return {
    id: r.id,
    episode_id: r.episode_id,
    drama_id: r.drama_id,
    title: r.title,
    provider: r.provider,
    status: r.status,
    merged_url: r.merged_url,
    duration: r.duration ?? undefined,
    task_id: r.task_id,
    error_msg: r.error_msg ?? undefined,
    created_at: r.created_at,
    completed_at: r.completed_at,
  };
}

function getById(db, id) {
  const r = db.prepare('SELECT * FROM video_merges WHERE id = ? AND deleted_at IS NULL').get(Number(id));
  return r ? rowToItem(r) : null;
}

function create(db, log, req) {
  const now = new Date().toISOString();
  const taskService = require('./taskService');
  const task = taskService.createTask(db, log, 'video_merge', String(req.episode_id || ''));
  const mergeOptionsJson = (() => {
    const o = req.merge_options;
    if (o && typeof o === 'object') return JSON.stringify(o);
    return '{}';
  })();
  const info = db.prepare(
    `INSERT INTO video_merges (episode_id, drama_id, title, provider, model, status, scenes, merge_options, task_id, created_at)
     VALUES (?, ?, ?, ?, ?, 'pending', ?, ?, ?, ?)`
  ).run(
    Number(req.episode_id) || 0,
    Number(req.drama_id) || 0,
    req.title ?? null,
    req.provider || 'ffmpeg',
    req.model ?? null,
    req.scenes ? JSON.stringify(req.scenes) : '[]',
    mergeOptionsJson,
    task.id,
    now
  );
  return { merge_id: info.lastInsertRowid, task_id: task.id, ...getById(db, info.lastInsertRowid) };
}

function deleteById(db, log, id) {
  const now = new Date().toISOString();
  const result = db.prepare('UPDATE video_merges SET deleted_at = ? WHERE id = ? AND deleted_at IS NULL').run(now, Number(id));
  return result.changes > 0;
}

/** 获取 storage 根目录（绝对路径） */
function getStorageRoot() {
  const loadConfig = require('../config').loadConfig;
  const cfg = loadConfig();
  const p = cfg.storage?.local_path || './data/storage';
  return path.isAbsolute(p) ? p : path.join(process.cwd(), p);
}

/** 将 video_url 解析为本地文件路径，或下载到 temp 返回路径 */
async function resolveVideoToLocalPath(videoUrl, baseUrl, storageRoot, tempDir, index, log) {
  if (!videoUrl || typeof videoUrl !== 'string') return null;
  const u = videoUrl.trim();
  // 1) URL 以 baseUrl 开头（如 http://localhost:5679/static）-> 对应 storageRoot 下相对路径
  if (baseUrl && (u.startsWith(baseUrl) || u.startsWith(baseUrl.replace(/\/$/, '')))) {
    const base = baseUrl.replace(/\/$/, '');
    const rel = u.startsWith(base + '/') ? u.slice(base.length + 1) : u.slice(base.length).replace(/^\//, '');
    if (rel && !rel.startsWith('http')) {
      const localPath = path.join(storageRoot, rel.replace(/\//g, path.sep));
      if (fs.existsSync(localPath)) {
        log.info('Video merge: using local static file', { index, path: localPath });
        return localPath;
      }
    }
  }
  // 2) 已是本地绝对路径且存在
  if (path.isAbsolute(u) && fs.existsSync(u)) {
    log.info('Video merge: using absolute path', { index, path: u });
    return u;
  }
  // 3) 相对路径（相对 storageRoot）
  if (!u.startsWith('http://') && !u.startsWith('https://')) {
    const localPath = path.join(storageRoot, u.replace(/^\//, '').replace(/\//g, path.sep));
    if (fs.existsSync(localPath)) {
      log.info('Video merge: using relative path', { index, path: localPath });
      return localPath;
    }
  }
  // 4) 远程 URL：下载到 temp
  const ext = u.includes('.mp4') ? '.mp4' : u.includes('.webm') ? '.webm' : '.mp4';
  const destPath = path.join(tempDir, `dl_${Date.now()}_${index}${ext}`);
  try {
    const res = await fetch(u, { method: 'GET' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const buf = Buffer.from(await res.arrayBuffer());
    fs.writeFileSync(destPath, buf);
    log.info('Video merge: downloaded to temp', { index, dest: destPath });
    return destPath;
  } catch (e) {
    log.warn('Video merge: download failed', { index, url: u, error: e.message });
    return null;
  }
}

/** 使用 ffmpeg concat 合并多个视频文件 */
function runFfmpegConcat(localPaths, outputPath, log) {
  const ffmpegBin = getFfmpegPath();
  const listFile = path.join(path.dirname(outputPath), `concat_list_${Date.now()}.txt`);
  try {
    const lines = localPaths.map((p) => {
      const normalized = p.replace(/\\/g, '/');
      return `file '${normalized.replace(/'/g, "'\\''")}'`;
    });
    fs.writeFileSync(listFile, lines.join('\n'), 'utf8');
    const { spawnSync } = require('child_process');
    const args = [
      '-f', 'concat',
      '-safe', '0',
      '-i', listFile,
      '-c', 'copy',
      '-y',
      outputPath,
    ];
    const result = spawnSync(ffmpegBin, args, { encoding: 'utf8', maxBuffer: 4 * 1024 * 1024 });
    if (result.error) {
      log.warn('Video merge: ffmpeg spawn error', { error: result.error.message });
      return false;
    }
    if (result.status !== 0) {
      log.warn('Video merge: ffmpeg failed', { stderr: result.stderr?.slice(-500) });
      return false;
    }
    return true;
  } finally {
    try { if (fs.existsSync(listFile)) fs.unlinkSync(listFile); } catch (_) {}
  }
}

function probeMediaInfo(filePath, log) {
  const ffprobeBin = getFfprobePath();
  const args = [
    '-v', 'error',
    '-show_entries', 'stream=index,codec_type,width,height,r_frame_rate,duration',
    '-show_entries', 'format=duration',
    '-of', 'json',
    filePath,
  ];
  const result = spawnSync(ffprobeBin, args, { encoding: 'utf8', maxBuffer: 2 * 1024 * 1024 });
  if (result.error || result.status !== 0) {
    log.warn('Video merge: ffprobe failed', { file: filePath, error: result.error?.message, stderr: result.stderr?.slice(-500) });
    return null;
  }
  try {
    const data = JSON.parse(result.stdout || '{}');
    const streams = Array.isArray(data.streams) ? data.streams : [];
    const video = streams.find((item) => item.codec_type === 'video') || {};
    const hasAudio = streams.some((item) => item.codec_type === 'audio');
    const duration = Number.parseFloat(data.format?.duration || video.duration || 0) || 0;
    const [num, den] = String(video.r_frame_rate || '25/1').split('/').map((item) => Number(item) || 0);
    const fps = den > 0 ? num / den : 25;
    return {
      width: Math.max(16, Number(video.width) || 1280),
      height: Math.max(16, Number(video.height) || 720),
      fps: Math.min(60, Math.max(12, Math.round(fps || 25))),
      duration,
      hasAudio,
    };
  } catch (err) {
    log.warn('Video merge: parse ffprobe output failed', { file: filePath, error: err.message });
    return null;
  }
}

function normalizeTransitionOptions(localPaths, mergeOpts, log) {
  if (!mergeOpts?.enable_transition || localPaths.length < 2) return null;
  const infos = localPaths.map((filePath) => probeMediaInfo(filePath, log));
  if (infos.some((item) => !item || !(item.duration > 0))) return null;
  const type = TRANSITION_TYPES.has(String(mergeOpts.transition_type || '').toLowerCase())
    ? String(mergeOpts.transition_type).toLowerCase()
    : 'fade';
  const requestedDuration = Number(mergeOpts.transition_duration) || 0.3;
  const boundedDuration = Math.min(0.8, Math.max(0.15, requestedDuration));
  let safeDuration = boundedDuration;
  for (let i = 0; i < infos.length - 1; i++) {
    const pairMax = Math.min(infos[i].duration, infos[i + 1].duration) - 0.05;
    safeDuration = Math.min(safeDuration, pairMax);
  }
  if (!(safeDuration >= 0.12)) {
    log.warn('Video merge: transition skipped (clips too short)', {
      requested: requestedDuration,
      clip_durations: infos.map((item) => item.duration),
    });
    return null;
  }
  return {
    type,
    duration: Number(safeDuration.toFixed(3)),
    width: infos[0].width,
    height: infos[0].height,
    fps: infos[0].fps,
    infos,
  };
}

function runFfmpegTransitionMerge(localPaths, outputPath, log, mergeOpts) {
  const plan = normalizeTransitionOptions(localPaths, mergeOpts, log);
  if (!plan) return false;
  const ffmpegBin = getFfmpegPath();
  const filterParts = [];

  plan.infos.forEach((info, index) => {
    filterParts.push(
      `[${index}:v]fps=${plan.fps},scale=${plan.width}:${plan.height}:force_original_aspect_ratio=decrease,` +
      `pad=${plan.width}:${plan.height}:(ow-iw)/2:(oh-ih)/2:color=black,format=yuv420p,setsar=1,settb=AVTB[v${index}]`
    );
    if (info.hasAudio) {
      filterParts.push(
        `[${index}:a]aformat=sample_rates=44100:channel_layouts=stereo,atrim=duration=${info.duration.toFixed(3)},asetpts=PTS-STARTPTS[a${index}]`
      );
    } else {
      filterParts.push(
        `anullsrc=r=44100:cl=stereo,atrim=duration=${info.duration.toFixed(3)},asetpts=N/SR/TB[a${index}]`
      );
    }
  });

  let currentVideoLabel = 'v0';
  let currentAudioLabel = 'a0';
  let accumulatedDuration = plan.infos[0].duration;
  for (let index = 1; index < plan.infos.length; index++) {
    const nextVideoLabel = index === plan.infos.length - 1 ? 'vout' : `vx${index}`;
    const nextAudioLabel = index === plan.infos.length - 1 ? 'aout' : `ax${index}`;
    const offset = Math.max(0, accumulatedDuration - plan.duration);
    filterParts.push(
      `[${currentVideoLabel}][v${index}]xfade=transition=${plan.type}:duration=${plan.duration.toFixed(3)}:offset=${offset.toFixed(3)}[${nextVideoLabel}]`
    );
    filterParts.push(
      `[${currentAudioLabel}][a${index}]acrossfade=d=${plan.duration.toFixed(3)}:c1=tri:c2=tri[${nextAudioLabel}]`
    );
    accumulatedDuration = accumulatedDuration + plan.infos[index].duration - plan.duration;
    currentVideoLabel = nextVideoLabel;
    currentAudioLabel = nextAudioLabel;
  }

  const args = [];
  localPaths.forEach((filePath) => {
    args.push('-i', filePath);
  });
  args.push(
    '-filter_complex', filterParts.join(';'),
    '-map', '[vout]',
    '-map', '[aout]',
    '-c:v', 'libx264',
    '-preset', 'veryfast',
    '-crf', '20',
    '-pix_fmt', 'yuv420p',
    '-c:a', 'aac',
    '-b:a', '192k',
    '-movflags', '+faststart',
    '-y',
    outputPath,
  );

  const result = spawnSync(ffmpegBin, args, { encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 });
  if (result.error) {
    log.warn('Video merge: transition ffmpeg spawn error', { error: result.error.message });
    return false;
  }
  if (result.status !== 0) {
    log.warn('Video merge: transition ffmpeg failed', { stderr: result.stderr?.slice(-1000) });
    return false;
  }
  return true;
}

/**
 * 异步处理视频合成：优先使用 ffmpeg 真正合并多段视频；失败或无 ffmpeg 时用首段作为 merged_url。
 */
async function processVideoMerge(db, log, mergeId, baseUrl) {
  const r = db.prepare('SELECT * FROM video_merges WHERE id = ? AND deleted_at IS NULL').get(mergeId);
  if (!r) return;
  const taskId = r.task_id;
  const episodeId = r.episode_id;
  let scenes = [];
  try {
    scenes = JSON.parse(r.scenes || '[]');
  } catch (_) {
    log.warn('video merge parse scenes failed', { merge_id: mergeId });
  }
  const now = new Date().toISOString();
  db.prepare('UPDATE video_merges SET status = ? WHERE id = ?').run('processing', mergeId);
  const taskService = require('./taskService');
  if (scenes.length === 0) {
    db.prepare('UPDATE video_merges SET status = ?, error_msg = ? WHERE id = ?').run('failed', '无有效视频片段', mergeId);
    if (taskId) taskService.updateTaskError(db, taskId, '无有效视频片段');
    return;
  }
  const first = scenes[0];
  const mergedUrlFallback = first && first.video_url ? first.video_url : null;
  if (!mergedUrlFallback) {
    db.prepare('UPDATE video_merges SET status = ?, error_msg = ? WHERE id = ?').run('failed', '首段无视频地址', mergeId);
    if (taskId) taskService.updateTaskError(db, taskId, '首段无视频地址');
    return;
  }

  const totalDuration = scenes.reduce((sum, s) => sum + (Number(s.duration) || 0), 0);
  const storageRoot = getStorageRoot();
  const tempDir = path.join(require('os').tmpdir(), 'drama-video-merge');
  if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir, { recursive: true });

  const localPaths = [];
  const toCleanup = [];
  for (let i = 0; i < scenes.length; i++) {
    const p = await resolveVideoToLocalPath(
      scenes[i].video_url,
      baseUrl,
      storageRoot,
      tempDir,
      i,
      log
    );
    if (p) {
      localPaths.push(p);
      if (p.startsWith(tempDir)) toCleanup.push(p);
    }
  }

  const ffmpegAvailable = hasLocalFfmpeg();
  log.info('Video merge: ffmpeg check', {
    merge_id: mergeId,
    has_ffmpeg: ffmpegAvailable,
    ffmpeg_path: getFfmpegPath(),
    local_video_count: localPaths.length,
    cwd: process.cwd(),
  });

  let mergedRelativePath = null;
  if (localPaths.length > 0 && ffmpegAvailable && localPaths.length <= 100) {
    const projectSubdir = storageLayout.getProjectStorageSubdir(db, r.drama_id);
    const sub = projectSubdir && String(projectSubdir).trim();
    const mergedDir = sub
      ? path.join(storageRoot, sub, 'videos', 'merged')
      : path.join(storageRoot, 'videos', 'merged');
    if (!fs.existsSync(mergedDir)) fs.mkdirSync(mergedDir, { recursive: true });
    const outputFileName = `merged_${Date.now()}.mp4`;
    const outputPath = path.join(mergedDir, outputFileName);
    let mergeOpts = {};
    try {
      mergeOpts = JSON.parse(r.merge_options || '{}');
    } catch (_) {
      mergeOpts = {};
    }
    const transitionEnabled = !!mergeOpts.enable_transition;
    const ok = transitionEnabled
      ? (runFfmpegTransitionMerge(localPaths, outputPath, log, mergeOpts) || runFfmpegConcat(localPaths, outputPath, log))
      : runFfmpegConcat(localPaths, outputPath, log);
    if (ok && fs.existsSync(outputPath)) {
      mergedRelativePath = sub
        ? path.join(sub, 'videos', 'merged', outputFileName).replace(/\\/g, '/')
        : path.join('videos', 'merged', outputFileName).replace(/\\/g, '/');
      log.info('Video merge completed (ffmpeg)', { merge_id: mergeId, episode_id: episodeId, output: mergedRelativePath });
    }
  }

  let mergeOpts = {};
  try {
    mergeOpts = JSON.parse(r.merge_options || '{}');
  } catch (_) {
    mergeOpts = {};
  }
  const postNeed =
    !!mergeOpts.burn_narration_subtitles
    || !!mergeOpts.burn_dialogue_audio
    || !!(mergeOpts.watermark_text && String(mergeOpts.watermark_text).trim());
  if (mergedRelativePath && ffmpegAvailable && postNeed) {
    const mergedAbsPath = path.join(storageRoot, mergedRelativePath.replace(/\//g, path.sep));
    if (fs.existsSync(mergedAbsPath)) {
      const mergedPP = require('./mergedEpisodePostProcess');
      const post = await mergedPP.runMergedEpisodePostProcess(db, log, {
        mergedAbsPath,
        storageRoot,
        scenes,
        episodeId,
        mergeOpts,
      });
      if (post.ok && post.relativePath) {
        mergedRelativePath = post.relativePath;
        log.info('Video merge: merged episode post-process', { merge_id: mergeId, out: mergedRelativePath });
      } else if (post.error && post.error !== 'NO_POST_OPTS') {
        log.warn('Video merge: post-process skipped', { merge_id: mergeId, err: post.error });
      }
    }
  }

  for (const p of toCleanup) {
    try { if (fs.existsSync(p)) fs.unlinkSync(p); } catch (_) {}
  }

  const finalMergedUrl = mergedRelativePath || mergedUrlFallback;
  let finalDuration = Math.round(totalDuration) || null;
  if (mergedRelativePath) {
    const finalAbsPath = path.join(storageRoot, mergedRelativePath.replace(/\//g, path.sep));
    const finalInfo = probeMediaInfo(finalAbsPath, log);
    if (finalInfo?.duration > 0) finalDuration = Math.round(finalInfo.duration);
  }
  db.prepare(
    'UPDATE video_merges SET status = ?, merged_url = ?, duration = ?, completed_at = ?, error_msg = ? WHERE id = ?'
  ).run('completed', finalMergedUrl, finalDuration, now, null, mergeId);
  db.prepare('UPDATE episodes SET video_url = ?, status = ?, updated_at = ? WHERE id = ?').run(finalMergedUrl, 'completed', now, episodeId);
  if (taskId) {
    taskService.updateTaskResult(db, taskId, { merge_id: mergeId, video_url: finalMergedUrl, duration: finalDuration });
  }
  if (!mergedRelativePath) {
    log.info('Video merge completed (first-clip fallback)', { merge_id: mergeId, episode_id: episodeId });
  }
}

module.exports = {
  list,
  getById,
  create,
  deleteById,
  processVideoMerge,
};
